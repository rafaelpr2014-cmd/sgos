const express = require("express");
const router = express.Router();
const pool = require("../database");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// =====================================================
// SERVIÇOS - uploads
// =====================================================
const uploadDir = path.join(__dirname, "..", "uploads", "servicos-pendentes");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination(req, file, cb) {
        cb(null, uploadDir);
    },
    filename(req, file, cb) {
        const ext = path.extname(file.originalname || "").toLowerCase();
        const baseName = path
            .basename(file.originalname || "anexo", ext)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(0, 60) || "anexo";

        cb(null, `${Date.now()}_${baseName}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        const permitidos = new Set([
            "image/jpeg", "image/png", "image/webp", "image/gif",
            "application/pdf",
            "video/mp4", "video/quicktime", "video/webm"
        ]);

        if (!permitidos.has(file.mimetype)) {
            return cb(new Error("Tipo de arquivo não permitido"));
        }

        cb(null, true);
    }
});

// =====================================================
// Migração automática dos campos novos
// Executada uma única vez por processo.
// =====================================================
let schemaPromise = null;

function garantirSchema() {
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        const comandos = [
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS data_servico DATE NULL AFTER localidade",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS nova_viabilidade TINYINT(1) NOT NULL DEFAULT 0 AFTER data_servico",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS tecnicos_ids LONGTEXT NULL AFTER nova_viabilidade",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS tecnicos_nomes LONGTEXT NULL AFTER tecnicos_ids"
        ];

        for (const sql of comandos) {
            await pool.query(sql);
        }
    })().catch(err => {
        schemaPromise = null;
        throw err;
    });

    return schemaPromise;
}

// =====================================================
// Helpers
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
    return "Média";
}

function normalizarStatus(valor) {
    return String(valor || "").trim().toLowerCase() === "realizado"
        ? "Realizado"
        : "Pendente";
}

function normalizarBooleano(valor) {
    return [true, 1, "1", "true", "sim", "on"].includes(
        typeof valor === "string" ? valor.toLowerCase().trim() : valor
    ) ? 1 : 0;
}

function dataValidaOuNull(valor) {
    const data = String(valor || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null;
}

function parseArray(valor) {
    if (Array.isArray(valor)) return valor;
    if (valor === null || valor === undefined || valor === "") return [];

    try {
        const convertido = JSON.parse(valor);
        return Array.isArray(convertido) ? convertido : [];
    } catch {
        return String(valor)
            .split(",")
            .map(item => item.trim())
            .filter(Boolean);
    }
}

function normalizarTecnicos(idsRecebidos, nomesRecebidos) {
    const ids = [...new Set(parseArray(idsRecebidos)
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0))];

    const nomes = parseArray(nomesRecebidos)
        .map(nome => String(nome || "").trim())
        .filter(Boolean)
        .slice(0, ids.length || 4);

    if (ids.length > 4) {
        const erro = new Error("Selecione no máximo 4 técnicos");
        erro.statusCode = 400;
        throw erro;
    }

    return { ids, nomes };
}

function serializarArray(lista) {
    return lista.length ? JSON.stringify(lista) : null;
}

function parsearLinha(row) {
    return {
        ...row,
        nova_viabilidade: Boolean(Number(row.nova_viabilidade)),
        tecnicos_ids: parseArray(row.tecnicos_ids).map(id => Number(id)).filter(Boolean),
        tecnicos_nomes: parseArray(row.tecnicos_nomes)
    };
}

function removerArquivo(caminhoPublico) {
    if (!caminhoPublico) return;

    const relativo = String(caminhoPublico).replace(/^\/+/, "");
    const arquivo = path.resolve(__dirname, "..", relativo);
    const raizUploads = path.resolve(__dirname, "..", "uploads") + path.sep;

    // Impede remoção fora da pasta de uploads.
    if (!arquivo.startsWith(raizUploads)) return;

    fs.unlink(arquivo, err => {
        if (err && err.code !== "ENOENT") {
            console.error("Erro ao remover anexo:", err);
        }
    });
}

function responderErro(res, err, mensagemPadrao) {
    console.error(mensagemPadrao, err);

    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ erro: "O anexo deve ter no máximo 30 MB" });
    }

    return res.status(err.statusCode || 500).json({
        erro: err.message || mensagemPadrao
    });
}

// =====================================================
// LISTAR SERVIÇOS
// Aceita filtros opcionais também pelo backend:
// ?status=&localidade=&data_inicio=&data_fim=&busca=
// =====================================================
router.get("/", async (req, res) => {
    try {
        await garantirSchema();
        const usuario = await getUsuario(req);

        const where = ["empresa_id = ?"];
        const params = [usuario.empresa_id];

        const status = String(req.query.status || "").trim();
        const localidade = String(req.query.localidade || "").trim();
        const dataInicio = dataValidaOuNull(req.query.data_inicio);
        const dataFim = dataValidaOuNull(req.query.data_fim);
        const busca = String(req.query.busca || "").trim();

        if (status) {
            where.push("status = ?");
            params.push(normalizarStatus(status));
        }

        if (localidade) {
            where.push("localidade = ?");
            params.push(localidade);
        }

        if (dataInicio) {
            where.push("COALESCE(data_servico, DATE(criado_em)) >= ?");
            params.push(dataInicio);
        }

        if (dataFim) {
            where.push("COALESCE(data_servico, DATE(criado_em)) <= ?");
            params.push(dataFim);
        }

        if (busca) {
            const termo = `%${busca}%`;
            where.push(`(
                servico LIKE ? OR
                localidade LIKE ? OR
                descricao LIKE ? OR
                prioridade LIKE ? OR
                enviado_por LIKE ? OR
                tecnicos_nomes LIKE ?
            )`);
            params.push(termo, termo, termo, termo, termo, termo);
        }

        const [rows] = await pool.query(
            `
            SELECT
                id,
                empresa_id,
                servico,
                localidade,
                data_servico,
                nova_viabilidade,
                tecnicos_ids,
                tecnicos_nomes,
                descricao,
                prioridade,
                enviado_por,
                anexo,
                status,
                criado_por,
                criado_em,
                atualizado_em
            FROM servicos_pendentes
            WHERE ${where.join(" AND ")}
            ORDER BY
                CASE WHEN status = 'Pendente' THEN 0 ELSE 1 END,
                COALESCE(data_servico, DATE(criado_em)) DESC,
                criado_em DESC
            `,
            params
        );

        res.json(rows.map(parsearLinha));
    } catch (err) {
        responderErro(res, err, "Erro ao listar serviços");
    }
});

// =====================================================
// CRIAR SERVIÇO
// =====================================================
router.post("/", upload.single("anexo"), async (req, res) => {
    try {
        await garantirSchema();
        const usuario = await getUsuario(req);

        const servico = String(req.body.servico || "").trim();
        if (!servico) {
            return res.status(400).json({ erro: "Informe o serviço" });
        }

        const { ids, nomes } = normalizarTecnicos(
            req.body.tecnicos_ids || req.body.tecnicos,
            req.body.tecnicos_nomes
        );

        const caminhoAnexo = req.file
            ? `/uploads/servicos-pendentes/${req.file.filename}`
            : null;

        const [result] = await pool.query(
            `
            INSERT INTO servicos_pendentes (
                empresa_id,
                servico,
                localidade,
                data_servico,
                nova_viabilidade,
                tecnicos_ids,
                tecnicos_nomes,
                descricao,
                prioridade,
                enviado_por,
                anexo,
                status,
                criado_por
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                usuario.empresa_id,
                servico,
                String(req.body.localidade || "").trim() || null,
                dataValidaOuNull(req.body.data_servico),
                normalizarBooleano(req.body.nova_viabilidade),
                serializarArray(ids),
                serializarArray(nomes),
                String(req.body.descricao || "").trim() || null,
                normalizarPrioridade(req.body.prioridade),
                usuario.usuario || "Usuário",
                caminhoAnexo,
                normalizarStatus(req.body.status),
                usuario.id
            ]
        );

        res.status(201).json({ sucesso: true, id: result.insertId });
    } catch (err) {
        if (req.file) removerArquivo(`/uploads/servicos-pendentes/${req.file.filename}`);
        responderErro(res, err, "Erro ao criar serviço");
    }
});

// =====================================================
// EDITAR SERVIÇO
// =====================================================
router.put("/:id", upload.single("anexo"), async (req, res) => {
    try {
        await garantirSchema();
        const usuario = await getUsuario(req);
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ erro: "ID do serviço inválido" });
        }

        const servico = String(req.body.servico || "").trim();
        if (!servico) {
            return res.status(400).json({ erro: "Informe o serviço" });
        }

        const { ids, nomes } = normalizarTecnicos(
            req.body.tecnicos_ids || req.body.tecnicos,
            req.body.tecnicos_nomes
        );

        const [existente] = await pool.query(
            `SELECT anexo FROM servicos_pendentes
             WHERE id = ? AND empresa_id = ? LIMIT 1`,
            [id, usuario.empresa_id]
        );

        if (!existente.length) {
            if (req.file) removerArquivo(`/uploads/servicos-pendentes/${req.file.filename}`);
            return res.status(404).json({ erro: "Serviço não encontrado" });
        }

        const anexoAntigo = existente[0].anexo;
        const caminhoAnexo = req.file
            ? `/uploads/servicos-pendentes/${req.file.filename}`
            : anexoAntigo;

        const [result] = await pool.query(
            `
            UPDATE servicos_pendentes
            SET
                servico = ?,
                localidade = ?,
                data_servico = ?,
                nova_viabilidade = ?,
                tecnicos_ids = ?,
                tecnicos_nomes = ?,
                descricao = ?,
                prioridade = ?,
                status = ?,
                anexo = ?,
                atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ? AND empresa_id = ?
            `,
            [
                servico,
                String(req.body.localidade || "").trim() || null,
                dataValidaOuNull(req.body.data_servico),
                normalizarBooleano(req.body.nova_viabilidade),
                serializarArray(ids),
                serializarArray(nomes),
                String(req.body.descricao || "").trim() || null,
                normalizarPrioridade(req.body.prioridade),
                normalizarStatus(req.body.status),
                caminhoAnexo,
                id,
                usuario.empresa_id
            ]
        );

        if (!result.affectedRows) {
            if (req.file) removerArquivo(caminhoAnexo);
            return res.status(404).json({ erro: "Serviço não encontrado" });
        }

        if (req.file && anexoAntigo && anexoAntigo !== caminhoAnexo) {
            removerArquivo(anexoAntigo);
        }

        res.json({ sucesso: true });
    } catch (err) {
        if (req.file) removerArquivo(`/uploads/servicos-pendentes/${req.file.filename}`);
        responderErro(res, err, "Erro ao editar serviço");
    }
});

// =====================================================
// EXCLUIR SERVIÇO
// =====================================================
router.delete("/:id", async (req, res) => {
    try {
        await garantirSchema();
        const usuario = await getUsuario(req);
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ erro: "ID do serviço inválido" });
        }

        const [rows] = await pool.query(
            `SELECT anexo FROM servicos_pendentes
             WHERE id = ? AND empresa_id = ? LIMIT 1`,
            [id, usuario.empresa_id]
        );

        if (!rows.length) {
            return res.status(404).json({ erro: "Serviço não encontrado" });
        }

        const [result] = await pool.query(
            `DELETE FROM servicos_pendentes WHERE id = ? AND empresa_id = ?`,
            [id, usuario.empresa_id]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ erro: "Serviço não encontrado" });
        }

        removerArquivo(rows[0].anexo);
        res.json({ sucesso: true });
    } catch (err) {
        responderErro(res, err, "Erro ao excluir serviço");
    }
});

module.exports = router;
