import { PushNotifications } from '@capacitor/push-notifications';

function obterUsuarioLocal(){
    try {
        return JSON.parse(localStorage.getItem("usuario") || "{}");
    } catch {
        return {};
    }
}

function obterPlataforma(){
    try {
        if(window.Capacitor && typeof window.Capacitor.getPlatform === "function"){
            return window.Capacitor.getPlatform(); // ios, android ou web
        }
    } catch {}

    return "web";
}

function obterApiBase(){
    const salvo = localStorage.getItem("api_base");
    if(salvo) return salvo.replace(/\/$/, "");

    const provedor = localStorage.getItem("provedor");
    if(provedor) return `https://${provedor}.sgos.net.br`;

    if(location.protocol.startsWith("http")) return location.origin;

    return "";
}

function apiUrl(path){
    const base = obterApiBase();
    if(!base) return path;
    return base + (path.startsWith("/") ? path : "/" + path);
}

function obterDeviceId(plataforma){
    let deviceId = localStorage.getItem("device_id");

    if(!deviceId){
        const usuario = obterUsuarioLocal();
        deviceId = `${plataforma || "app"}-${usuario?.id || "user"}-${Date.now()}`;
        localStorage.setItem("device_id", deviceId);
    }

    return deviceId;
}

async function salvarTokenNoServidor(token){
    const usuario = obterUsuarioLocal();
    const plataforma = obterPlataforma();

    console.log("========== PUSH FCM ==========");
    console.log("Plataforma:", plataforma);
    console.log("Usuário local:", usuario);
    console.log("Token FCM:", token);

    if(!usuario?.id){
        console.error("Usuário não encontrado no localStorage.");
        return;
    }

    const resp = await fetch(apiUrl("/api/push/token"), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-usuario-id": usuario.id,
            "x-empresa-id": usuario.empresa_id || ""
        },
        body: JSON.stringify({
            token_fcm: String(token),
            plataforma,
            device_id: obterDeviceId(plataforma)
        })
    });

    const data = await resp.json().catch(() => ({}));

    console.log("Status /api/push/token:", resp.status);
    console.log("Resposta /api/push/token:", data);

    if(!resp.ok){
        throw new Error(data?.erro || "Erro ao salvar token FCM");
    }

    localStorage.setItem("push_token_fcm", String(token));
    localStorage.setItem("push_plataforma", plataforma);
    console.log("✅ TOKEN FCM SALVO NO SGOS:", data);
}

export async function iniciarPush() {
    try {
        console.log("🚀 Iniciando Push FCM...");
        console.log("Plataforma detectada:", obterPlataforma());

        await PushNotifications.addListener("registration", async (token) => {
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

        await PushNotifications.addListener("registrationError", err => {
            console.error("ERRO FCM:", err);
            alert("Erro ao registrar push: " + (err?.error || err?.message || JSON.stringify(err)));
        });

        await PushNotifications.addListener("pushNotificationReceived", notification => {
            console.log("PUSH RECEBIDO:", notification);
        });

        await PushNotifications.addListener("pushNotificationActionPerformed", event => {
            console.log("PUSH CLICADO:", event);

            const data = event?.notification?.data || {};
            const osId = data.os_id || data.id_os || data.id;

            if(osId){
                window.location.href = `appmobile.html?app=1&os_id=${encodeURIComponent(osId)}`;
            }else{
                window.location.href = "appmobile.html?app=1";
            }
        });

        let permissaoAntes = null;
        if(typeof PushNotifications.checkPermissions === "function"){
            permissaoAntes = await PushNotifications.checkPermissions();
            console.log("Permissão antes:", permissaoAntes);
        }

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
        alert("Erro geral ao iniciar push: " + (err?.message || JSON.stringify(err)));
    }
}
