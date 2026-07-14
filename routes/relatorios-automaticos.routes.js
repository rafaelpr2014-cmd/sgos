const express = require("express");
const router = express.Router();
const { gerarRelatorioEmpresa, enviarRelatorio } = require("../services/relatorios.service");
const { enviarMidia } = require("../services/whatsappService");

module.exports = (pool, verificarAutenticacao) => {
    router.post("/enviar-manual", verificarAutenticacao, async (req, res) => {
        try {
            const empresaId = Number(req.usuario?.empresa_id);
            const tipo = ["diario", "semanal", "mensal"].includes(req.body.tipo) ? req.body.tipo : "diario";
            const rel = await gerarRelatorioEmpresa(pool, empresaId, tipo);
            const canal = String(req.body.canal || "email").toLowerCase();

            if (["email", "ambos"].includes(canal)) {
                const email = req.body.email;
                if (!email) return res.status(400).json({ erro: "Informe o e-mail" });
                await enviarRelatorio(email, rel.buffer, `Relatório ${tipo} SGOS`, rel.filename);
            }

            if (["whatsapp", "ambos"].includes(canal)) {
                const telefone = req.body.telefone;
                if (!telefone) return res.status(400).json({ erro: "Informe o telefone" });
                await enviarMidia(empresaId, telefone, rel.buffer, rel.filename, "Relatório SGOS");
            }

            return res.json({ ok: true, nomeArquivo: rel.filename });
        } catch (err) {
            console.error("Erro no envio manual:", err);
            return res.status(500).json({ erro: err.message });
        }
    });

    router.get("/historico", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT * FROM relatorios_envios
                WHERE empresa_id = ? ORDER BY id DESC LIMIT 300
            `, [req.usuario.empresa_id]);
            res.json(rows);
        } catch (err) {
            res.status(500).json({ erro: "Erro ao consultar histórico" });
        }
    });

    return router;
};
