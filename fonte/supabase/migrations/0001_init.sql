-- Prato Diário — banco para a versão de celular (uso próprio)
-- Cole tudo no SQL Editor do Supabase e clique em Run. Pode rodar de novo sem estragar nada.

-- 1) Documentos do app (perfil, metas, cada dia, diagnóstico).
--    Mesmo formato que o app já usa: um caminho por documento e o conteúdo em JSON.
create table if not exists public.docs (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path       text not null,                 -- ex.: data/users/<id>/main/days/2026-11-07
  parent     text not null,                 -- coleção a que pertence: data/users/<id>/main/days
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, path),
  constraint docs_tamanho check (pg_column_size(data) < 2000000)
);
create index if not exists docs_parent_date on public.docs (user_id, parent, (data->>'date'));

alter table public.docs enable row level security;

-- Cada pessoa só enxerga e altera os próprios documentos.
drop policy if exists docs_select on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
create policy docs_select on public.docs for select to authenticated using (user_id = auth.uid());
create policy docs_insert on public.docs for insert to authenticated with check (user_id = auth.uid());
create policy docs_update on public.docs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy docs_delete on public.docs for delete to authenticated using (user_id = auth.uid());

create or replace function public.docs_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.docs_touch();

-- 2) Contador de uso da IA por dia (protege a sua chave de gasto inesperado).
--    Só a função "ai" (com a chave de serviço) escreve aqui; o app não tem acesso.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default (now() at time zone 'America/Bahia')::date,
  calls   int  not null default 0,
  in_tok  int  not null default 0,
  out_tok int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage for select to authenticated using (user_id = auth.uid());

-- Incrementa e devolve o total do dia numa única operação (sem corrida entre duas fotos ao mesmo tempo).
create or replace function public.ai_bump(p_user uuid, p_in int, p_out int)
returns int language sql security definer set search_path = public as $$
  insert into public.ai_usage (user_id, day, calls, in_tok, out_tok)
  values (p_user, (now() at time zone 'America/Bahia')::date, 1, p_in, p_out)
  on conflict (user_id, day) do update
    set calls = ai_usage.calls + 1, in_tok = ai_usage.in_tok + p_in, out_tok = ai_usage.out_tok + p_out
  returning calls;
$$;
revoke all on function public.ai_bump(uuid, int, int) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ai_bump(uuid, int, int) to service_role;
  end if;
end $$;
