const iniciarFirebase = require("./firebase");
const apn = require("apn");
const fs = require("fs");

let apnProvider = null;

function normalizarPlataforma(plataforma){
    return String(plataforma || "").toLowerCase().trim();
}

function getApnConfig() {
    const keyPath = process.env.APNS_KEY_PATH || "/root/sgos/AuthKey_7338N29JMD.p8";
    const keyId = process.env.APNS_KEY_ID || "7338N29JMD";
    const teamId = process.env.APNS_TEAM_ID || "T7VMAXZY78";
    const bundleId = process.env.APNS_BUNDLE_ID || "com.sgos.mobile";
    const production = String(process.env.APNS_PRODUCTION || "true").toLowerCase() !== "false";

    return { keyPath, keyId, teamId, bundleId, production };
}

function getApnProvider(){
    if(apnProvider) return apnProvider;

    const cfg = getApnConfig();

    if(!fs.existsSync(cfg.keyPath)){
        throw new Error(`Arquivo APNs .p8 não encontrado em ${cfg.keyPath}`);
    }

    apnProvider = new apn.Provider({
        token: {
            key: cfg.keyPath,
            keyId: cfg.keyId,
            teamId: cfg.teamId
        },
        production: cfg.production
    });

    return apnProvider;
}

module.exports = (pool) => {

    async function buscarTokens(usuarioId, empresaId){
        const [rows] = await pool.query(`
            SELECT id, token_fcm, plataforma
            FROM usuarios_push_tokens
            WHERE usuario_id = ?
              AND empresa_id = ?
              AND ativo = 1
        `, [usuarioId, empresaId]);

        return rows;
    }

    async function buscarTokensEmpresa(empresaId){
        const [rows] = await pool.query(`
            SELECT id, token_fcm, plataforma
            FROM usuarios_push_tokens
            WHERE empresa_id = ?
              AND ativo = 1
        `, [empresaId]);

        return rows;
    }

    async function desativarToken(id){
        await pool.query(`
            UPDATE usuarios_push_tokens
            SET ativo = 0,
                atualizado_em = NOW()
            WHERE id = ?
        `, [id]);
    }

    function montarPayloadOS({ osId, cliente, localidade, tipoServico }){
        const bodyParts = [];
        if(cliente) bodyParts.push(`Cliente: ${cliente}`);
        if(localidade) bodyParts.push(`Localidade: ${localidade}`);
        if(tipoServico) bodyParts.push(`Serviço: ${tipoServico}`);

        const body = bodyParts.length
            ? bodyParts.join(" • ")
            : `OS #${osId} entrou em andamento`;

        const title = "🚀 NOVA OS LANÇADA! 🚀";

        const data = {
            tipo: "os_andamento",
            os_id: String(osId),
            id: String(osId),
            url: `/appmobile.html?app=1&os_id=${osId}`,
            click_action: "OPEN_OS"
        };

        return {
            title,
            body,
            data,
            fcm: {
                notification: { title, body },
                data,
                android: {
                    priority: "high",
                    notification: {
                        channelId: "sgos_os_channel",
                        sound: "default",
                        icon: "ic_stat_sgos",
                        color: "#2563eb",
                        clickAction: "OPEN_OS"
                    }
                }
            }
        };
    }

    async function enviarFcm(item, payload){
        const admin = iniciarFirebase();

        if(!admin){
            throw Object.assign(new Error("Firebase ainda não configurado"), { code:"firebase_nao_configurado" });
        }

        await admin.messaging().send({
            token: item.token_fcm,
            ...payload.fcm
        });
    }

    async function enviarApns(item, payload){
        const cfg = getApnConfig();
        const provider = getApnProvider();

        const note = new apn.Notification();
        note.topic = cfg.bundleId;
        note.expiry = Math.floor(Date.now() / 1000) + 3600;
        note.priority = 10;
        note.sound = "default";
        note.badge = 1;
        note.alert = {
            title: payload.title,
            body: payload.body
        };
        note.payload = payload.data;
        note.category = "OPEN_OS";

        // token_fcm mantém o nome da coluna atual, mas no iOS ele guarda o token APNs.
        const tokenApns = String(item.token_fcm || "").replace(/\s+/g, "");
        const resultado = await provider.send(note, tokenApns);

        if(resultado.sent && resultado.sent.length > 0){
            return;
        }

        const falha = resultado.failed && resultado.failed[0];
        const motivo = falha?.response?.reason || falha?.error?.message || "Falha APNs";
        const status = falha?.status || falha?.response?.statusCode || null;
        const erro = new Error(motivo);
        erro.code = `apns/${motivo}`;
        erro.status = status;
        throw erro;
    }

    async function enviarParaTokens(tokens, payload){
        if(!tokens.length){
            return { enviados: 0, falhas: 0, erro: "sem_tokens", detalhes: [] };
        }

        let enviados = 0;
        let falhas = 0;
        const detalhes = [];

        for(const item of tokens){
            const plataforma = normalizarPlataforma(item.plataforma);

            try {
                const tokenLimpo = String(item.token_fcm || "").trim();
                const pareceApns = /^[0-9a-fA-F]{64}$/.test(tokenLimpo);

                if(plataforma === "ios" && pareceApns){
                    await enviarApns(item, payload);
                }else{
                    // Android, Web e iOS com token FCM entram pelo Firebase Admin.
                    await enviarFcm(item, payload);
                }

                enviados++;
                detalhes.push({ token_id: item.id, plataforma: item.plataforma, ok: true });
            } catch(err){
                falhas++;
                const detalhe = {
                    token_id: item.id,
                    plataforma: item.plataforma,
                    ok: false,
                    code: err.code || "erro_push",
                    message: err.message
                };

                if(err.status) detalhe.status = err.status;
                detalhes.push(detalhe);

                console.error("Erro ao enviar push:", detalhe);

                const code = String(err.code || "");
                const message = String(err.message || "");

                if(
                    code === "messaging/registration-token-not-registered" ||
                    code === "messaging/invalid-registration-token" ||
                    message === "BadDeviceToken" ||
                    message === "Unregistered" ||
                    err.status === 410
                ){
                    await desativarToken(item.id);
                }
            }
        }

        return { enviados, falhas, detalhes };
    }

    async function enviarPushOSAndamento({ usuarioId, empresaId, osId, cliente, localidade, tipoServico }){
        const tokens = await buscarTokens(usuarioId, empresaId);
        return enviarParaTokens(tokens, montarPayloadOS({ osId, cliente, localidade, tipoServico }));
    }

    async function enviarPushOSEmpresa({ empresaId, osId, cliente, localidade, tipoServico }){
        const tokens = await buscarTokensEmpresa(empresaId);
        return enviarParaTokens(tokens, montarPayloadOS({ osId, cliente, localidade, tipoServico }));
    }

    return {
        buscarTokens,
        buscarTokensEmpresa,
        enviarPushOSAndamento,
        enviarPushOSEmpresa,
        enviarPushNovaOS: enviarPushOSAndamento
    };
};
