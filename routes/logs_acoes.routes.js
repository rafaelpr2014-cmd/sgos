module.exports = (db, verificarAutenticacao) => {

    const express = require("express");
    const router = express.Router();

    // ===============================
    // LISTAR LOGS DE AÇÕES
    // ===============================
    router.get("/", verificarAutenticacao, async (req, res) => {

        try {

            const [rows] = await db.query(`
                SELECT 
                    id,
                    usuario,
                    acao,
                    modulo,
                    referencia_id,
                    detalhes,
                    created_at
                FROM logs_acoes
                ORDER BY id DESC
                LIMIT 200
            `);

            res.json(rows);

        } catch (err) {

            console.error(err);

            res.status(500).json({
                erro: "Erro ao buscar logs de ações"
            });
        }
    });

    return router;
};