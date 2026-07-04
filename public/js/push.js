import { PushNotifications } from '@capacitor/push-notifications';

function obterUsuarioLocal(){
    try {
        return JSON.parse(localStorage.getItem("usuario") || "{}");
    } catch {
        return {};
    }
}

async function salvarTokenNoServidor(token){
    const usuario = obterUsuarioLocal();

    console.log("========== PUSH FCM ==========");
    console.log("Usuário local:", usuario);
    console.log("Token FCM:", token);

    if(!usuario?.id){
        console.error("Usuário não encontrado no localStorage.");
        return;
    }

    const resp = await fetch("/api/push/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-usuario-id": usuario.id,
            "x-empresa-id": usuario.empresa_id || ""
        },
        body: JSON.stringify({
            token_fcm: token,
            plataforma: "android"
        })
    });

    const data = await resp.json().catch(() => ({}));

    console.log("Status /api/push/token:", resp.status);
    console.log("Resposta /api/push/token:", data);

    if(!resp.ok){
        throw new Error(data?.erro || "Erro ao salvar token FCM");
    }

    localStorage.setItem("push_token_fcm", token);
    console.log("✅ TOKEN FCM SALVO NO SGOS:", data);
}

export async function iniciarPush() {
    try {
        console.log("🚀 Iniciando Push FCM...");

        PushNotifications.addListener("registration", async (token) => {
            console.log("================================");
            console.log("EVENTO registration DISPAROU");
            console.log("TOKEN FCM:", token.value);
            console.log("================================");

            try {
                await salvarTokenNoServidor(token.value);
            } catch(err) {
                console.error("ERRO AO SALVAR TOKEN FCM:", err);
            }
        });

        PushNotifications.addListener("registrationError", err => {
            console.error("ERRO FCM:", err);
        });

        PushNotifications.addListener("pushNotificationReceived", notification => {
            console.log("PUSH RECEBIDO:", notification);
        });

        PushNotifications.addListener("pushNotificationActionPerformed", event => {
            console.log("PUSH CLICADO:", event);
        });

        const perm = await PushNotifications.requestPermissions();

        console.log("Permissão push:", perm);

        if (perm.receive !== "granted") {
            console.log("Permissão de push negada");
            return;
        }

        await PushNotifications.register();

        console.log("✅ PushNotifications.register() executado");

    } catch(err) {
        console.error("Erro geral ao iniciar Push:", err);
    }
}