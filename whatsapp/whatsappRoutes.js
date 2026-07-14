const express = require("express");
const router = express.Router();

const {
    criarSessao,
    enviarMensagem,
    criarJobEnvio,
    obterJob,
    sessions,
    qrs
} = require("./whatsappService");

router.get("/qr/:empresaId", async (req, res) => {
    const empresaId = String(req.params.empresaId || "").trim();
    if (!empresaId) return res.status(400).json({ erro: "Empresa não informada." });

    criarSessao(empresaId);
    const limite = Date.now() + 8000;
    while (!qrs[empresaId] && Date.now() < limite) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (sessions[empresaId]?.info) {
            return res.json({ status: "conectado" });
        }
    }

    if (qrs[empresaId]) return res.json({ qr: qrs[empresaId], status: "aguardando" });
    return res.status(202).json({ erro: "QR ainda não gerado. Clique novamente em alguns segundos.", status: "aguardando" });
});

router.get("/status/:empresaId", (req, res) => {
    const empresaId = String(req.params.empresaId || "");
    const client = sessions[empresaId];
    if (!client) return res.json({ status: "desconectado" });
    return res.json({ status: client.info ? "conectado" : "aguardando" });
});

router.post("/enviar-lote", (req, res) => {
    try {
        const { empresaId, contatos, mensagem, intervaloSegundos } = req.body || {};
        if (!empresaId) return res.status(400).json({ erro: "Empresa não informada." });
        if (!mensagem || !String(mensagem).trim()) return res.status(400).json({ erro: "Mensagem vazia." });
        if (!Array.isArray(contatos) || !contatos.length) return res.status(400).json({ erro: "Selecione pelo menos um contato." });
        if (contatos.length > 10) return res.status(400).json({ erro: "O limite é de 10 contatos por lote." });
        if (!sessions[String(empresaId)]?.info) return res.status(409).json({ erro: "WhatsApp desconectado. Leia o QR Code antes de enviar." });

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
    if (!job) return res.status(404).json({ erro: "Fila não encontrada ou já expirada." });
    return res.json(job);
});

router.post("/teste", async (req, res) => {
    const empresaId = req.body?.empresaId || 1;
    const telefone = req.body?.telefone;
    if (!telefone) return res.status(400).json({ erro: "Informe o telefone para o teste." });
    const resultado = await enviarMensagem(empresaId, telefone, "🚀 Teste do SGOS funcionando!");
    return res.status(resultado.ok ? 200 : 400).json(resultado);
});

module.exports = router;
