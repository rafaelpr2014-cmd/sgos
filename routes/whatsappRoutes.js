const express = require("express");
const router = express.Router();

const {
    CENTRAL_EMPRESA_ID,
    criarSessaoCentral,
    criarSessaoCliente,
    obterStatus,
    obterQr,
    desconectarSessao,
    enviarMensagem,
    enviarMensagemCentral,
    criarJobEnvio,
    obterJob,
    listarLogs
} = require("../services/whatsappService");

function extrairUsuario(req) {
    const usuarioDoMiddleware =
        req.user ||
        req.usuario ||
        req.session?.user ||
        req.session?.usuario ||
        null;

    if (usuarioDoMiddleware) {
        return usuarioDoMiddleware;
    }

    // O SGOS atual autentica o frontend por cabeçalhos.
    const usuarioId =
        req.get("x-usuario-id") ||
        null;

    const empresaId =
        req.get("x-empresa-id") ||
        null;

    if (!usuarioId || !empresaId) {
        return null;
    }

    return {
        id: usuarioId,
        usuario:
            req.get("x-usuario-nome") ||
            "",
        cargo:
            req.get("x-usuario-cargo") ||
            "",
        empresa_id: empresaId
    };
}

function extrairEmpresaId(req) {
    const user = extrairUsuario(req);

    return String(
        user?.empresa_id ??
        user?.empresaId ??
        user?.id_empresa ??
        user?.empresa?.id ??
        req.empresa_id ??
        req.get("x-empresa-id") ??
        ""
    ).trim();
}

function exigirAutenticacao(req, res, next) {
    const empresaId = extrairEmpresaId(req);
    if (!empresaId) {
        return res.status(401).json({ erro: "Usuário não autenticado ou empresa não identificada." });
    }
    req.empresaIdAutenticada = empresaId;
    next();
}

function exigirEmpresaCentral(req, res, next) {
    if (String(req.empresaIdAutenticada) !== CENTRAL_EMPRESA_ID) {
        return res.status(403).json({ erro: "Acesso exclusivo da administração SGOS." });
    }
    next();
}

async function aguardarQr({ tipo, empresaId }) {
    const limite = Date.now() + 10000;
    while (Date.now() < limite) {
        const status = obterStatus({ tipo, empresaId });
        if (status.conectado) return status;
        const qr = obterQr({ tipo, empresaId });
        if (qr) return { status: "aguardando_qr", qr };
        await new Promise(resolve => setTimeout(resolve, 400));
    }
    return { status: "iniciando", erro: "QR ainda não foi gerado. Tente novamente em alguns segundos." };
}

router.use(exigirAutenticacao);

// =====================================================
// WHATSAPP CENTRAL DO SGOS - SOMENTE EMPRESA 1
// =====================================================
router.get("/central/status", exigirEmpresaCentral, (req, res) => {
    return res.json(obterStatus({ tipo: "central", empresaId: CENTRAL_EMPRESA_ID }));
});

router.get("/central/qr", exigirEmpresaCentral, async (req, res) => {
    criarSessaoCentral();
    const resultado = await aguardarQr({ tipo: "central", empresaId: CENTRAL_EMPRESA_ID });
    return res.status(resultado.qr || resultado.conectado ? 200 : 202).json(resultado);
});

router.post("/central/desconectar", exigirEmpresaCentral, async (req, res) => {
    return res.json(await desconectarSessao({ tipo: "central", empresaId: CENTRAL_EMPRESA_ID }));
});

router.get("/central/logs", exigirEmpresaCentral, (req, res) => {
    return res.json(listarLogs({ limite: req.query.limite, escopo: "central" }));
});

router.post("/central/teste", exigirEmpresaCentral, async (req, res) => {
    const telefone = req.body?.telefone;
    if (!telefone) return res.status(400).json({ erro: "Informe o telefone para o teste." });
    const resultado = await enviarMensagemCentral(telefone, "🚀 Teste do WhatsApp central SGOS funcionando!");
    return res.status(resultado.ok ? 200 : 400).json(resultado);
});

// =====================================================
// WHATSAPP DA EMPRESA CLIENTE - UMA SESSÃO POR EMPRESA
// =====================================================
router.get("/cliente/status", (req, res) => {
    return res.json(obterStatus({ tipo: "cliente", empresaId: req.empresaIdAutenticada }));
});

router.get("/cliente/qr", async (req, res) => {
    criarSessaoCliente(req.empresaIdAutenticada);
    const resultado = await aguardarQr({ tipo: "cliente", empresaId: req.empresaIdAutenticada });
    return res.status(resultado.qr || resultado.conectado ? 200 : 202).json(resultado);
});

router.post("/cliente/desconectar", async (req, res) => {
    return res.json(await desconectarSessao({ tipo: "cliente", empresaId: req.empresaIdAutenticada }));
});

router.get("/cliente/logs", (req, res) => {
    return res.json(listarLogs({ limite: req.query.limite, escopo: "cliente", empresaId: req.empresaIdAutenticada }));
});

router.post("/cliente/teste", async (req, res) => {
    const telefone = req.body?.telefone;
    if (!telefone) return res.status(400).json({ erro: "Informe o telefone para o teste." });
    const resultado = await enviarMensagem(req.empresaIdAutenticada, telefone, "🚀 Teste do WhatsApp da sua empresa funcionando!");
    return res.status(resultado.ok ? 200 : 400).json(resultado);
});

router.post("/enviar-lote", (req, res) => {
    try {
        const { contatos, mensagem, intervaloSegundos } = req.body || {};
        const empresaId = req.empresaIdAutenticada;

        if (!mensagem || !String(mensagem).trim()) return res.status(400).json({ erro: "Mensagem vazia." });
        if (!Array.isArray(contatos) || !contatos.length) return res.status(400).json({ erro: "Selecione pelo menos um contato." });
        if (contatos.length > 10) return res.status(400).json({ erro: "O limite é de 10 contatos por lote." });
        if (!obterStatus({ tipo: "cliente", empresaId }).conectado) {
            return res.status(409).json({ erro: "WhatsApp da empresa desconectado. Leia o QR Code antes de enviar." });
        }

        const job = criarJobEnvio({
            empresaId,
            contatos,
            mensagem,
            intervaloSegundos: Math.max(45, Number(intervaloSegundos) || 45)
        });

        return res.status(202).json({ ok: true, jobId: job.id, total: job.total, intervaloSegundos: job.intervaloSegundos });
    } catch (err) {
        console.error("Erro ao iniciar lote WhatsApp:", err);
        return res.status(500).json({ erro: err.message || "Erro ao iniciar fila de envio." });
    }
});

router.get("/envios/:jobId", (req, res) => {
    const job = obterJob(req.params.jobId);
    if (!job || String(job.empresaId) !== String(req.empresaIdAutenticada)) {
        return res.status(404).json({ erro: "Fila não encontrada ou já expirada." });
    }
    return res.json(job);
});

module.exports = router;
