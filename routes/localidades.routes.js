module.exports = (db, verificarAutenticacao) => {
    const express = require("express");
    const router = express.Router();

    // LISTAR LOCALIDADES
    router.get("/", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await db.query(`
                SELECT id, nome
                FROM localidades
                WHERE empresa_id = ?
                ORDER BY nome ASC
            `, [req.usuario.empresa_id]);

            res.json(rows);

        } catch (err) {
            console.error("ERRO LOCALIDADES:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    return router;
};