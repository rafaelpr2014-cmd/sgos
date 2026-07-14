const { Client, LocalAuth } = require("whatsapp-web.js");
const crypto = require("crypto");

const sessions = {};
const qrs = {};
const jobs = {};

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatarNumero(numero) {
    if (!numero) return null;
    let limpo = String(numero).replace(/\D/g, "");
    if (limpo.startsWith("0")) limpo = limpo.substring(1);
    if (!limpo.startsWith("55")) limpo = "55" + limpo;
    return limpo;
}

function criarSessao(empresaId) {
    empresaId = String(empresaId || "").trim();
    if (!empresaId) return null;
    if (sessions[empresaId]) return sessions[empresaId];

    try {
        const client = new Client({
            authStrategy: new LocalAuth({ clientId: empresaId }),
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

        client.on("qr", qr => {
            console.log(`📲 QR gerado empresa ${empresaId}`);
            qrs[empresaId] = qr;
        });

        client.on("ready", () => {
            console.log(`✅ WhatsApp conectado empresa ${empresaId}`);
            delete qrs[empresaId];
        });

        client.on("auth_failure", msg => {
            console.log(`❌ Auth failure empresa ${empresaId}:`, msg);
        });

        client.on("disconnected", reason => {
            console.log(`❌ Whats desconectado empresa ${empresaId}:`, reason);
            delete sessions[empresaId];
            delete qrs[empresaId];
        });

        client.initialize().catch(err => {
            console.log("⚠️ Falha ao iniciar WhatsApp:", err.message);
            delete sessions[empresaId];
        });

        sessions[empresaId] = client;
        return client;
    } catch (err) {
        console.log("❌ Erro criando sessão Whats:", err.message);
        return null;
    }
}

function getCliente(empresaId) {
    return sessions[String(empresaId)] || criarSessao(empresaId);
}

async function enviarMensagem(empresaId, telefone, mensagem) {
    try {
        const client = getCliente(empresaId);
        if (!client || !client.info) return { ok: false, error: "offline" };
        if (!telefone) return { ok: false, error: "no_phone" };
        if (!mensagem || !String(mensagem).trim()) return { ok: false, error: "empty_message" };

        const numeroFormatado = formatarNumero(telefone);
        let numberId;
        try {
            numberId = await client.getNumberId(numeroFormatado);
        } catch (e) {
            console.log("⚠️ getNumberId falhou:", e.message);
            return { ok: false, error: "number_error" };
        }

        if (!numberId) return { ok: false, error: "not_exists" };
        await client.sendMessage(numberId._serialized, String(mensagem).trim());
        console.log("✅ Whats enviado:", numeroFormatado);
        return { ok: true, numero: numeroFormatado };
    } catch (err) {
        console.log("❌ Erro WhatsApp:", err.message);
        return { ok: false, error: "send_failed", detail: err.message };
    }
}

function criarJobEnvio({ empresaId, contatos, mensagem, intervaloSegundos = 45 }) {
    const lista = Array.isArray(contatos) ? contatos.slice(0, 10) : [];
    if (!lista.length) throw new Error("Nenhum contato informado.");
    if (contatos.length > 10) throw new Error("O limite é de 10 contatos por lote.");

    const intervalo = Math.max(45, Number(intervaloSegundos) || 45);
    const jobId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    const job = {
        id: jobId,
        empresaId: String(empresaId),
        status: "processando",
        criadoEm: new Date().toISOString(),
        total: lista.length,
        processados: 0,
        enviados: 0,
        falhas: 0,
        intervaloSegundos: intervalo,
        proximoEnvioEm: 0,
        resultados: []
    };
    jobs[jobId] = job;

    (async () => {
        for (let i = 0; i < lista.length; i++) {
            const contato = lista[i] || {};
            job.proximoEnvioEm = 0;
            const resultado = await enviarMensagem(empresaId, contato.telefone, mensagem);
            job.processados += 1;
            if (resultado.ok) job.enviados += 1;
            else job.falhas += 1;
            job.resultados.push({
                id: contato.id || null,
                nome: contato.nome || "Cliente",
                telefone: contato.telefone || "",
                ok: Boolean(resultado.ok),
                erro: resultado.error || null,
                enviadoEm: new Date().toISOString()
            });

            if (i < lista.length - 1) {
                for (let restante = intervalo; restante > 0; restante--) {
                    job.proximoEnvioEm = restante;
                    await esperar(1000);
                }
            }
        }
        job.proximoEnvioEm = 0;
        job.status = "concluido";
        job.concluidoEm = new Date().toISOString();
        setTimeout(() => delete jobs[jobId], 24 * 60 * 60 * 1000).unref?.();
    })().catch(err => {
        console.error("Erro na fila WhatsApp:", err);
        job.status = "concluido";
        job.erro = err.message;
        job.concluidoEm = new Date().toISOString();
    });

    return job;
}

function obterJob(jobId) {
    return jobs[jobId] || null;
}

module.exports = {
    criarSessao,
    getCliente,
    enviarMensagem,
    criarJobEnvio,
    obterJob,
    formatarNumero,
    sessions,
    qrs,
    jobs
};
