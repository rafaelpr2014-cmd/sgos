module.exports = (db, verificarAutenticacao) => {
    const express = require("express");
    const router = express.Router();

    // Listar logs
    router.get("/", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await db.execute(
                "SELECT * FROM log_acessos ORDER BY login DESC LIMIT 100"
            );
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ erro: "Erro ao buscar logs" });
        }
    });

    return router;
};