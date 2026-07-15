const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const crypto = require("crypto");

const CENTRAL_EMPRESA_ID = "1";
const CENTRAL_SESSION_KEY = "sgos-central";

const sessions = {};
const qrs = {};
const jobs = {};
const logs = [];

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

function registrarLog(tipo, mensagem, detalhes = {}) {
    const item = {
        id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString("hex"),
        tipo,
        mensagem,
        detalhes,
        criadoEm: new Date().toISOString()
    };
    logs.unshift(item);
    if (logs.length > 300) logs.length = 300;
    return item;
}

function listarLogs({ limite = 100, escopo, empresaId } = {}) {
    return logs
        .filter(item => !escopo || item.detalhes?.escopo === escopo)
        .filter(item => !empresaId || String(item.detalhes?.empresaId || "") === String(empresaId))
        .slice(0, Math.min(Math.max(Number(limite) || 100, 1), 300));
}

function formatarNumero(numero) {
    if (!numero) return null;
    let limpo = String(numero).replace(/\D/g, "");
    if (limpo.startsWith("0")) limpo = limpo.substring(1);
    if (!limpo.startsWith("55")) limpo = "55" + limpo;
    return limpo;
}

function chaveSessaoCliente(empresaId) {
    const id = String(empresaId || "").trim();
    if (!id) throw new Error("Empresa não informada.");
    return `cliente-${id}`;
}

function resolverChaveSessao({ tipo = "cliente", empresaId } = {}) {
    return tipo === "central" ? CENTRAL_SESSION_KEY : chaveSessaoCliente(empresaId);
}

function criarSessao({ tipo = "cliente", empresaId } = {}) {
    const chave = resolverChaveSessao({ tipo, empresaId });
    const empresaLog = tipo === "central" ? CENTRAL_EMPRESA_ID : String(empresaId);

    if (sessions[chave]) return sessions[chave];

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: chave }),
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
        qrs[chave] = qr;
        registrarLog("info", "QR Code gerado.", { escopo: tipo, empresaId: empresaLog });
    });

    client.on("authenticated", () => {
        registrarLog("sucesso", "WhatsApp autenticado.", { escopo: tipo, empresaId: empresaLog });
    });

    client.on("ready", () => {
        delete qrs[chave];
        registrarLog("sucesso", "WhatsApp conectado e pronto para envio.", { escopo: tipo, empresaId: empresaLog });
        console.log(`✅ WhatsApp ${tipo} conectado: ${chave}`);
    });

    client.on("auth_failure", msg => {
        registrarLog("erro", "Falha de autenticação do WhatsApp.", { escopo: tipo, empresaId: empresaLog, motivo: msg });
        console.error(`❌ Falha de autenticação ${chave}:`, msg);
    });

    client.on("disconnected", reason => {
        registrarLog("alerta", "WhatsApp desconectado.", { escopo: tipo, empresaId: empresaLog, motivo: reason });
        delete sessions[chave];
        delete qrs[chave];
    });

    client.initialize().catch(err => {
        registrarLog("erro", "Falha ao iniciar a sessão do WhatsApp.", { escopo: tipo, empresaId: empresaLog, erro: err.message });
        delete sessions[chave];
        delete qrs[chave];
        console.error(`❌ Falha ao iniciar ${chave}:`, err.message);
    });

    sessions[chave] = client;
    return client;
}

function criarSessaoCentral() {
    return criarSessao({ tipo: "central", empresaId: CENTRAL_EMPRESA_ID });
}

function criarSessaoCliente(empresaId) {
    return criarSessao({ tipo: "cliente", empresaId });
}

function getClienteCentral() {
    return sessions[CENTRAL_SESSION_KEY] || criarSessaoCentral();
}

function getClienteEmpresa(empresaId) {
    const chave = chaveSessaoCliente(empresaId);
    return sessions[chave] || criarSessaoCliente(empresaId);
}

function obterStatus({ tipo = "cliente", empresaId } = {}) {
    const chave = resolverChaveSessao({ tipo, empresaId });
    const client = sessions[chave];
    if (!client) return { status: "desconectado", conectado: false };
    if (client.info) {
        return {
            status: "conectado",
            conectado: true,
            numero: client.info?.wid?.user || null,
            nome: client.info?.pushname || null
        };
    }
    return { status: qrs[chave] ? "aguardando_qr" : "iniciando", conectado: false };
}

function obterQr({ tipo = "cliente", empresaId } = {}) {
    const chave = resolverChaveSessao({ tipo, empresaId });
    return qrs[chave] || null;
}

async function desconectarSessao({ tipo = "cliente", empresaId, apagarAutenticacao = true } = {}) {
    const chave = resolverChaveSessao({ tipo, empresaId });
    const client = sessions[chave];
    const empresaLog = tipo === "central" ? CENTRAL_EMPRESA_ID : String(empresaId);

    if (!client) {
        delete qrs[chave];
        return { ok: true, status: "desconectado" };
    }

    try {
        if (apagarAutenticacao && typeof client.logout === "function") await client.logout();
        else if (typeof client.destroy === "function") await client.destroy();
    } catch (err) {
        registrarLog("alerta", "Sessão encerrada com ressalva.", { escopo: tipo, empresaId: empresaLog, erro: err.message });
    } finally {
        delete sessions[chave];
        delete qrs[chave];
    }

    registrarLog("info", "Sessão do WhatsApp desconectada manualmente.", { escopo: tipo, empresaId: empresaLog });
    return { ok: true, status: "desconectado" };
}

async function obterChatId(client, telefone) {
    const numero = formatarNumero(telefone);
    if (!numero) throw new Error("Telefone não informado.");
    const numberId = await client.getNumberId(numero);
    if (!numberId) throw new Error("Número não possui WhatsApp.");
    return { chatId: numberId._serialized, numero };
}

async function enviarTextoComCliente(client, telefone, mensagem) {
    if (!client?.info) return { ok: false, error: "offline" };
    if (!String(mensagem || "").trim()) return { ok: false, error: "empty_message" };
    const { chatId, numero } = await obterChatId(client, telefone);
    await client.sendMessage(chatId, String(mensagem).trim());
    return { ok: true, numero };
}

// Usado pelos envios manuais e informativos da própria empresa cliente.
async function enviarMensagem(empresaId, telefone, mensagem) {
    try {
        const resultado = await enviarTextoComCliente(getClienteEmpresa(empresaId), telefone, mensagem);
        registrarLog(resultado.ok ? "sucesso" : "erro", resultado.ok ? "Mensagem manual enviada." : "Falha no envio manual.", {
            escopo: "cliente", empresaId: String(empresaId), telefone: formatarNumero(telefone), erro: resultado.error || null
        });
        return resultado;
    } catch (err) {
        registrarLog("erro", "Erro no envio manual.", { escopo: "cliente", empresaId: String(empresaId), erro: err.message });
        return { ok: false, error: "send_failed", detail: err.message };
    }
}

// Usado pelo WhatsApp exclusivo do SGOS.
async function enviarMensagemCentral(telefone, mensagem) {
    try {
        const resultado = await enviarTextoComCliente(getClienteCentral(), telefone, mensagem);
        registrarLog(resultado.ok ? "sucesso" : "erro", resultado.ok ? "Mensagem central enviada." : "Falha no envio central.", {
            escopo: "central", empresaId: CENTRAL_EMPRESA_ID, telefone: formatarNumero(telefone), erro: resultado.error || null
        });
        return resultado;
    } catch (err) {
        registrarLog("erro", "Erro no envio central.", { escopo: "central", empresaId: CENTRAL_EMPRESA_ID, erro: err.message });
        return { ok: false, error: "send_failed", detail: err.message };
    }
}

// Mantém o nome esperado pelo serviço de relatórios automáticos, mas força a sessão central.
async function enviarMidia(_empresaIdIgnorada, telefone, arquivo, nomeArquivo, legenda = "") {
    const client = getClienteCentral();
    if (!client?.info) throw new Error("WhatsApp central do SGOS está desconectado.");

    const { chatId, numero } = await obterChatId(client, telefone);
    const buffer = Buffer.isBuffer(arquivo) ? arquivo : arquivo?.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length < 100) throw new Error("Arquivo PDF inválido.");

    const media = new MessageMedia("application/pdf", buffer.toString("base64"), nomeArquivo || "relatorio.pdf");
    await client.sendMessage(chatId, media, { caption: legenda || "Relatório automático SGOS" });
    registrarLog("sucesso", "Relatório automático enviado.", {
        escopo: "central", empresaId: CENTRAL_EMPRESA_ID, telefone: numero, arquivo: nomeArquivo || "relatorio.pdf"
    });
    return { ok: true, numero };
}

function criarJobEnvio({ empresaId, contatos, mensagem, intervaloSegundos = 45 }) {
    const lista = Array.isArray(contatos) ? contatos.slice(0, 10) : [];
    if (!lista.length) throw new Error("Nenhum contato informado.");
    if (contatos.length > 10) throw new Error("O limite é de 10 contatos por lote.");

    const intervalo = Math.max(45, Number(intervaloSegundos) || 45);
    const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    const job = {
        id,
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
    jobs[id] = job;

    (async () => {
        for (let i = 0; i < lista.length; i++) {
            const contato = lista[i] || {};
            const resultado = await enviarMensagem(empresaId, contato.telefone, mensagem);
            job.processados++;
            resultado.ok ? job.enviados++ : job.falhas++;
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
        setTimeout(() => delete jobs[id], 86400000).unref?.();
    })().catch(err => {
        job.status = "erro";
        job.erro = err.message;
        job.concluidoEm = new Date().toISOString();
    });

    return job;
}

const obterJob = id => jobs[id] || null;

module.exports = {
    CENTRAL_EMPRESA_ID,
    CENTRAL_SESSION_KEY,
    criarSessao,
    criarSessaoCentral,
    criarSessaoCliente,
    getClienteCentral,
    getClienteEmpresa,
    obterStatus,
    obterQr,
    desconectarSessao,
    enviarMensagem,
    enviarMensagemCentral,
    enviarMidia,
    criarJobEnvio,
    obterJob,
    formatarNumero,
    listarLogs,
    registrarLog,
    sessions,
    qrs,
    jobs
};
