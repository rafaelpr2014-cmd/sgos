package com.sgos.mobile;

import android.content.Context;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;

public class FcmTokenService extends FirebaseMessagingService {

    private static final String TAG = "SGOS_FCM";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);

        Log.d(TAG, "Novo token FCM recebido: " + token);
        FcmTokenSender.salvarToken(getApplicationContext(), token);
    }

    public static void buscarToken(Context context) {
        FirebaseMessaging.getInstance().getToken()
            .addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    Log.e(TAG, "Erro ao buscar token FCM", task.getException());
                    return;
                }

                String token = task.getResult();
                Log.d(TAG, "Token FCM atual: " + token);
                FcmTokenSender.salvarToken(context.getApplicationContext(), token);
            });
    }
}
