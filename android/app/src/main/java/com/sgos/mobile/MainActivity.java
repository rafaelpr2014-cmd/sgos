package com.sgos.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebStorage;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SGOS_FCM";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Log.e("SGOS_TESTE", "========== MAIN ACTIVITY EXECUTOU ==========");

        criarCanalNotificacao();
        registrarPonteJavascript();
    }

    private void registrarPonteJavascript() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().addJavascriptInterface(
                    new SGOSAndroidBridge(this),
                    "SGOSAndroid"
                );
                Log.d(TAG, "Ponte JS SGOSAndroid registrada com sucesso.");
            } else {
                Log.w(TAG, "Bridge/WebView ainda indisponível para registrar SGOSAndroid.");
            }
        } catch (Exception e) {
            Log.e(TAG, "Erro ao registrar ponte JS SGOSAndroid", e);
        }
    }

    private void criarCanalNotificacao() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                "sgos_os_channel",
                "Ordens de Serviço SGOS",
                NotificationManager.IMPORTANCE_HIGH
            );

            channel.setDescription("Notificações de ordens de serviço");
            channel.enableVibration(true);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    public static class SGOSAndroidBridge {
        private final MainActivity activity;
        private final Context context;

        SGOSAndroidBridge(MainActivity activity) {
            this.activity = activity;
            this.context = activity.getApplicationContext();
        }

        @JavascriptInterface
        public void salvarUsuarioId(String usuarioId) {
            if (usuarioId == null || usuarioId.trim().isEmpty()) {
                limparUsuarioId();
                return;
            }

            Log.d(TAG, "usuario_id recebido do WebView: " + usuarioId);
            FcmTokenSender.salvarUsuarioId(context, usuarioId);
        }

        @JavascriptInterface
        public void limparUsuarioId() {
            FcmTokenSender.limparUsuarioId(context);
            Log.d(TAG, "usuario_id nativo removido.");
        }

        @JavascriptInterface
        public void logout() {
            limparUsuarioId();

            activity.runOnUiThread(() -> {
                try {
                    WebView webView = activity.getBridge() != null
                        ? activity.getBridge().getWebView()
                        : null;

                    CookieManager cookieManager = CookieManager.getInstance();
                    cookieManager.removeAllCookies(null);
                    cookieManager.flush();

                    if (webView != null) {
                        webView.stopLoading();
                        webView.clearHistory();
                        webView.clearCache(true);

                        // Apaga WebStorage antigo para impedir restauração de sessão.
                        WebStorage.getInstance().deleteAllData();

                        String loginUrl = "https://localhost/index.html?logout=1&t="
                            + System.currentTimeMillis();
                        webView.loadUrl(loginUrl);
                        webView.clearHistory();

                        Log.d(TAG, "Logout nativo concluído. Login local carregado.");
                    } else {
                        Log.w(TAG, "WebView indisponível durante logout nativo.");
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Erro ao executar logout nativo", e);
                }
            });
        }
    }
}
