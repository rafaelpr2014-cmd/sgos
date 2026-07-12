const iniciarFirebase = require("./firebase");
const apn = require("apn");
const fs = require("fs");

let apnProvider = null;

function normalizarPlataforma(plataforma) {
    return String(plataforma || "")
        .toLowerCase()
        .trim();
}

function normalizarBooleano(valor, padrao = true) {
    if (valor === undefined || valor === null || valor === "") {
        return padrao;
    }

    return ["true", "1", "yes", "sim", "production", "producao"].includes(
        String(valor).toLowerCase().trim()
    );
}

function getApnConfig() {
    const keyPath =
        process.env.APNS_KEY_PATH ||
        "/root/sgos/AuthKey_6C6YKTG24P.p8";

    const keyId =
        process.env.APNS_KEY_ID ||
        "6C6YKTG24P";

    const teamId =
        process.env.APNS_TEAM_ID ||
        "T7VMAXZY78";

    const bundleId =
        process.env.APNS_BUNDLE_ID ||
        "com.sgos.mobile";

    /*
     * TestFlight e App Store usam APNs Production.
     *
     * A nova chave foi configurada para Sandbox & Production,
     * mas o token atual do TestFlight deve ser enviado pelo
     * endpoint de produção.
     */
    const production = normalizarBooleano(
        process.env.APNS_PRODUCTION,
        true
    );

    return {
        keyPath,
        keyId,
        teamId,
        bundleId,
        production
    };
}

function getApnProvider() {
    if (apnProvider) {
        return apnProvider;
    }

    const cfg = getApnConfig();

    if (!fs.existsSync(cfg.keyPath)) {
        throw new Error(
            `Arquivo APNs .p8 não encontrado em ${cfg.keyPath}`
        );
    }

    apnProvider = new apn.Provider({
        token: {
            key: cfg.keyPath,
            keyId: cfg.keyId,
            teamId: cfg.teamId
        },
        production: cfg.production
    });

    console.log("APNs inicializado:", {
        keyPath: cfg.keyPath,
        keyId: cfg.keyId,
        teamId: cfg.teamId,
        bundleId: cfg.bundleId,
        ambiente: cfg.production ? "production" : "sandbox"
    });

    return apnProvider;
}

function limparToken(token) {
    return String(token || "")
        .replace(/[<>\s]/g, "")
        .trim();
}

function pareceTokenApns(token) {
    return /^[0-9a-fA-F]{64}$/.test(limparToken(token));
}

module.exports = (pool) => {
    async function buscarTokens(usuarioId, empresaId) {
        const [rows] = await pool.query(
            `
            SELECT
                id,
                token_fcm,
                plataforma
            FROM usuarios_push_tokens
            WHERE usuario_id = ?
              AND empresa_id = ?
              AND ativo = 1
            `,
            [usuarioId, empresaId]
        );

        return rows;
    }

    async function buscarTokensEmpresa(empresaId) {
        const [rows] = await pool.query(
            `
            SELECT
                id,
                token_fcm,
                plataforma
            FROM usuarios_push_tokens
            WHERE empresa_id = ?
              AND ativo = 1
            `,
            [empresaId]
        );

        return rows;
    }

    async function desativarToken(id) {
        await pool.query(
            `
            UPDATE usuarios_push_tokens
            SET
                ativo = 0,
                atualizado_em = NOW()
            WHERE id = ?
            `,
            [id]
        );
    }

    function montarPayloadOS({
        osId,
        cliente,
        localidade,
        tipoServico
    }) {
        const bodyParts = [];

        if (cliente) {
            bodyParts.push(`Cliente: ${cliente}`);
        }

        if (localidade) {
            bodyParts.push(`Localidade: ${localidade}`);
        }

        if (tipoServico) {
            bodyParts.push(`Serviço: ${tipoServico}`);
        }

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
                }
            }
        };
    }

    async function enviarFcm(item, payload) {
        const admin = iniciarFirebase();

        if (!admin) {
            const erro = new Error(
                "Firebase ainda não configurado"
            );

            erro.code = "firebase_nao_configurado";
            throw erro;
        }

        const tokenFcm = limparToken(item.token_fcm);

        if (!tokenFcm) {
            const erro = new Error("Token FCM vazio");
            erro.code = "token_fcm_vazio";
            throw erro;
        }

        const resposta = await admin.messaging().send({
            token: tokenFcm,
            ...payload.fcm
        });

        return resposta;
    }

    async function enviarApns(item, payload) {
        const cfg = getApnConfig();
        const provider = getApnProvider();

        const tokenApns = limparToken(item.token_fcm);

        if (!pareceTokenApns(tokenApns)) {
            const erro = new Error(
                "Token APNs inválido: esperado token hexadecimal de 64 caracteres"
            );

            erro.code = "apns/token_invalido";
            throw erro;
        }

        const note = new apn.Notification();

        note.topic = cfg.bundleId;
        note.expiry = Math.floor(Date.now() / 1000) + 3600;
        note.priority = 10;
        note.pushType = "alert";
        note.sound = "default";
        note.badge = 1;

        note.alert = {
            title: payload.title,
            body: payload.body
        };

        note.payload = {
            ...payload.data
        };

        note.category = "OPEN_OS";

        const resultado = await provider.send(
            note,
            tokenApns
        );

        if (
            resultado.sent &&
            resultado.sent.length > 0
        ) {
            return {
                enviado: true,
                ambiente: cfg.production
                    ? "production"
                    : "sandbox"
            };
        }

        const falha =
            resultado.failed &&
            resultado.failed.length
                ? resultado.failed[0]
                : null;

        const motivo =
            falha?.response?.reason ||
            falha?.error?.message ||
            "Falha APNs";

        const status =
            falha?.status ||
            falha?.response?.statusCode ||
            null;

        const erro = new Error(motivo);

        erro.code = `apns/${motivo}`;
        erro.status = status;
        erro.apns = falha;

        throw erro;
    }

    async function enviarParaTokens(tokens, payload) {
        if (!Array.isArray(tokens) || !tokens.length) {
            return {
                enviados: 0,
                falhas: 0,
                erro: "sem_tokens",
                detalhes: []
            };
        }

        let enviados = 0;
        let falhas = 0;

        const detalhes = [];

        for (const item of tokens) {
            const plataforma =
                normalizarPlataforma(item.plataforma);

            const tokenLimpo =
                limparToken(item.token_fcm);

            const tokenEhApns =
                pareceTokenApns(tokenLimpo);

            try {
                if (
                    plataforma === "ios" &&
                    tokenEhApns
                ) {
                    await enviarApns(item, payload);
                } else {
                    /*
                     * Android, Web e eventual iOS com token FCM
                     * continuam sendo enviados pelo Firebase Admin.
                     */
                    await enviarFcm(item, payload);
                }

                enviados++;

                detalhes.push({
                    token_id: item.id,
                    plataforma: item.plataforma,
                    provedor:
                        plataforma === "ios" &&
                        tokenEhApns
                            ? "apns"
                            : "firebase",
                    ok: true
                });
            } catch (err) {
                falhas++;

                const detalhe = {
                    token_id: item.id,
                    plataforma: item.plataforma,
                    provedor:
                        plataforma === "ios" &&
                        tokenEhApns
                            ? "apns"
                            : "firebase",
                    ok: false,
                    code:
                        err.code ||
                        "erro_push",
                    message:
                        err.message ||
                        "Erro desconhecido no push"
                };

                if (err.status) {
                    detalhe.status = err.status;
                }

                detalhes.push(detalhe);

                console.error(
                    "Erro ao enviar push:",
                    detalhe
                );

                const code = String(
                    err.code || ""
                );

                const message = String(
                    err.message || ""
                );

                const deveDesativar =
                    code ===
                        "messaging/registration-token-not-registered" ||
                    code ===
                        "messaging/invalid-registration-token" ||
                    code ===
                        "messaging/invalid-argument" ||
                    message ===
                        "BadDeviceToken" ||
                    message ===
                        "Unregistered" ||
                    err.status === 410;

                if (deveDesativar) {
                    try {
                        await desativarToken(item.id);

                        console.warn(
                            `Token push ${item.id} desativado por ser inválido ou não registrado`
                        );
                    } catch (erroDesativacao) {
                        console.error(
                            `Erro ao desativar token ${item.id}:`,
                            erroDesativacao
                        );
                    }
                }
            }
        }

        return {
            enviados,
            falhas,
            detalhes
        };
    }

    async function enviarPushOSAndamento({
        usuarioId,
        empresaId,
        osId,
        cliente,
        localidade,
        tipoServico
    }) {
        const tokens = await buscarTokens(
            usuarioId,
            empresaId
        );

        const payload = montarPayloadOS({
            osId,
            cliente,
            localidade,
            tipoServico
        });

        return enviarParaTokens(
            tokens,
            payload
        );
    }

    async function enviarPushOSEmpresa({
        empresaId,
        osId,
        cliente,
        localidade,
        tipoServico
    }) {
        const tokens =
            await buscarTokensEmpresa(empresaId);

        const payload = montarPayloadOS({
            osId,
            cliente,
            localidade,
            tipoServico
        });

        return enviarParaTokens(
            tokens,
            payload
        );
    }

    async function encerrarApns() {
        if (!apnProvider) {
            return;
        }

        try {
            apnProvider.shutdown();
        } finally {
            apnProvider = null;
        }
    }

    return {
        buscarTokens,
        buscarTokensEmpresa,
        enviarPushOSAndamento,
        enviarPushOSEmpresa,
        enviarPushNovaOS:
            enviarPushOSAndamento,
        encerrarApns
    };
};