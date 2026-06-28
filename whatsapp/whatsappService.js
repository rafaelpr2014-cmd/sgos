const { Client, LocalAuth } = require("whatsapp-web.js");

// ===============================
// SESSÕES
// ===============================
const sessions = {};
const qrs = {};

// ===============================
// FORMATAR TELEFONE
// ===============================
function formatarNumero(numero) {

    if (!numero) return null;

    numero = numero
        .toString()
        .replace(/\D/g, "");

    // remove 0 inicial
    if (numero.startsWith("0")) {
        numero = numero.substring(1);
    }

    // adiciona 55
    if (!numero.startsWith("55")) {
        numero = "55" + numero;
    }

    return numero;
}

// ===============================
// CRIAR SESSÃO
// ===============================
function criarSessao(empresaId) {

    // já existe
    if (sessions[empresaId]) {
        return sessions[empresaId];
    }

    try {

        const client = new Client({

            authStrategy: new LocalAuth({
                clientId: String(empresaId)
            }),

            puppeteer: {

                headless: true,

                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu"
                ]

            }

        });

        // ===============================
        // QR CODE
        // ===============================
        client.on("qr", (qr) => {

            console.log(
                `📲 QR gerado empresa ${empresaId}`
            );

            qrs[empresaId] = qr;

        });

        // ===============================
        // READY
        // ===============================
        client.on("ready", () => {

            console.log(
                `✅ WhatsApp conectado empresa ${empresaId}`
            );

        });

        // ===============================
        // AUTH FAIL
        // ===============================
        client.on("auth_failure", (msg) => {

            console.log(
                `❌ Auth failure empresa ${empresaId}:`,
                msg
            );

        });

        // ===============================
        // DISCONNECTED
        // ===============================
        client.on("disconnected", (reason) => {

            console.log(
                `❌ Whats desconectado empresa ${empresaId}:`,
                reason
            );

            delete sessions[empresaId];
            delete qrs[empresaId];

        });

        // ===============================
        // INIT PROTEGIDO
        // ===============================
        client.initialize().catch((err) => {

            console.log(
                "⚠️ Falha ao iniciar WhatsApp:",
                err.message
            );

            delete sessions[empresaId];

        });

        sessions[empresaId] = client;

        return client;

    } catch (err) {

        console.log(
            "❌ Erro criando sessão Whats:",
            err.message
        );

        return null;

    }
}

// ===============================
// OBTER CLIENTE
// ===============================
function getCliente(empresaId) {

    if (sessions[empresaId]) {
        return sessions[empresaId];
    }

    return criarSessao(empresaId);
}

// ===============================
// ENVIAR MENSAGEM
// ===============================
async function enviarMensagem(
    empresaId,
    telefone,
    mensagem
) {

    try {

        const client =
        getCliente(empresaId);

        // ===============================
        // CLIENTE OFFLINE
        // ===============================
        if (
            !client ||
            !client.info
        ) {

            console.log(
                "⚠️ WhatsApp offline"
            );

            return {
                ok: false,
                error: "offline"
            };

        }

        // ===============================
        // TELEFONE VAZIO
        // ===============================
        if (!telefone) {

            console.log(
                "⚠️ Telefone vazio"
            );

            return {
                ok: false,
                error: "no_phone"
            };

        }

        const numeroFormatado =
        formatarNumero(telefone);

        // ===============================
        // VALIDAR NÚMERO
        // ===============================
        let numberId = null;

        try {

            numberId =
            await client.getNumberId(
                numeroFormatado
            );

        } catch (e) {

            console.log(
                "⚠️ getNumberId falhou:",
                e.message
            );

            return {
                ok: false,
                error: "number_error"
            };

        }

        // ===============================
        // NÃO EXISTE WHATS
        // ===============================
        if (!numberId) {

            console.log(
                "⚠️ Número sem Whats:",
                numeroFormatado
            );

            return {
                ok: false,
                error: "not_exists"
            };

        }

        // ===============================
        // ENVIO
        // ===============================
        await client.sendMessage(
            numberId._serialized,
            mensagem
        );

        console.log(
            "✅ Whats enviado:",
            numeroFormatado
        );

        return {
            ok: true
        };

    } catch (err) {

        console.log(
            "❌ Erro WhatsApp:",
            err.message
        );

        // 🔥 NÃO DERRUBA SISTEMA
        return {
            ok: false,
            error: "send_failed"
        };

    }
}

// ===============================
// EXPORTS
// ===============================
module.exports = {

    criarSessao,
    getCliente,
    enviarMensagem,

    sessions,
    qrs

};