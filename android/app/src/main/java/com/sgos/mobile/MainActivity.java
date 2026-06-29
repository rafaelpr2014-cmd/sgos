package com.sgos.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SGOS_FCM";

    @Override
protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    Log.e("SGOS_TESTE", "========== MAIN ACTIVITY EXECUTOU ==========");

    criarCanalNotificacao();
    registrarPonteJavascript();
    FcmTokenService.buscarToken(this);
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
        private final Context context;

        SGOSAndroidBridge(Context context) {
            this.context = context.getApplicationContext();
        }

        @JavascriptInterface
        public void salvarUsuarioId(String usuarioId) {
            Log.d(TAG, "usuario_id recebido do WebView: " + usuarioId);
            FcmTokenSender.salvarUsuarioId(context, usuarioId);
        }
    }
}
