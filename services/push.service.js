const iniciarFirebase = require("./firebase");

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
            notification: {
                title,
                body
            },

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
            },

            apns: {
                headers: {
                    "apns-priority": "10",
                    "apns-push-type": "alert"
                },
                payload: {
                    aps: {
                        alert: {
                            title,
                            body
                        },
                        sound: "default",
                        badge: 1,
                        category: "OPEN_OS"
                    }
                },
                fcm_options: {
                    image: "https://iili.io/CRh1TlV.png"
                }
            }
        };
    }

    async function enviarParaTokens(tokens, payload){
        const admin = iniciarFirebase();

        if(!admin){
            console.warn("Push não enviado: Firebase ainda não configurado.");
            return { enviados: 0, falhas: 0, erro: "firebase_nao_configurado" };
        }

        if(!tokens.length){
            return { enviados: 0, falhas: 0, erro: "sem_tokens" };
        }

        let enviados = 0;
        let falhas = 0;
        const detalhes = [];

        for(const item of tokens){
            try {
                await admin.messaging().send({
                    token: item.token_fcm,
                    ...payload
                });

                enviados++;
                detalhes.push({ token_id: item.id, plataforma: item.plataforma, ok: true });
            } catch(err){
                falhas++;

                console.error("Erro ao enviar push FCM:", {
                    token_id: item.id,
                    plataforma: item.plataforma,
                    code: err.code,
                    message: err.message
                });

                detalhes.push({
                    token_id: item.id,
                    plataforma: item.plataforma,
                    ok: false,
                    code: err.code,
                    message: err.message
                });

                if(
                    err.code === "messaging/registration-token-not-registered" ||
                    err.code === "messaging/invalid-registration-token"
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
