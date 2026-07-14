const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const crypto = require("crypto");

const sessions = {};
const qrs = {};
const jobs = {};

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

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

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: empresaId }),
        puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] }
    });

    client.on("qr", qr => { qrs[empresaId] = qr; });
    client.on("ready", () => { delete qrs[empresaId]; console.log(`✅ WhatsApp conectado empresa ${empresaId}`); });
    client.on("auth_failure", msg => console.error(`❌ WhatsApp auth empresa ${empresaId}:`, msg));
    client.on("disconnected", () => { delete sessions[empresaId]; delete qrs[empresaId]; });
    client.initialize().catch(err => { console.error("Falha ao iniciar WhatsApp:", err.message); delete sessions[empresaId]; });
    sessions[empresaId] = client;
    return client;
}

function getCliente(empresaId) {
    return sessions[String(empresaId)] || criarSessao(empresaId);
}

async function obterChatId(client, telefone) {
    const numero = formatarNumero(telefone);
    if (!numero) throw new Error("Telefone não informado");
    const numberId = await client.getNumberId(numero);
    if (!numberId) throw new Error("Número não possui WhatsApp");
    return numberId._serialized;
}

async function enviarMensagem(empresaId, telefone, mensagem) {
    try {
        const client = getCliente(empresaId);
        if (!client?.info) return { ok: false, error: "offline" };
        const chatId = await obterChatId(client, telefone);
        await client.sendMessage(chatId, String(mensagem || "").trim());
        return { ok: true };
    } catch (err) {
        return { ok: false, error: "send_failed", detail: err.message };
    }
}

async function enviarMidia(empresaId, telefone, arquivo, nomeArquivo, legenda = "") {
    const client = getCliente(empresaId);
    if (!client?.info) throw new Error(`WhatsApp da empresa ${empresaId} está desconectado`);
    const chatId = await obterChatId(client, telefone);
    const buffer = Buffer.isBuffer(arquivo) ? arquivo : arquivo?.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length < 100) throw new Error("Arquivo PDF inválido");

    const media = new MessageMedia("application/pdf", buffer.toString("base64"), nomeArquivo || "relatorio.pdf");
    await client.sendMessage(chatId, media, { caption: legenda || "Relatório automático SGOS" });
    return { ok: true };
}

function criarJobEnvio({ empresaId, contatos, mensagem, intervaloSegundos = 45 }) {
    const lista = Array.isArray(contatos) ? contatos.slice(0, 10) : [];
    if (!lista.length) throw new Error("Nenhum contato informado.");
    const intervalo = Math.max(45, Number(intervaloSegundos) || 45);
    const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    const job = { id, empresaId: String(empresaId), status: "processando", total: lista.length, processados: 0, enviados: 0, falhas: 0, resultados: [] };
    jobs[id] = job;
    (async () => {
        for (let i = 0; i < lista.length; i++) {
            const r = await enviarMensagem(empresaId, lista[i].telefone, mensagem);
            job.processados++; r.ok ? job.enviados++ : job.falhas++;
            job.resultados.push({ ...lista[i], ok: Boolean(r.ok), erro: r.error || null });
            if (i < lista.length - 1) await esperar(intervalo * 1000);
        }
        job.status = "concluido";
        setTimeout(() => delete jobs[id], 86400000).unref?.();
    })();
    return job;
}

const obterJob = id => jobs[id] || null;

module.exports = { criarSessao, getCliente, enviarMensagem, enviarMidia, criarJobEnvio, obterJob, formatarNumero, sessions, qrs, jobs };
