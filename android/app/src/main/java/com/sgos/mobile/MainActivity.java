package com.sgos.mobile;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebSettings;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SGOS_FCM";
    private static final int REQUEST_PERMISSOES_MIDIA_LOCALIZACAO = 2026;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Log.e("SGOS_TESTE", "========== MAIN ACTIVITY EXECUTOU ==========");

        criarCanalNotificacao();
        configurarWebViewParaMidiaELocalizacao();
        instalarSeletorNativoDeFoto();
        solicitarPermissoesDoApp();
        registrarPonteJavascript();
    }

    private void configurarWebViewParaMidiaELocalizacao() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) {
                Log.w(TAG, "Bridge/WebView indisponível para configuração de mídia e GPS.");
                return;
            }

            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();

            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setGeolocationEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);

            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

            Log.d(TAG, "WebView configurada para câmera, vídeo e geolocalização.");
        } catch (Exception e) {
            Log.e(TAG, "Erro ao configurar WebView para mídia e localização", e);
        }
    }

    private void instalarSeletorNativoDeFoto() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) {
                Log.w(TAG, "Bridge/WebView indisponível para instalar seletor nativo de foto.");
                return;
            }

            getBridge().getWebView().setWebChromeClient(new SGOSWebChromeClient(getBridge()));
            Log.d(TAG, "SGOSWebChromeClient instalado: captura de foto será forçada para a câmera.");
        } catch (Exception e) {
            Log.e(TAG, "Erro ao instalar SGOSWebChromeClient", e);
        }
    }

    private class SGOSWebChromeClient extends BridgeWebChromeClient {
        private final ActivityResultLauncher<Intent> cameraLauncher;
        private ValueCallback<Uri[]> cameraCallback;
        private Uri fotoUri;
        private File fotoArquivo;

        SGOSWebChromeClient(Bridge bridge) {
            super(bridge);

            cameraLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    ValueCallback<Uri[]> callback = cameraCallback;
                    cameraCallback = null;

                    if (callback == null) return;

                    if (result.getResultCode() == Activity.RESULT_OK && fotoUri != null) {
                        // Câmeras físicas costumam gerar JPEGs muito grandes (10-30+ MP).
                        // Reduz antes de entregar ao WebView para evitar pico de memória/OOM
                        // quando o HTML cria File/Blob, IndexedDB e FormData.
                        otimizarFotoCapturada(fotoArquivo);
                        callback.onReceiveValue(new Uri[]{fotoUri});
                    } else {
                        callback.onReceiveValue(null);
                    }

                    fotoUri = null;
                    fotoArquivo = null;
                }
            );
        }

        @Override
        public boolean onShowFileChooser(
            WebView webView,
            ValueCallback<Uri[]> filePathCallback,
            WebChromeClient.FileChooserParams fileChooserParams
        ) {
            String[] tipos = fileChooserParams != null ? fileChooserParams.getAcceptTypes() : null;
            List<String> acceptTypes = tipos != null ? Arrays.asList(tipos) : java.util.Collections.emptyList();

            // No SGOS, os inputs "Foto de agora" e câmera de comprovante usam somente image/*.
            // Alguns Android/WebView ignoram capture="environment" e retornam capture=false.
            // Por isso, image/* isolado é tratado diretamente pela câmera nativa.
            boolean somenteImagem = acceptTypes.size() == 1 && "image/*".equalsIgnoreCase(acceptTypes.get(0));

            if (somenteImagem) {
                if (abrirCameraNativa(filePathCallback)) {
                    return true;
                }

                Log.w(TAG, "Não foi possível abrir câmera nativa; usando seletor padrão do Capacitor.");
            }

            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
        }

        private boolean abrirCameraNativa(ValueCallback<Uri[]> callback) {
            try {
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED) {
                    Log.w(TAG, "Permissão CAMERA ainda não concedida; usando fluxo padrão.");
                    return false;
                }

                if (cameraCallback != null) {
                    cameraCallback.onReceiveValue(null);
                }

                File pastaCamera = new File(getCacheDir(), "sgos-camera");
                if (!pastaCamera.exists() && !pastaCamera.mkdirs()) {
                    Log.e(TAG, "Não foi possível criar diretório temporário da câmera.");
                    return false;
                }

                File arquivo = File.createTempFile("sgos_foto_", ".jpg", pastaCamera);
                Uri uri = FileProvider.getUriForFile(
                    MainActivity.this,
                    getPackageName() + ".sgos.fileprovider",
                    arquivo
                );

                Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                intent.setClipData(ClipData.newRawUri("SGOS foto", uri));

                cameraCallback = callback;
                fotoUri = uri;
                fotoArquivo = arquivo;
                cameraLauncher.launch(intent);

                Log.d(TAG, "ACTION_IMAGE_CAPTURE disparado pelo SGOSWebChromeClient.");
                return true;
            } catch (ActivityNotFoundException e) {
                Log.e(TAG, "Nenhum aplicativo de câmera disponível.", e);
            } catch (Exception e) {
                Log.e(TAG, "Falha ao abrir câmera nativa.", e);
            }

            cameraCallback = null;
            fotoUri = null;
            fotoArquivo = null;
            return false;
        }

        private void otimizarFotoCapturada(File arquivo) {
            if (arquivo == null || !arquivo.exists() || arquivo.length() <= 0) return;

            Bitmap bitmap = null;
            Bitmap corrigido = null;
            Bitmap redimensionado = null;

            try {
                final int MAX_LADO = 1920;
                final int QUALIDADE_JPEG = 82;

                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(arquivo.getAbsolutePath(), bounds);

                int largura = bounds.outWidth;
                int altura = bounds.outHeight;
                if (largura <= 0 || altura <= 0) {
                    Log.w(TAG, "Não foi possível obter dimensões da foto; mantendo original.");
                    return;
                }

                int sample = 1;
                while ((largura / sample) > (MAX_LADO * 2) || (altura / sample) > (MAX_LADO * 2)) {
                    sample *= 2;
                }

                BitmapFactory.Options opcoes = new BitmapFactory.Options();
                opcoes.inSampleSize = sample;
                opcoes.inPreferredConfig = Bitmap.Config.ARGB_8888;
                bitmap = BitmapFactory.decodeFile(arquivo.getAbsolutePath(), opcoes);
                if (bitmap == null) {
                    Log.w(TAG, "Falha ao decodificar foto; mantendo original.");
                    return;
                }

                int rotacao = 0;
                try {
                    ExifInterface exif = new ExifInterface(arquivo.getAbsolutePath());
                    int orientacao = exif.getAttributeInt(
                        ExifInterface.TAG_ORIENTATION,
                        ExifInterface.ORIENTATION_NORMAL
                    );
                    if (orientacao == ExifInterface.ORIENTATION_ROTATE_90) rotacao = 90;
                    else if (orientacao == ExifInterface.ORIENTATION_ROTATE_180) rotacao = 180;
                    else if (orientacao == ExifInterface.ORIENTATION_ROTATE_270) rotacao = 270;
                } catch (Exception e) {
                    Log.w(TAG, "Não foi possível ler orientação EXIF da foto.", e);
                }

                corrigido = bitmap;
                if (rotacao != 0) {
                    Matrix matriz = new Matrix();
                    matriz.postRotate(rotacao);
                    corrigido = Bitmap.createBitmap(
                        bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matriz, true
                    );
                }

                int w = corrigido.getWidth();
                int h = corrigido.getHeight();
                float escala = Math.min(1f, (float) MAX_LADO / (float) Math.max(w, h));

                redimensionado = corrigido;
                if (escala < 1f) {
                    int novoW = Math.max(1, Math.round(w * escala));
                    int novoH = Math.max(1, Math.round(h * escala));
                    redimensionado = Bitmap.createScaledBitmap(corrigido, novoW, novoH, true);
                }

                try (FileOutputStream saida = new FileOutputStream(arquivo, false)) {
                    if (!redimensionado.compress(Bitmap.CompressFormat.JPEG, QUALIDADE_JPEG, saida)) {
                        Log.w(TAG, "Compressão JPEG retornou false.");
                    }
                    saida.flush();
                }

                Log.d(TAG, "Foto otimizada para WebView: "
                    + redimensionado.getWidth() + "x" + redimensionado.getHeight()
                    + ", " + arquivo.length() + " bytes.");
            } catch (OutOfMemoryError oom) {
                Log.e(TAG, "Memória insuficiente ao otimizar foto; mantendo arquivo capturado.", oom);
            } catch (Exception e) {
                Log.e(TAG, "Falha ao otimizar foto capturada; mantendo original.", e);
            } finally {
                if (redimensionado != null && redimensionado != corrigido && !redimensionado.isRecycled()) {
                    redimensionado.recycle();
                }
                if (corrigido != null && corrigido != bitmap && !corrigido.isRecycled()) {
                    corrigido.recycle();
                }
                if (bitmap != null && !bitmap.isRecycled()) {
                    bitmap.recycle();
                }
            }
        }
    }

    private void solicitarPermissoesDoApp() {
        java.util.ArrayList<String> pendentes = new java.util.ArrayList<>();

        adicionarSePendente(pendentes, Manifest.permission.ACCESS_FINE_LOCATION);
        adicionarSePendente(pendentes, Manifest.permission.ACCESS_COARSE_LOCATION);
        adicionarSePendente(pendentes, Manifest.permission.CAMERA);
        adicionarSePendente(pendentes, Manifest.permission.RECORD_AUDIO);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            adicionarSePendente(pendentes, Manifest.permission.POST_NOTIFICATIONS);
        }

        if (!pendentes.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                pendentes.toArray(new String[0]),
                REQUEST_PERMISSOES_MIDIA_LOCALIZACAO
            );
        }
    }

    private void adicionarSePendente(java.util.ArrayList<String> pendentes, String permissao) {
        if (ContextCompat.checkSelfPermission(this, permissao)
            != PackageManager.PERMISSION_GRANTED) {
            pendentes.add(permissao);
        }
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
