"use strict";

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const crypto = require("crypto");

const CENTRAL_EMPRESA_ID = "1";
const CENTRAL_SESSION_KEY = "sgos-central";

// Estes objetos existem apenas neste módulo. O arquivo whatsapp/whatsappService.js
// apenas redireciona para cá, evitando duas instâncias concorrentes.
const sessions = Object.create(null);
const qrs = Object.create(null);
const jobs = Object.create(null);
const logs = [];
const estados = Object.create(null);
const inicializacoes = Object.create(null);

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
    if (!limpo.startsWith("55")) limpo = `55${limpo}`;
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

function dadosEscopo(tipo, empresaId) {
    return {
        escopo: tipo,
        empresaId: tipo === "central" ? CENTRAL_EMPRESA_ID : String(empresaId)
    };
}

function erroNavegadorInvalido(err) {
    const texto = String(err?.message || err || "").toLowerCase();
    return [
        "detached frame",
        "execution context was destroyed",
        "target closed",
        "session closed",
        "protocol error",
        "most likely the page has been closed",
        "cannot find context with specified id"
    ].some(trecho => texto.includes(trecho));
}

async function destruirCliente(chave, motivo = "Sessão inválida") {
    const client = sessions[chave];
    delete sessions[chave];
    delete qrs[chave];
    delete inicializacoes[chave];
    estados[chave] = { status: "desconectado", conectado: false, motivo };

    if (client && typeof client.destroy === "function") {
        try {
            await client.destroy();
        } catch (_) {}
    }
}

function criarSessao({ tipo = "cliente", empresaId } = {}) {
    const chave = resolverChaveSessao({ tipo, empresaId });
    const escopo = dadosEscopo(tipo, empresaId);

    if (sessions[chave]) return sessions[chave];

    estados[chave] = { status: "iniciando", conectado: false };

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

    sessions[chave] = client;

    client.on("qr", qr => {
        qrs[chave] = qr;
        estados[chave] = { status: "aguardando_qr", conectado: false };
        registrarLog("info", "QR Code gerado.", escopo);
    });

    client.on("authenticated", () => {
        estados[chave] = { status: "autenticado", conectado: false };
        registrarLog("sucesso", "WhatsApp autenticado.", escopo);
    });

    client.on("ready", () => {
        delete qrs[chave];
        estados[chave] = {
            status: "conectado",
            conectado: true,
            numero: client.info?.wid?.user || null,
            nome: client.info?.pushname || null
        };
        registrarLog("sucesso", "WhatsApp conectado e pronto para envio.", escopo);
        console.log(`✅ WhatsApp ${tipo} conectado: ${chave}`);
    });

    client.on("auth_failure", async msg => {
        estados[chave] = { status: "falha_autenticacao", conectado: false, erro: msg };
        registrarLog("erro", "Falha de autenticação do WhatsApp.", { ...escopo, motivo: msg });
        console.error(`❌ Falha de autenticação ${chave}:`, msg);
        await destruirCliente(chave, "Falha de autenticação");
    });

    client.on("disconnected", async reason => {
        registrarLog("alerta", "WhatsApp desconectado.", { ...escopo, motivo: reason });
        await destruirCliente(chave, reason || "Desconectado");
    });

    inicializacoes[chave] = client.initialize()
        .catch(async err => {
            registrarLog("erro", "Falha ao iniciar a sessão do WhatsApp.", { ...escopo, erro: err.message });
            console.error(`❌ Falha ao iniciar ${chave}:`, err.message);
            await destruirCliente(chave, err.message);
            throw err;
        })
        .finally(() => {
            delete inicializacoes[chave];
        });

    // Evita rejeição não tratada quando a criação foi disparada por uma rota de status.
    inicializacoes[chave].catch(() => {});

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

async function estadoRealCliente(client) {
    if (!client) return null;
    try {
        return await client.getState();
    } catch (err) {
        if (erroNavegadorInvalido(err)) throw err;
        return null;
    }
}

async function obterStatus({ tipo = "cliente", empresaId } = {}) {
    const chave = resolverChaveSessao({ tipo, empresaId });
    const client = sessions[chave];

    if (!client) {
        return estados[chave] || { status: "desconectado", conectado: false };
    }

    try {
        const state = await estadoRealCliente(client);
        if (state === "CONNECTED") {
            const status = {
                status: "conectado",
                conectado: true,
                numero: client.info?.wid?.user || estados[chave]?.numero || null,
                nome: client.info?.pushname || estados[chave]?.nome || null
            };
            estados[chave] = status;
            return status;
        }

        if (qrs[chave]) return { status: "aguardando_qr", conectado: false };
        return estados[chave] || { status: String(state || "iniciando").toLowerCase(), conectado: false };
    } catch (err) {
        if (erroNavegadorInvalido(err)) {
            registrarLog("erro", "A sessão perdeu a página do navegador e foi invalidada.", {
                ...dadosEscopo(tipo, empresaId),
                erro: err.message
            });
            await destruirCliente(chave, err.message);
        }
        return { status: "desconectado", conectado: false, erro: err.message };
    }
}

function obterQr({ tipo = "cliente", empresaId } = {}) {
    const chave = resolverChaveSessao({ tipo, empresaId });
    return qrs[chave] || null;
}

async function desconectarSessao({ tipo = "cliente", empresaId, apagarAutenticacao = true } = {}) {
    const chave = resolverChaveSessao({ tipo, empresaId });
    const client = sessions[chave];
    const escopo = dadosEscopo(tipo, empresaId);

    if (!client) {
        delete qrs[chave];
        estados[chave] = { status: "desconectado", conectado: false };
        return { ok: true, status: "desconectado" };
    }

    try {
        if (apagarAutenticacao && typeof client.logout === "function") await client.logout();
        else if (typeof client.destroy === "function") await client.destroy();
    } catch (err) {
        registrarLog("alerta", "Sessão encerrada com ressalva.", { ...escopo, erro: err.message });
    } finally {
        delete sessions[chave];
        delete qrs[chave];
        delete inicializacoes[chave];
        estados[chave] = { status: "desconectado", conectado: false };
    }

    registrarLog("info", "Sessão do WhatsApp desconectada manualmente.", escopo);
    return { ok: true, status: "desconectado" };
}

async function obterClientePronto({ tipo, empresaId, timeoutMs = 15000 }) {
    const chave = resolverChaveSessao({ tipo, empresaId });
    const client = tipo === "central" ? getClienteCentral() : getClienteEmpresa(empresaId);
    const limite = Date.now() + timeoutMs;

    while (Date.now() < limite) {
        try {
            const state = await estadoRealCliente(client);
            if (state === "CONNECTED") return client;
        } catch (err) {
            if (erroNavegadorInvalido(err)) {
                await destruirCliente(chave, err.message);
                throw new Error(tipo === "central"
                    ? "A sessão do WhatsApp central perdeu a conexão com o navegador. Abra a página do WhatsApp e aguarde a reconexão."
                    : "A sessão do WhatsApp da empresa perdeu a conexão com o navegador. Abra a sincronização e aguarde a reconexão.");
            }
        }
        await esperar(500);
    }

    throw new Error(tipo === "central"
        ? "WhatsApp central do SGOS está desconectado ou ainda iniciando."
        : "WhatsApp da empresa está desconectado ou ainda iniciando.");
}

async function obterChatId(client, telefone) {
    const numero = formatarNumero(telefone);
    if (!numero) throw new Error("Telefone não informado.");
    const numberId = await client.getNumberId(numero);
    if (!numberId) throw new Error("Número não possui WhatsApp.");
    return { chatId: numberId._serialized, numero };
}

async function aguardarConexao({ tipo = "cliente", empresaId, timeoutMs = 30000 } = {}) {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
        const status = await obterStatus({ tipo, empresaId });
        if (status?.conectado) return status;
        if (status?.status === "aguardando_qr") {
            throw new Error(tipo === "central"
                ? "WhatsApp central precisa de nova leitura do QR Code."
                : "WhatsApp da empresa precisa de nova leitura do QR Code.");
        }
        await esperar(750);
    }
    throw new Error(tipo === "central"
        ? "WhatsApp central não reconectou dentro do tempo esperado."
        : "WhatsApp da empresa não reconectou dentro do tempo esperado.");
}

async function reconectarSessao({ tipo = "cliente", empresaId, timeoutMs = 30000 } = {}) {
    const chave = resolverChaveSessao({ tipo, empresaId });
    const escopo = dadosEscopo(tipo, empresaId);
    const atual = await obterStatus({ tipo, empresaId });
    if (atual?.conectado) return { ok: true, ...atual, reconectado: false };

    registrarLog("alerta", "Reconexão automática do WhatsApp iniciada.", escopo);

    // destroy() encerra apenas a instância atual do navegador; não faz logout e
    // preserva a autenticação do LocalAuth para tentar reconectar sem QR.
    await destruirCliente(chave, "Reconexão automática");
    criarSessao({ tipo, empresaId });

    try {
        const status = await aguardarConexao({ tipo, empresaId, timeoutMs });
        registrarLog("sucesso", "WhatsApp reconectado automaticamente.", escopo);
        return { ok: true, ...status, reconectado: true };
    } catch (err) {
        const qr = obterQr({ tipo, empresaId });
        registrarLog("erro", "A reconexão automática do WhatsApp não foi concluída.", {
            ...escopo,
            erro: err.message,
            precisaQr: Boolean(qr)
        });
        return {
            ok: false,
            status: qr ? "aguardando_qr" : "desconectado",
            conectado: false,
            precisa_qr: Boolean(qr),
            erro: err.message
        };
    }
}

async function executarEnvioSeguro({ tipo, empresaId, operacao }) {
    const escopo = dadosEscopo(tipo, empresaId);
    let client;

    // 1) Antes do envio: se estiver offline, tenta recuperar a sessão automaticamente.
    try {
        client = await obterClientePronto({ tipo, empresaId, timeoutMs: 12000 });
    } catch (primeiroErro) {
        registrarLog("alerta", "WhatsApp indisponível antes do envio. Tentando reconectar.", {
            ...escopo, erro: primeiroErro.message
        });
        const reconexao = await reconectarSessao({ tipo, empresaId, timeoutMs: 30000 });
        if (!reconexao.ok) throw new Error(reconexao.erro || "WhatsApp desconectado.");
        client = await obterClientePronto({ tipo, empresaId, timeoutMs: 10000 });
    }

    // 2) Tenta enviar. Se o navegador cair durante a operação, reinicia e REPETE UMA VEZ.
    try {
        return await operacao(client);
    } catch (err) {
        if (!erroNavegadorInvalido(err)) throw err;

        registrarLog("alerta", "Falha do navegador durante o envio. Reconectando e repetindo o envio.", {
            ...escopo, erro: err.message
        });

        const reconexao = await reconectarSessao({ tipo, empresaId, timeoutMs: 30000 });
        if (!reconexao.ok) throw new Error(reconexao.erro || "Falha ao reconectar o WhatsApp.");

        const novoClient = await obterClientePronto({ tipo, empresaId, timeoutMs: 10000 });
        const resultado = await operacao(novoClient);
        registrarLog("sucesso", "Envio concluído após reconexão automática.", escopo);
        return resultado;
    }
}

async function enviarTextoComCliente({ tipo, empresaId, telefone, mensagem }) {
    if (!String(mensagem || "").trim()) return { ok: false, error: "empty_message" };

    return executarEnvioSeguro({
        tipo,
        empresaId,
        operacao: async client => {
            const { chatId, numero } = await obterChatId(client, telefone);
            await client.sendMessage(chatId, String(mensagem).trim());
            return { ok: true, numero };
        }
    });
}

async function enviarMensagem(empresaId, telefone, mensagem) {
    try {
        const resultado = await enviarTextoComCliente({ tipo: "cliente", empresaId, telefone, mensagem });
        registrarLog(resultado.ok ? "sucesso" : "erro", resultado.ok ? "Mensagem manual enviada." : "Falha no envio manual.", {
            escopo: "cliente", empresaId: String(empresaId), telefone: formatarNumero(telefone), erro: resultado.error || null
        });
        return resultado;
    } catch (err) {
        registrarLog("erro", "Erro no envio manual.", { escopo: "cliente", empresaId: String(empresaId), erro: err.message });
        return { ok: false, error: "send_failed", detail: err.message };
    }
}

async function enviarMensagemCentral(telefone, mensagem) {
    try {
        const resultado = await enviarTextoComCliente({ tipo: "central", empresaId: CENTRAL_EMPRESA_ID, telefone, mensagem });
        registrarLog(resultado.ok ? "sucesso" : "erro", resultado.ok ? "Mensagem central enviada." : "Falha no envio central.", {
            escopo: "central", empresaId: CENTRAL_EMPRESA_ID, telefone: formatarNumero(telefone), erro: resultado.error || null
        });
        return resultado;
    } catch (err) {
        registrarLog("erro", "Erro no envio central.", { escopo: "central", empresaId: CENTRAL_EMPRESA_ID, erro: err.message });
        return { ok: false, error: "send_failed", detail: err.message };
    }
}

function validarBuffer(arquivo) {
    const buffer = Buffer.isBuffer(arquivo) ? arquivo : arquivo?.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length < 100) throw new Error("Arquivo PDF inválido.");
    return buffer;
}

async function enviarDocumento(empresaId, telefone, arquivo, nomeArquivo, legenda = "") {
    try {
        const buffer = validarBuffer(arquivo);
        const resultado = await executarEnvioSeguro({
            tipo: "cliente",
            empresaId,
            operacao: async client => {
                const { chatId, numero } = await obterChatId(client, telefone);
                const media = new MessageMedia("application/pdf", buffer.toString("base64"), nomeArquivo || "relatorio.pdf");
                await client.sendMessage(chatId, media, { caption: legenda || "Relatório SGOS" });
                return { ok: true, numero };
            }
        });

        registrarLog("sucesso", "Relatório manual enviado pela empresa.", {
            escopo: "cliente", empresaId: String(empresaId), telefone: resultado.numero, arquivo: nomeArquivo || "relatorio.pdf"
        });
        return resultado;
    } catch (err) {
        registrarLog("erro", "Erro no envio de relatório manual.", {
            escopo: "cliente", empresaId: String(empresaId), erro: err.message
        });
        return { ok: false, error: "send_failed", detail: err.message };
    }
}

async function enviarMidiaCentral(_empresaIdIgnorada, telefone, arquivo, nomeArquivo, legenda = "") {
    const buffer = validarBuffer(arquivo);
    const resultado = await executarEnvioSeguro({
        tipo: "central",
        empresaId: CENTRAL_EMPRESA_ID,
        operacao: async client => {
            const { chatId, numero } = await obterChatId(client, telefone);
            const media = new MessageMedia("application/pdf", buffer.toString("base64"), nomeArquivo || "relatorio.pdf");
            await client.sendMessage(chatId, media, { caption: legenda || "Relatório automático SGOS" });
            return { ok: true, numero };
        }
    });

    registrarLog("sucesso", "Relatório automático enviado.", {
        escopo: "central", empresaId: CENTRAL_EMPRESA_ID, telefone: resultado.numero, arquivo: nomeArquivo || "relatorio.pdf"
    });
    return resultado;
}

function criarJobEnvio({ empresaId, contatos, mensagem, intervaloSegundos = 45 }) {
    const origem = Array.isArray(contatos) ? contatos : [];
    if (!origem.length) throw new Error("Nenhum contato informado.");
    if (origem.length > 10) throw new Error("O limite é de 10 contatos por lote.");

    const lista = origem.slice(0, 10);
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
                erro: resultado.detail || resultado.error || null,
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
    aguardarConexao,
    reconectarSessao,
    desconectarSessao,
    enviarMensagem,
    enviarMensagemCentral,
    enviarDocumento,
    enviarMidia: enviarDocumento,
    enviarMidiaCentral,
    criarJobEnvio,
    obterJob,
    formatarNumero,
    listarLogs,
    registrarLog,
    sessions,
    qrs,
    jobs
};
