module.exports = (pool, verificarAutenticacao) => {
    const express = require("express");
    const multer = require("multer");
    const router = express.Router();

    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 }
    });

    const { enviarRelatorio } = require("../services/relatorios.service");
    const { enviarMidiaCentral } = require("../services/whatsappService");

    router.get("/relatorios", verificarAutenticacao, async (req, res) => {
        try {
            const empresa_id = req.usuario.empresa_id;
            const [rows] = await pool.query(`
                SELECT 
                    os.id,
                    os.cliente,
                    os.plano,
                    os.status,
                    os.observacao,
                    os.tecnico,
                    os.data_abertura,
                    os.finalizado_em,
                    os.agendamento,
                    os.localidade,
                    l.nome AS nome_localidade,
                    os.tipo_servico,
                    ts.nome AS nome_tipo_servico
                FROM ordens_servico os
                LEFT JOIN localidades l
                    ON os.localidade = l.id AND l.empresa_id = os.empresa_id
                LEFT JOIN tipos_servico ts
                    ON os.tipo_servico = ts.id AND ts.empresa_id = os.empresa_id
                WHERE os.empresa_id = ?
                ORDER BY os.id DESC
            `, [empresa_id]);

            return res.json(rows);
        } catch (err) {
            console.error("Erro relatorios:", err);
            return res.status(500).json({ erro: "Erro ao buscar relatórios" });
        }
    });

    router.post(
        "/relatorios/enviar-manual",
        verificarAutenticacao,
        upload.single("pdf"),
        async (req, res) => {
            try {
                const { email, periodo, dataInicio, dataFim, pdfBase64 } = req.body || {};

                if (!email) {
                    return res.status(400).json({ erro: "E-mail obrigatório" });
                }

                let pdfBuffer = req.file?.buffer;

                // Compatibilidade com a página antiga.
                if (!pdfBuffer && pdfBase64) {
                    const base64Limpo = String(pdfBase64)
                        .replace(/^data:application\/pdf.*base64,/, "");
                    pdfBuffer = Buffer.from(base64Limpo, "base64");
                }

                if (!pdfBuffer?.length) {
                    return res.status(400).json({ erro: "PDF não recebido" });
                }

                const descricaoPeriodo = montarDescricaoPeriodo(
                    periodo,
                    dataInicio,
                    dataFim
                );

                const nomeArquivo = req.file?.originalname || "relatorio.pdf";

                await enviarRelatorio(
                    email,
                    pdfBuffer,
                    `Relatório SGOS - ${descricaoPeriodo}`,
                    nomeArquivo
                );

                return res.json({
                    ok: true,
                    mensagem: "Relatório enviado por e-mail com sucesso"
                });
            } catch (err) {
                console.error("Erro envio manual por e-mail:", err);
                return res.status(500).json({
                    erro: err.message || "Erro ao enviar relatório por e-mail"
                });
            }
        }
    );

    router.post(
        "/relatorios/enviar-whatsapp-manual",
        verificarAutenticacao,
        upload.single("pdf"),
        async (req, res) => {
            try {
                const { telefone, periodo, dataInicio, dataFim } = req.body || {};

                if (!telefone) {
                    return res.status(400).json({ erro: "Telefone obrigatório" });
                }

                if (!req.file?.buffer?.length) {
                    return res.status(400).json({ erro: "PDF não recebido" });
                }

                const descricaoPeriodo = montarDescricaoPeriodo(
                    periodo,
                    dataInicio,
                    dataFim
                );

                const resultado = await enviarMidiaCentral(
                    1,
                    telefone,
                    req.file.buffer,
                    req.file.originalname || "relatorio.pdf",
                    `📊 Relatório SGOS - ${descricaoPeriodo}`
                );

                if (!resultado.ok) {
                    const mensagens = {
                        offline: "WhatsApp central do SGOS está desconectado",
                        no_phone: "Telefone não informado",
                        not_exists: "Número não encontrado no WhatsApp",
                        number_error: "Não foi possível validar o número",
                        invalid_file: "PDF inválido",
                        send_failed: "Falha ao enviar o PDF pelo WhatsApp central do SGOS"
                    };

                    return res.status(resultado.error === "offline" ? 409 : 400).json({
                        erro: mensagens[resultado.error] || resultado.detail || "Erro no WhatsApp"
                    });
                }

                return res.json({
                    ok: true,
                    mensagem: "Relatório enviado pelo WhatsApp central do SGOS com sucesso"
                });
            } catch (err) {
                console.error("Erro envio manual por WhatsApp:", err);
                return res.status(500).json({
                    erro: err.message || "Erro ao enviar relatório pelo WhatsApp central do SGOS"
                });
            }
        }
    );

    function montarDescricaoPeriodo(periodo, dataInicio, dataFim) {
        if (periodo === "hoje") return "Hoje";
        if (periodo === "ontem") return "Ontem";
        if (periodo === "semanal" || periodo === "7") return "Últimos 7 dias";
        if (periodo === "mensal" || periodo === "30") return "Últimos 30 dias";
        if (periodo === "personalizado") {
            return `${dataInicio || "-"} até ${dataFim || "-"}`;
        }
        return "Período selecionado";
    }

    return router;
};
