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

    if(!usuario?.id){
        console.error("Não foi possível salvar token FCM: usuário não encontrado no localStorage.");
        return;
    }

    const resp = await fetch("/api/push/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-usuario-id": usuario.id
        },
        body: JSON.stringify({
            token_fcm: token,
            plataforma: "android"
        })
    });

    const data = await resp.json();

    if(!resp.ok){
        throw new Error(data?.erro || "Erro ao salvar token FCM");
    }

    localStorage.setItem("push_token_fcm", token);
    console.log("✅ TOKEN FCM SALVO NO SGOS:", data);
}

export async function iniciarPush() {

    try {

        console.log("🚀 Iniciando Push FCM...");

        const perm = await PushNotifications.requestPermissions();

        if (perm.receive !== 'granted') {
            console.log('Permissão de push negada');
            return;
        }

        await PushNotifications.register();

        PushNotifications.addListener(
            'registration',
            async (token) => {

                console.log(
                    'TOKEN FCM:',
                    token.value
                );

                try {
                    await salvarTokenNoServidor(token.value);
                } catch(err) {
                    console.error("ERRO AO SALVAR TOKEN FCM:", err);
                }
            }
        );

        PushNotifications.addListener(
            'registrationError',
            err => {

                console.error(
                    'ERRO FCM:',
                    err
                );

            }
        );

        PushNotifications.addListener(
            'pushNotificationReceived',
            notification => {
                console.log('PUSH RECEBIDO:', notification);
            }
        );

        PushNotifications.addListener(
            'pushNotificationActionPerformed',
            event => {
                console.log('PUSH CLICADO:', event);
            }
        );

    } catch(err) {
        console.error("Erro geral ao iniciar Push:", err);
    }
}
