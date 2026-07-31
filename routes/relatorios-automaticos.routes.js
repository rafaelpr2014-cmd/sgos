const express = require("express");
const router = express.Router();
const { gerarRelatorioEmpresa, enviarRelatorio } = require("../services/relatorios.service");
const { enviarMidiaCentral } = require("../services/whatsappService");
const { iniciarLog, finalizarLog } = require("../services/relatorios-log.service");

module.exports = (pool, verificarAutenticacao) => {
    router.post("/enviar-manual", verificarAutenticacao, async (req, res) => {
        const controles = [];
        try {
            const empresaId = Number(req.usuario?.empresa_id);
            const tipo = ["diario", "semanal", "mensal"].includes(req.body.tipo) ? req.body.tipo : "diario";
            const rel = await gerarRelatorioEmpresa(pool, empresaId, tipo);
            const canal = String(req.body.canal || "email").toLowerCase();

            if (["email", "ambos"].includes(canal)) {
                const email = req.body.email;
                if (!email) return res.status(400).json({ erro: "Informe o e-mail" });
                const log = await iniciarLog(pool, { empresa_id: empresaId, usuario_id: req.usuario?.id, tipo_relatorio: tipo, origem: 'manual', canal: 'email', destinatario: email, assunto: `Relatório ${tipo} SGOS`, nome_arquivo: rel.filename });
                controles.push(log);
                try {
                    const retorno = await enviarRelatorio(email, rel.buffer, `Relatório ${tipo} SGOS`, rel.filename);
                    await finalizarLog(pool, log, true, { resposta: retorno?.messageId || 'E-mail enviado' });
                } catch (erro) {
                    await finalizarLog(pool, log, false, { codigo: erro.code, erro: erro.message });
                    throw erro;
                }
            }

            if (["whatsapp", "ambos"].includes(canal)) {
                const telefone = req.body.telefone;
                if (!telefone) return res.status(400).json({ erro: "Informe o telefone" });
                const log = await iniciarLog(pool, { empresa_id: empresaId, usuario_id: req.usuario?.id, tipo_relatorio: tipo, origem: 'manual', canal: 'whatsapp', destinatario: telefone, assunto: 'Relatório SGOS', nome_arquivo: rel.filename });
                controles.push(log);
                try {
                    const retorno = await enviarMidiaCentral(empresaId, telefone, rel.buffer, rel.filename, "Relatório SGOS");
                    if (retorno && retorno.ok === false) throw Object.assign(new Error(retorno.detail || retorno.error || 'Falha no WhatsApp'), { code: retorno.error });
                    await finalizarLog(pool, log, true, { resposta: retorno?.messageId || 'WhatsApp enviado', detalhes: retorno });
                } catch (erro) {
                    await finalizarLog(pool, log, false, { codigo: erro.code, erro: erro.message });
                    throw erro;
                }
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
