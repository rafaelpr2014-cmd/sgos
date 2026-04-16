module.exports = (db, verificarAutenticacao) => {
    const express = require("express");
    const router = express.Router();

    // LISTAR PLANOS
    router.get("/", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await db.query(`
                SELECT id, nome
                FROM planos
                WHERE empresa_id = ?
                ORDER BY nome ASC
            `, [req.usuario.empresa_id]);

            res.json(rows);

        } catch (err) {
            console.error("ERRO PLANOS:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    return router;
};