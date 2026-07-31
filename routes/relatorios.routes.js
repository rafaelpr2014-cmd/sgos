
const fs = require("fs");
const path = require("path");

function salvarPdfMonitor(buffer, nomeOriginal, empresaId) {
    if (!buffer?.length) return null;
    const pasta = path.join(__dirname, "..", "uploads", "relatorios-monitor");
    fs.mkdirSync(pasta, { recursive: true });
    const baseSeguro = path.basename(String(nomeOriginal || "relatorio.pdf"))
        .replace(/[^a-zA-Z0-9._-]/g, "_");
    const nome = `${Date.now()}-${empresaId}-${Math.random().toString(36).slice(2, 8)}-${baseSeguro}`;
    const absoluto = path.join(pasta, nome);
    fs.writeFileSync(absoluto, buffer);
    return path.relative(path.join(__dirname, ".."), absoluto).replace(/\\/g, "/");
}

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
    const { iniciarLog, finalizarLog } = require("../services/relatorios-log.service");

    router.get("/relatorios", verificarAutenticacao, async (req, res) => {
        try {
            const empresa_id = req.usuario.empresa_id;
            const [rows] = await pool.query(`
                SELECT
                    os.*,
                    l.nome AS nome_localidade,
                    ts.nome AS nome_tipo_servico
                FROM ordens_servico os
                LEFT JOIN localidades l
                    ON os.localidade = l.id AND l.empresa_id = os.empresa_id
                LEFT JOIN tipos_servico ts
                    ON os.tipo_servico = ts.id AND ts.empresa_id = os.empresa_id
                WHERE os.empresa_id = ?
                ORDER BY os.id DESC
            `, [empresa_id]);

            const idsUsuarios = [
                ...new Set(
                    rows.flatMap(os => [os.criado_por, os.finalizado_por])
                        .filter(id => id !== null && id !== undefined && String(id).trim() !== "")
                        .map(id => String(id))
                )
            ];

            const mapaUsuarios = {};

            if (idsUsuarios.length) {
                const placeholders = idsUsuarios.map(() => "?").join(",");

                const [usuarios] = await pool.query(
                    `SELECT * FROM usuarios WHERE empresa_id = ? AND id IN (${placeholders})`,
                    [empresa_id, ...idsUsuarios]
                );

                for (const usuario of usuarios) {
                    mapaUsuarios[String(usuario.id)] =
                        usuario.nome ||
                        usuario.nome_completo ||
                        usuario.usuario ||
                        usuario.login ||
                        usuario.email ||
                        `Usuário ${usuario.id}`;
                }
            }

            const resultado = rows.map(os => ({
                ...os,
                criado_por_nome:
                    mapaUsuarios[String(os.criado_por)] ||
                    (os.criado_por ? `Usuário ${os.criado_por}` : "-"),
                finalizado_por_nome:
                    mapaUsuarios[String(os.finalizado_por)] ||
                    (os.finalizado_por ? `Usuário ${os.finalizado_por}` : "-")
            }));

            return res.json(resultado);
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
                const caminhoArquivo = salvarPdfMonitor(pdfBuffer, nomeArquivo, req.usuario?.empresa_id);

                const controleLog = await iniciarLog(pool, {
                    empresa_id: req.usuario.empresa_id,
                    usuario_id: req.usuario.id,
                    tipo_relatorio: periodo || "manual",
                    origem: "manual",
                    canal: "email",
                    destinatario: email,
                    assunto: `Relatório SGOS - ${descricaoPeriodo}`,
                    nome_arquivo: nomeArquivo,
                    caminho_arquivo: caminhoArquivo
                });

                try {
                    const retornoEmail = await enviarRelatorio(
                        email,
                        pdfBuffer,
                        `Relatório SGOS - ${descricaoPeriodo}`,
                        nomeArquivo
                    );
                    await finalizarLog(pool, controleLog, true, {
                        resposta: retornoEmail?.messageId || "E-mail enviado com sucesso"
                    });
                } catch (erroEnvio) {
                    await finalizarLog(pool, controleLog, false, {
                        codigo: erroEnvio.code,
                        erro: erroEnvio.message
                    });
                    throw erroEnvio;
                }

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

                const nomeArquivo = req.file.originalname || "relatorio.pdf";
                const caminhoArquivo = salvarPdfMonitor(req.file.buffer, nomeArquivo, req.usuario?.empresa_id);
                const controleLog = await iniciarLog(pool, {
                    empresa_id: req.usuario.empresa_id,
                    usuario_id: req.usuario.id,
                    tipo_relatorio: periodo || "manual",
                    origem: "manual",
                    canal: "whatsapp",
                    destinatario: telefone,
                    assunto: `Relatório SGOS - ${descricaoPeriodo}`,
                    nome_arquivo: nomeArquivo,
                    caminho_arquivo: caminhoArquivo
                });

                let resultado;
                try {
                    resultado = await enviarMidiaCentral(
                        1,
                        telefone,
                        req.file.buffer,
                        nomeArquivo,
                        `📊 Relatório SGOS - ${descricaoPeriodo}`
                    );

                    if (!resultado.ok) {
                        await finalizarLog(pool, controleLog, false, {
                            codigo: resultado.error,
                            erro: resultado.detail || resultado.error || "Falha no WhatsApp",
                            detalhes: resultado
                        });
                    } else {
                        await finalizarLog(pool, controleLog, true, {
                            resposta: resultado.messageId || "WhatsApp enviado com sucesso",
                            detalhes: resultado
                        });
                    }
                } catch (erroEnvio) {
                    await finalizarLog(pool, controleLog, false, {
                        codigo: erroEnvio.code,
                        erro: erroEnvio.message
                    });
                    throw erroEnvio;
                }

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
