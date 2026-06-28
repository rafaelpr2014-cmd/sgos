const express = require("express");
const router = express.Router();

const verificarAutenticacao = require("../middlewares/verificarAutenticacao");
const db = require("../config/db"); // ajuste se o seu for outro caminho

// ===============================
// LISTAR LOGS
// ===============================
router.get("/", verificarAutenticacao, async (req, res) => {
    try {

        const [rows] = await db.query(`
            SELECT 
                id,
                COALESCE(usuario, 'desconhecido') AS usuario,
                COALESCE(acao, 'sem ação') AS acao,
                COALESCE(modulo, '-') AS modulo,
                referencia_id,
                COALESCE(detalhes, '') AS detalhes,
                created_at
            FROM logs_acoes
            ORDER BY id DESC
            LIMIT 200
        `);

        res.json(rows);

    } catch (err) {
        console.error("ERRO LOGS:", err);
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;