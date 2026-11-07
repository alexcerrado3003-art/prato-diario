// Prato Diário — casca nativa (Android/iOS) que abre a versão de celular publicada.
// O app é o mesmo da PWA; aqui só ganha ícone na tela inicial, câmera e voltar do Android.
// Troque "appUrl" em app.json pelo endereço onde você publicou a pasta pwa/.
import { useEffect, useRef, useState } from "react";
import { BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import Constants from "expo-constants";

const APP_URL = Constants.expoConfig?.extra?.appUrl || "";
const ORIGIN = (() => { try { return new URL(APP_URL).origin; } catch { return ""; } })();

export default function App() {
  const web = useRef(null);
  const [canBack, setCanBack] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canBack && web.current) { web.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [canBack]);

  if (!ORIGIN || APP_URL.includes("SEU-SITE")) {
    return (
      <View style={s.center}><Text style={s.h}>Falta o endereço do app</Text>
        <Text style={s.p}>Em app.json, troque extra.appUrl pelo endereço onde a pasta pwa/ foi publicada e gere o app de novo.</Text></View>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.full} edges={["top", "bottom"]}>
        <StatusBar style="auto" />
        {offline ? (
          <View style={s.center}>
            <Text style={s.h}>Sem conexão</Text>
            <Text style={s.p}>O Prato Diário precisa de internet para abrir pela primeira vez e para salvar.</Text>
            <Pressable style={s.btn} onPress={() => { setOffline(false); web.current?.reload(); }}><Text style={s.btnT}>Tentar de novo</Text></Pressable>
          </View>
        ) : (
          <WebView
            ref={web}
            source={{ uri: APP_URL }}
            originWhitelist={["https://*"]}
            javaScriptEnabled
            domStorageEnabled
            cacheEnabled
            allowsBackForwardNavigationGestures
            allowFileAccess={false}
            mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
            setSupportMultipleWindows={false}
            pullToRefreshEnabled
            onNavigationStateChange={(n) => setCanBack(n.canGoBack)}
            onError={() => setOffline(true)}
            onShouldStartLoadWithRequest={(req) => {
              // links de fora (fontes de dados, e-mail) abrem no navegador do celular
              if (req.url.startsWith(ORIGIN) || req.url.startsWith("about:") || req.url.startsWith("blob:") || req.url.startsWith("data:")) return true;
              Linking.openURL(req.url).catch(() => {});
              return false;
            }}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#ffffff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: "#ffffff" },
  h: { fontSize: 22, fontWeight: "700", color: "#1c2a3f", textAlign: "center" },
  p: { fontSize: 16, color: "#5a6779", textAlign: "center", lineHeight: 22 },
  btn: { marginTop: 8, backgroundColor: "#1f2d45", borderRadius: 999, paddingVertical: 14, paddingHorizontal: 28 },
  btnT: { color: "#ffffff", fontWeight: "600", fontSize: 16 },
});
