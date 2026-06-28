const iniciarFirebase = require("./firebase");

module.exports = (pool) => {

    async function buscarTokens(usuarioId, empresaId){
        const [rows] = await pool.query(`
            SELECT id, token_fcm
            FROM usuarios_push_tokens
            WHERE usuario_id = ?
              AND empresa_id = ?
              AND ativo = 1
        `, [usuarioId, empresaId]);

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

    async function enviarPushNovaOS({ usuarioId, empresaId, osId, cliente, localidade, tipoServico }){
        const admin = iniciarFirebase();

        if(!admin){
            console.warn("Push não enviado: Firebase ainda não configurado.");
            return { enviados:0, falhas:0, erro:"firebase_nao_configurado" };
        }

        const tokens = await buscarTokens(usuarioId, empresaId);

        if(!tokens.length){
            return { enviados:0, falhas:0, erro:"sem_tokens" };
        }

        const bodyParts = [];
        if(cliente) bodyParts.push(`Cliente: ${cliente}`);
        if(localidade) bodyParts.push(`Localidade: ${localidade}`);
        if(tipoServico) bodyParts.push(`Serviço: ${tipoServico}`);

        const body = bodyParts.length ? bodyParts.join(" • ") : `OS #${osId}`;

        let enviados = 0;
        let falhas = 0;

        for(const item of tokens){
            try {
                await admin.messaging().send({
                    token: item.token_fcm,

                    notification: {
                        title: "🚨 Nova Ordem de Serviço",
                        body
                    },

                    data: {
                        tipo: "nova_os",
                        os_id: String(osId),
                        url: `/appmobile.html?os_id=${osId}`,
                        click_action: "OPEN_OS"
                    },

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
                });

                enviados++;
            } catch(err){
                falhas++;
                console.error("Erro ao enviar push FCM:", err.message);

                if(
                    err.code === "messaging/registration-token-not-registered" ||
                    err.code === "messaging/invalid-registration-token"
                ){
                    await desativarToken(item.id);
                }
            }
        }

        return { enviados, falhas };
    }

    return {
        enviarPushNovaOS
    };
};
