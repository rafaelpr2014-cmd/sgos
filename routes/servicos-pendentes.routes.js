const express = require("express");
const router = express.Router();
const pool = require("../database");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// =====================================================
// Upload de anexos
// Salva em: /uploads/servicos-pendentes
// =====================================================
const uploadDir = path.join(__dirname, "..", "uploads", "servicos-pendentes");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname || "");
        const baseName = path
            .basename(file.originalname || "anexo", ext)
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(0, 60);

        cb(null, `${Date.now()}_${baseName}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});

// =====================================================
// Helper - usuário logado / empresa
// =====================================================
async function getUsuario(req) {
    const usuarioId = req.headers["x-usuario-id"];

    if (!usuarioId) {
        const erro = new Error("Usuário não informado");
        erro.statusCode = 401;
        throw erro;
    }

    const [rows] = await pool.query(
        "SELECT id, usuario, empresa_id FROM usuarios WHERE id = ? LIMIT 1",
        [usuarioId]
    );

    if (!rows.length) {
        const erro = new Error("Usuário inválido");
        erro.statusCode = 401;
        throw erro;
    }

    return rows[0];
}

function normalizarPrioridade(valor) {
    const p = String(valor || "").trim().toLowerCase();

    if (p === "alta") return "Alta";
    if (p === "baixa") return "Baixa";
    if (p === "média" || p === "media") return "Média";

    return "Média";
}

function normalizarStatus(valor) {
    const s = String(valor || "").trim().toLowerCase();

    if (s === "realizado") return "Realizado";

    return "Pendente";
}

// =====================================================
// LISTAR SERVIÇOS PENDENTES / HISTÓRICO
// =====================================================
router.get("/", async (req, res) => {
    try {
        const usuario = await getUsuario(req);

        const [rows] = await pool.query(
            `
            SELECT
                id,
                empresa_id,
                servico,
                localidade,
                descricao,
                prioridade,
                enviado_por,
                anexo,
                status,
                criado_por,
                criado_em,
                atualizado_em
            FROM servicos_pendentes
            WHERE empresa_id = ?
            ORDER BY
                CASE WHEN status = 'Pendente' THEN 0 ELSE 1 END,
                criado_em DESC
            `,
            [usuario.empresa_id]
        );

        res.json(rows);

    } catch (err) {
        console.error("Erro ao listar serviços pendentes:", err);

        res.status(err.statusCode || 500).json({
            erro: err.message || "Erro ao listar serviços pendentes"
        });
    }
});

// =====================================================
// CRIAR SERVIÇO PENDENTE COM ANEXO
// enviado_por vem automaticamente do usuário logado
// =====================================================
router.post("/", upload.single("anexo"), async (req, res) => {
    try {
        const usuario = await getUsuario(req);

        const {
            servico,
            localidade,
            descricao,
            prioridade,
            status
        } = req.body;

        if (!servico || !servico.trim()) {
            return res.status(400).json({ erro: "Informe o serviço" });
        }

        const caminhoAnexo = req.file
            ? `/uploads/servicos-pendentes/${req.file.filename}`
            : null;

        const [result] = await pool.query(
            `
            INSERT INTO servicos_pendentes
            (
                empresa_id,
                servico,
                localidade,
                descricao,
                prioridade,
                enviado_por,
                anexo,
                status,
                criado_por
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                usuario.empresa_id,
                servico.trim(),
                localidade || null,
                descricao || null,
                normalizarPrioridade(prioridade),
                usuario.usuario || "Usuário",
                caminhoAnexo,
                normalizarStatus(status),
                usuario.id
            ]
        );

        res.json({
            sucesso: true,
            id: result.insertId
        });

    } catch (err) {
        console.error("Erro ao criar serviço pendente:", err);

        res.status(err.statusCode || 500).json({
            erro: err.message || "Erro ao criar serviço pendente"
        });
    }
});

// =====================================================
// EDITAR SERVIÇO PENDENTE
// Se enviar novo anexo, substitui o antigo
// enviado_por permanece como quem registrou
// =====================================================
router.put("/:id", upload.single("anexo"), async (req, res) => {
    try {
        const usuario = await getUsuario(req);
        const { id } = req.params;

        const {
            servico,
            localidade,
            descricao,
            prioridade,
            status
        } = req.body;

        if (!servico || !servico.trim()) {
            return res.status(400).json({ erro: "Informe o serviço" });
        }

        const [existente] = await pool.query(
            `
            SELECT anexo
            FROM servicos_pendentes
            WHERE id = ?
              AND empresa_id = ?
            LIMIT 1
            `,
            [id, usuario.empresa_id]
        );

        if (!existente.length) {
            return res.status(404).json({ erro: "Serviço não encontrado" });
        }

        let caminhoAnexo = existente[0].anexo;

        if (req.file) {
            caminhoAnexo = `/uploads/servicos-pendentes/${req.file.filename}`;

            if (existente[0].anexo) {
                const arquivoAntigo = path.join(__dirname, "..", existente[0].anexo.replace(/^\/+/, ""));
                fs.unlink(arquivoAntigo, err => {
                    if (err && err.code !== "ENOENT") {
                        console.error("Erro ao remover anexo antigo:", err);
                    }
                });
            }
        }

        const [result] = await pool.query(
            `
            UPDATE servicos_pendentes
            SET
                servico = ?,
                localidade = ?,
                descricao = ?,
                prioridade = ?,
                status = ?,
                anexo = ?
            WHERE id = ?
              AND empresa_id = ?
            `,
            [
                servico.trim(),
                localidade || null,
                descricao || null,
                normalizarPrioridade(prioridade),
                normalizarStatus(status),
                caminhoAnexo,
                id,
                usuario.empresa_id
            ]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ erro: "Serviço não encontrado" });
        }

        res.json({ sucesso: true });

    } catch (err) {
        console.error("Erro ao editar serviço pendente:", err);

        res.status(err.statusCode || 500).json({
            erro: err.message || "Erro ao editar serviço pendente"
        });
    }
});

// =====================================================
// EXCLUIR SERVIÇO PENDENTE
// Remove também o arquivo anexo, se existir
// =====================================================
router.delete("/:id", async (req, res) => {
    try {
        const usuario = await getUsuario(req);
        const { id } = req.params;

        const [rows] = await pool.query(
            `
            SELECT anexo
            FROM servicos_pendentes
            WHERE id = ?
              AND empresa_id = ?
            LIMIT 1
            `,
            [id, usuario.empresa_id]
        );

        if (!rows.length) {
            return res.status(404).json({ erro: "Serviço não encontrado" });
        }

        const anexo = rows[0].anexo;

        const [result] = await pool.query(
            `
            DELETE FROM servicos_pendentes
            WHERE id = ?
              AND empresa_id = ?
            `,
            [id, usuario.empresa_id]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ erro: "Serviço não encontrado" });
        }

        if (anexo) {
            const arquivo = path.join(__dirname, "..", anexo.replace(/^\/+/, ""));

            fs.unlink(arquivo, err => {
                if (err && err.code !== "ENOENT") {
                    console.error("Erro ao remover anexo:", err);
                }
            });
        }

        res.json({ sucesso: true });

    } catch (err) {
        console.error("Erro ao excluir serviço pendente:", err);

        res.status(err.statusCode || 500).json({
            erro: err.message || "Erro ao excluir serviço pendente"
        });
    }
});

module.exports = router;