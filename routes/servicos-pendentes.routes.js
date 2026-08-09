const express = require("express");
const router = express.Router();
const pool = require("../database");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "..", "uploads", "servicos-pendentes");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination(req, file, cb) { cb(null, uploadDir); },
    filename(req, file, cb) {
        const ext = path.extname(file.originalname || "").toLowerCase();
        const base = path.basename(file.originalname || "anexo", ext)
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "anexo";
        cb(null, `${Date.now()}_${base}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        const permitidos = new Set([
            "image/jpeg", "image/png", "image/webp", "image/gif",
            "application/pdf", "video/mp4", "video/quicktime", "video/webm"
        ]);
        if (!permitidos.has(file.mimetype)) return cb(new Error("Tipo de arquivo não permitido"));
        cb(null, true);
    }
});

let schemaPromise = null;
function garantirSchema() {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
        const comandos = [
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS data_servico DATE NULL AFTER localidade",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS data_agendamento DATETIME NULL AFTER data_servico",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS nova_viabilidade TINYINT(1) NOT NULL DEFAULT 0 AFTER data_servico",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS tecnicos_ids LONGTEXT NULL AFTER nova_viabilidade",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS tecnicos_nomes LONGTEXT NULL AFTER tecnicos_ids",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS atualizado_por VARCHAR(150) NULL AFTER criado_por",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,7) NULL AFTER atualizado_por",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7) NULL AFTER latitude",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS altitude DECIMAL(10,2) NULL AFTER longitude",
            "ALTER TABLE servicos_pendentes ADD COLUMN IF NOT EXISTS localizacao_atualizada_em DATETIME NULL AFTER altitude",
            "ALTER TABLE servicos_pendentes MODIFY COLUMN status VARCHAR(30) NOT NULL DEFAULT 'Pendente'"
        ];
        for (const sql of comandos) await pool.query(sql);
    })().catch(err => { schemaPromise = null; throw err; });
    return schemaPromise;
}

async function getUsuario(req) {
    const usuarioId = req.headers["x-usuario-id"];
    if (!usuarioId) { const e = new Error("Usuário não informado"); e.statusCode = 401; throw e; }
    const [rows] = await pool.query("SELECT id, usuario, empresa_id FROM usuarios WHERE id = ? LIMIT 1", [usuarioId]);
    if (!rows.length) { const e = new Error("Usuário inválido"); e.statusCode = 401; throw e; }
    return rows[0];
}

function normalizarPrioridade(v) {
    const p = String(v || "").trim().toLowerCase();
    if (p === "alta") return "Alta";
    if (p === "baixa") return "Baixa";
    return "Média";
}
function normalizarStatus(v) {
    const status = String(v || "").trim().toLowerCase();
    if (["realizado", "realizada", "concluido", "concluído", "finalizado", "finalizada"].includes(status)) {
        return "Realizado";
    }
    return "Pendente";
}
function normalizarBooleano(v) {
    const x = typeof v === "string" ? v.toLowerCase().trim() : v;
    return [true, 1, "1", "true", "sim", "on"].includes(x) ? 1 : 0;
}
function dataValidaOuNull(v) {
    const x = String(v || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null;
}
function dataHoraValidaOuNull(v) {
    const x = String(v || "").trim();
    if (!x) return null;
    const m = x.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return `${m[1]} ${m[2]}:${m[3]}:${m[4] || "00"}`;
}
function numeroOuNull(v, min, max) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(typeof v === "string" ? v.trim().replace(",", ".") : v);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return n;
}
function parseArray(v) {
    if (Array.isArray(v)) return v;
    if (v === null || v === undefined || v === "") return [];
    try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; }
    catch { return String(v).split(",").map(x => x.trim()).filter(Boolean); }
}
function normalizarTecnicos(idsRecebidos, nomesRecebidos) {
    const ids = [...new Set(parseArray(idsRecebidos).map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (ids.length > 4) { const e = new Error("Selecione no máximo 4 técnicos"); e.statusCode = 400; throw e; }
    const nomes = parseArray(nomesRecebidos).map(x => String(x || "").trim()).filter(Boolean).slice(0, 4);
    return { ids, nomes };
}
function serializarArray(a) { return a.length ? JSON.stringify(a) : null; }
function parsearLinha(row) {
    return {
        ...row,
        nova_viabilidade: Boolean(Number(row.nova_viabilidade)),
        tecnicos_ids: parseArray(row.tecnicos_ids).map(Number).filter(Boolean),
        tecnicos_nomes: parseArray(row.tecnicos_nomes),
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
        altitude: row.altitude === null ? null : Number(row.altitude)
    };
}
function removerArquivo(caminhoPublico) {
    if (!caminhoPublico) return;
    const arquivo = path.resolve(__dirname, "..", String(caminhoPublico).replace(/^\/+/, ""));
    const raiz = path.resolve(__dirname, "..", "uploads") + path.sep;
    if (!arquivo.startsWith(raiz)) return;
    fs.unlink(arquivo, err => { if (err && err.code !== "ENOENT") console.error("Erro ao remover anexo:", err); });
}
function responderErro(res, err, msg) {
    console.error(msg, err);
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ erro: "O anexo deve ter no máximo 30 MB" });
    res.status(err.statusCode || 500).json({ erro: err.message || msg });
}

router.get("/", async (req, res) => {
    try {
        await garantirSchema();
        const usuario = await getUsuario(req);
        const where = ["empresa_id = ?"];
        const params = [usuario.empresa_id];
        const status = String(req.query.status || "").trim();
        const localidade = String(req.query.localidade || "").trim();
        const inicio = dataValidaOuNull(req.query.data_inicio);
        const fim = dataValidaOuNull(req.query.data_fim);
        const agendamento = dataValidaOuNull(req.query.data_agendamento);
        const prioridade = String(req.query.prioridade || "").trim();
        const busca = String(req.query.busca || "").trim();
        if (status) { where.push("status = ?"); params.push(normalizarStatus(status)); }
        if (localidade) { where.push("localidade = ?"); params.push(localidade); }
        if (inicio) { where.push("COALESCE(data_servico, DATE(criado_em)) >= ?"); params.push(inicio); }
        if (fim) { where.push("COALESCE(data_servico, DATE(criado_em)) <= ?"); params.push(fim); }
        if (agendamento) { where.push("DATE(data_agendamento) = ?"); params.push(agendamento); }
        if (prioridade) { where.push("prioridade = ?"); params.push(normalizarPrioridade(prioridade)); }
        if (busca) {
            const t = `%${busca}%`;
            where.push("(servico LIKE ? OR localidade LIKE ? OR descricao LIKE ? OR prioridade LIKE ? OR enviado_por LIKE ? OR atualizado_por LIKE ? OR tecnicos_nomes LIKE ?)");
            params.push(t, t, t, t, t, t, t);
        }
        const [rows] = await pool.query(`
            SELECT id, empresa_id, servico, localidade, data_servico,
                   DATE_FORMAT(data_agendamento, '%Y-%m-%d %H:%i:%s') AS data_agendamento,
                   nova_viabilidade,
                   tecnicos_ids, tecnicos_nomes, descricao, prioridade, enviado_por,
                   anexo, status, criado_por, atualizado_por, latitude, longitude, altitude,
                   DATE_FORMAT(criado_em, '%Y-%m-%d %H:%i:%s') AS criado_em,
                   DATE_FORMAT(atualizado_em, '%Y-%m-%d %H:%i:%s') AS atualizado_em,
                   DATE_FORMAT(localizacao_atualizada_em, '%Y-%m-%d %H:%i:%s') AS localizacao_atualizada_em
            FROM servicos_pendentes
            WHERE ${where.join(" AND ")}
            ORDER BY COALESCE(data_servico, DATE(criado_em)) DESC, criado_em DESC
        `, params);
        res.json(rows.map(parsearLinha));
    } catch (err) { responderErro(res, err, "Erro ao listar serviços"); }
});

router.post("/", upload.single("anexo"), async (req, res) => {
    try {
        await garantirSchema();
        const usuario = await getUsuario(req);
        const servico = String(req.body.servico || "").trim();
        if (!servico) return res.status(400).json({ erro: "Informe o serviço" });
        const { ids, nomes } = normalizarTecnicos(req.body.tecnicos_ids || req.body.tecnicos, req.body.tecnicos_nomes);
        const caminhoAnexo = req.file ? `/uploads/servicos-pendentes/${req.file.filename}` : null;
        const [result] = await pool.query(`
            INSERT INTO servicos_pendentes
            (empresa_id, servico, localidade, data_servico, data_agendamento, nova_viabilidade, tecnicos_ids,
             tecnicos_nomes, descricao, prioridade, enviado_por, anexo, status, criado_por, atualizado_por,
             latitude, longitude, altitude, localizacao_atualizada_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [usuario.empresa_id, servico, String(req.body.localidade || "").trim() || null,
            dataValidaOuNull(req.body.data_servico), dataHoraValidaOuNull(req.body.data_agendamento),
            normalizarBooleano(req.body.nova_viabilidade), serializarArray(ids), serializarArray(nomes),
            String(req.body.descricao || "").trim() || null, normalizarPrioridade(req.body.prioridade),
            usuario.usuario || "Usuário", caminhoAnexo, normalizarStatus(req.body.status),
            usuario.id, usuario.usuario || "Usuário",
            numeroOuNull(req.body.latitude, -90, 90), numeroOuNull(req.body.longitude, -180, 180),
            numeroOuNull(req.body.altitude, -10000, 100000),
            (numeroOuNull(req.body.latitude, -90, 90) !== null && numeroOuNull(req.body.longitude, -180, 180) !== null)
                ? new Date() : null]);
        const [criado] = await pool.query(
            "SELECT id, status, DATE_FORMAT(data_agendamento, '%Y-%m-%d %H:%i:%s') AS data_agendamento FROM servicos_pendentes WHERE id=? LIMIT 1",
            [result.insertId]
        );
        res.status(201).json({ sucesso: true, id: result.insertId, servico: criado[0] });
    } catch (err) {
        if (req.file) removerArquivo(`/uploads/servicos-pendentes/${req.file.filename}`);
        responderErro(res, err, "Erro ao criar serviço");
    }
});

router.put("/:id", upload.single("anexo"), async (req, res) => {
    try {
        await garantirSchema();
        const usuario = await getUsuario(req);
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: "ID inválido" });
        const servico = String(req.body.servico || "").trim();
        if (!servico) return res.status(400).json({ erro: "Informe o serviço" });
        const { ids, nomes } = normalizarTecnicos(req.body.tecnicos_ids || req.body.tecnicos, req.body.tecnicos_nomes);
        const [existente] = await pool.query("SELECT anexo FROM servicos_pendentes WHERE id = ? AND empresa_id = ? LIMIT 1", [id, usuario.empresa_id]);
        if (!existente.length) return res.status(404).json({ erro: "Serviço não encontrado" });
        const anexoAntigo = existente[0].anexo;
        const caminhoAnexo = req.file ? `/uploads/servicos-pendentes/${req.file.filename}` : anexoAntigo;
        const [result] = await pool.query(`
            UPDATE servicos_pendentes SET servico=?, localidade=?, data_servico=?, data_agendamento=?, nova_viabilidade=?,
                tecnicos_ids=?, tecnicos_nomes=?, descricao=?, prioridade=?, status=?, anexo=?,
                latitude=?, longitude=?, altitude=?,
                localizacao_atualizada_em=CASE
                    WHEN ? IS NOT NULL AND ? IS NOT NULL THEN CURRENT_TIMESTAMP
                    ELSE localizacao_atualizada_em
                END,
                atualizado_por=?, atualizado_em=CURRENT_TIMESTAMP
            WHERE id=? AND empresa_id=?
        `, [servico, String(req.body.localidade || "").trim() || null,
            dataValidaOuNull(req.body.data_servico), dataHoraValidaOuNull(req.body.data_agendamento),
            normalizarBooleano(req.body.nova_viabilidade), serializarArray(ids), serializarArray(nomes),
            String(req.body.descricao || "").trim() || null, normalizarPrioridade(req.body.prioridade),
            normalizarStatus(req.body.status), caminhoAnexo,
            numeroOuNull(req.body.latitude, -90, 90), numeroOuNull(req.body.longitude, -180, 180),
            numeroOuNull(req.body.altitude, -10000, 100000),
            numeroOuNull(req.body.latitude, -90, 90), numeroOuNull(req.body.longitude, -180, 180),
            usuario.usuario || "Usuário", id, usuario.empresa_id]);
        if (!result.affectedRows) return res.status(404).json({ erro: "Serviço não encontrado" });
        if (req.file && anexoAntigo && anexoAntigo !== caminhoAnexo) removerArquivo(anexoAntigo);
        const [atualizado] = await pool.query(
            "SELECT id, status, latitude, longitude, altitude, atualizado_por, DATE_FORMAT(data_agendamento, '%Y-%m-%d %H:%i:%s') AS data_agendamento, DATE_FORMAT(atualizado_em, '%Y-%m-%d %H:%i:%s') AS atualizado_em FROM servicos_pendentes WHERE id=? AND empresa_id=? LIMIT 1",
            [id, usuario.empresa_id]
        );
        res.json({ sucesso: true, servico: atualizado[0] || { id, status: normalizarStatus(req.body.status) } });
    } catch (err) {
        if (req.file) removerArquivo(`/uploads/servicos-pendentes/${req.file.filename}`);
        responderErro(res, err, "Erro ao editar serviço");
    }
});

router.patch("/:id/localizacao", async (req, res) => {
    try {
        await garantirSchema();
        const usuario = await getUsuario(req);
        const id = Number(req.params.id);
        const latitude = numeroOuNull(req.body.latitude, -90, 90);
        const longitude = numeroOuNull(req.body.longitude, -180, 180);
        const altitude = numeroOuNull(req.body.altitude, -10000, 100000);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: "ID inválido" });
        if (latitude === null || longitude === null) return res.status(400).json({ erro: "Latitude e longitude são obrigatórias" });
        const [result] = await pool.query(`
            UPDATE servicos_pendentes SET latitude=?, longitude=?, altitude=?,
                localizacao_atualizada_em=CURRENT_TIMESTAMP, atualizado_por=?, atualizado_em=CURRENT_TIMESTAMP
            WHERE id=? AND empresa_id=?
        `, [latitude, longitude, altitude, usuario.usuario || "Usuário", id, usuario.empresa_id]);
        if (!result.affectedRows) return res.status(404).json({ erro: "Serviço não encontrado" });
        res.json({ sucesso: true });
    } catch (err) { responderErro(res, err, "Erro ao salvar localização"); }
});

router.delete("/:id/localizacao", async (req, res) => {
    try {
        await garantirSchema();
        const usuario = await getUsuario(req);
        const id = Number(req.params.id);
        const [result] = await pool.query(`
            UPDATE servicos_pendentes SET latitude=NULL, longitude=NULL, altitude=NULL,
                localizacao_atualizada_em=NULL, atualizado_por=?, atualizado_em=CURRENT_TIMESTAMP
            WHERE id=? AND empresa_id=?
        `, [usuario.usuario || "Usuário", id, usuario.empresa_id]);
        if (!result.affectedRows) return res.status(404).json({ erro: "Serviço não encontrado" });
        res.json({ sucesso: true });
    } catch (err) { responderErro(res, err, "Erro ao remover localização"); }
});

router.delete("/:id", async (req, res) => {
    try {
        await garantirSchema();
        const usuario = await getUsuario(req);
        const id = Number(req.params.id);
        const [rows] = await pool.query("SELECT anexo FROM servicos_pendentes WHERE id=? AND empresa_id=? LIMIT 1", [id, usuario.empresa_id]);
        if (!rows.length) return res.status(404).json({ erro: "Serviço não encontrado" });
        const [result] = await pool.query("DELETE FROM servicos_pendentes WHERE id=? AND empresa_id=?", [id, usuario.empresa_id]);
        if (!result.affectedRows) return res.status(404).json({ erro: "Serviço não encontrado" });
        removerArquivo(rows[0].anexo);
        res.json({ sucesso: true });
    } catch (err) { responderErro(res, err, "Erro ao excluir serviço"); }
});

module.exports = router;
