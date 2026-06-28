module.exports = (pool, verificarAutenticacao) => {

    const express = require("express");
    const router = express.Router();

    const { enviarRelatorio } = require("../services/relatorios.service");

    // ===============================
    // 📊 LISTAR RELATÓRIOS
    // ===============================
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

            res.json(rows);

        } catch (err) {
            console.error("Erro relatorios:", err);
            res.status(500).json({ erro: "Erro ao buscar relatórios" });
        }
    });

    // ===============================
    // 📩 ENVIO MANUAL (INTELIGENTE)
    // ===============================
    router.post("/relatorios/enviar-manual", verificarAutenticacao, async (req, res) => {

        try {

            console.log("BODY RECEBIDO:", req.body);

            const { email, pdfBase64, periodo, dataInicio, dataFim } = req.body;

            if (!email) {
                return res.status(400).json({ erro: "Email obrigatório" });
            }

            if (!pdfBase64) {
                return res.status(400).json({ erro: "PDF não recebido" });
            }

            // 🔥 CONVERTE BASE64 → BUFFER
            const base64Limpo = pdfBase64.replace(/^data:application\/pdf.*base64,/, "");
            const pdfBuffer = Buffer.from(base64Limpo, "base64");

            // ===============================
            // 🔥 MONTA DESCRIÇÃO DO PERÍODO
            // ===============================
            let descricaoPeriodo = "Manual";

            if (periodo === "hoje") descricaoPeriodo = "Hoje";
            else if (periodo === "ontem") descricaoPeriodo = "Ontem";
            else if (periodo === "7") descricaoPeriodo = "Últimos 7 dias";
            else if (periodo === "30") descricaoPeriodo = "Últimos 30 dias";
            else if (periodo === "personalizado") {
                descricaoPeriodo = `${dataInicio || "-"} até ${dataFim || "-"}`;
            }

            // ===============================
            // 🔥 ENVIA EMAIL
            // ===============================
            await enviarRelatorio(
                email,
                pdfBuffer,
                `Relatório (${descricaoPeriodo})`
            );

            return res.json({
                ok: true,
                mensagem: "Relatório enviado com sucesso!"
            });

        } catch (err) {
            console.error("Erro envio relatório:", err);
            return res.status(500).json({ erro: "Erro ao enviar relatório" });
        }
    });

    return router;
};