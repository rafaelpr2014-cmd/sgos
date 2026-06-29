package com.sgos.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class FcmTokenSender {

    private static final String TAG = "SGOS_FCM";
    private static final String PREFS = "SGOS_PREFS";
    private static final String API_TOKEN_URL = "https://suporte.sgos.net.br/api/push/token";

    public static void salvarToken(Context context, String token) {
        if (context == null || token == null || token.isEmpty()) {
            Log.w(TAG, "Token vazio ou contexto inválido.");
            return;
        }

        try {
            SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);

            prefs.edit()
                .putString("fcm_token_atual", token)
                .apply();

            String usuarioId = prefs.getString("usuario_id", null);

            if (usuarioId == null || usuarioId.isEmpty()) {
                Log.w(TAG, "usuario_id ainda não salvo. Token guardado como pendente.");
                prefs.edit()
                    .putString("fcm_token_pendente", token)
                    .apply();
                return;
            }

            enviarToken(context, usuarioId, token);

        } catch (Exception e) {
            Log.e(TAG, "Erro em salvarToken", e);
        }
    }

    public static void salvarUsuarioId(Context context, String usuarioId) {
        if (context == null || usuarioId == null || usuarioId.trim().isEmpty()) {
            Log.w(TAG, "usuario_id inválido recebido do WebView.");
            return;
        }

        try {
            SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);

            prefs.edit()
                .putString("usuario_id", usuarioId)
                .apply();

            Log.d(TAG, "usuario_id salvo no Android nativo: " + usuarioId);

            String tokenPendente = prefs.getString("fcm_token_pendente", null);
            String tokenAtual = prefs.getString("fcm_token_atual", null);
            String token = tokenPendente != null ? tokenPendente : tokenAtual;

            if (token != null && !token.isEmpty()) {
                enviarToken(context, usuarioId, token);
                prefs.edit().remove("fcm_token_pendente").apply();
            } else {
                FcmTokenService.buscarToken(context.getApplicationContext());
            }

        } catch (Exception e) {
            Log.e(TAG, "Erro em salvarUsuarioId", e);
        }
    }

    public static void enviarToken(Context context, String usuarioId, String token) {
        new Thread(() -> {
            HttpURLConnection conn = null;

            try {
                URL url = new URL(API_TOKEN_URL);
                conn = (HttpURLConnection) url.openConnection();

                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("x-usuario-id", usuarioId);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setDoOutput(true);

                JSONObject json = new JSONObject();
                json.put("token_fcm", token);
                json.put("plataforma", "android_nativo");
                json.put("device_id", "android_native_" + usuarioId);

                OutputStream os = conn.getOutputStream();
                os.write(json.toString().getBytes("UTF-8"));
                os.close();

                int code = conn.getResponseCode();
                Log.d(TAG, "Resposta backend /api/push/token: " + code);

                if (code >= 200 && code < 300 && context != null) {
                    SharedPreferences prefs = context.getApplicationContext()
                        .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                    prefs.edit().remove("fcm_token_pendente").apply();
                }

            } catch (Exception e) {
                Log.e(TAG, "Erro ao enviar token FCM para backend", e);
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }
}
