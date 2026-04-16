module.exports = (db, verificarAutenticacao) => {
    const express = require("express");
    const router = express.Router();

    router.get("/", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await db.query(`
                SELECT id, nome
                FROM tipos_servico
                WHERE empresa_id = ?
                ORDER BY nome
            `, [req.usuario.empresa_id]);

            res.json(rows);

        } catch (err) {
            console.error("ERRO TIPOS SERVIÇO:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    return router;
};