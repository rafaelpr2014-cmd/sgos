const express = require("express");
const router = express.Router();
const db = require("../database");
const verificarAutenticacao = require("../middlewares/auth.middleware");

// 📦 PLANOS - LISTAR
router.get("/api/planos", verificarAutenticacao, async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            "SELECT id, nome FROM planos WHERE empresa_id = ?",
            [req.usuario.empresa_id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// 📦 PLANOS - CRIAR
router.post("/api/planos", verificarAutenticacao, async (req, res) => {
    try {
        await db.promise().query(
            "INSERT INTO planos (nome, empresa_id) VALUES (?, ?)",
            [req.body.nome, req.usuario.empresa_id]
        );
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;

// ===============================
// 📦 DADOS AUXILIARES (BLINDADO)
app.get("/api/localidades", verificarAutenticacao, (req, res) => {
    db.query(
        "SELECT id, nome FROM localidades WHERE empresa_id = ?",
        [req.usuario.empresa_id],
        (err, result) => err ? res.status(500).json(err) : res.json(result)
    );
});

app.get("/api/tecnicos", verificarAutenticacao, (req, res) => {
    db.query(
        "SELECT id, nome FROM tecnicos WHERE ativo = 1 AND empresa_id = ?",
        [req.usuario.empresa_id],
        (err, result) => err ? res.status(500).json(err) : res.json(result)
    );
});

app.get("/api/servicos", verificarAutenticacao, (req, res) => {
    db.query(
        "SELECT id, nome FROM tipos_servico WHERE empresa_id = ?",
        [req.usuario.empresa_id],
        (err, result) => err ? res.status(500).json(err) : res.json(result)
    );
});