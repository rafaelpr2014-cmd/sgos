module.exports = (db, verificarAutenticacao) => {

    const express = require("express");
    const router = express.Router();

    // ===============================
    // LISTAR PLANOS
    // ===============================
    router.get("/", verificarAutenticacao, async (req, res) => {

        try {

            const [rows] = await db.query(`
                SELECT
                    id,
                    nome
                FROM planos
                WHERE empresa_id = ?
                ORDER BY nome ASC
            `,[req.usuario.empresa_id]);

            res.json(rows);

        } catch (err) {

            console.error("ERRO PLANOS:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    // ===============================
    // ADICIONAR PLANO
    // ===============================
    router.post("/", verificarAutenticacao, async (req, res) => {

        try {

            const { nome } = req.body;

            if(!nome){

                return res.status(400).json({
                    message:"Nome obrigatório"
                });

            }

            await db.query(`
                INSERT INTO planos
                (
                    nome,
                    empresa_id
                )
                VALUES (?, ?)
            `,[

                nome,
                req.usuario.empresa_id

            ]);

            res.json({
                success:true
            });

        } catch (err) {

            console.error("ERRO ADD PLANO:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    // ===============================
    // EDITAR PLANO
    // ===============================
    router.put("/:id", verificarAutenticacao, async (req, res) => {

        try {

            const { id } = req.params;

            const { nome } = req.body;

            await db.query(`
                UPDATE planos
                SET nome = ?
                WHERE id = ?
                AND empresa_id = ?
            `,[

                nome,
                id,
                req.usuario.empresa_id

            ]);

            res.json({
                success:true
            });

        } catch (err) {

            console.error("ERRO EDITAR PLANO:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    // ===============================
    // EXCLUIR PLANO
    // ===============================
    router.delete("/:id", verificarAutenticacao, async (req, res) => {

        try {

            const { id } = req.params;

            await db.query(`
                DELETE FROM planos
                WHERE id = ?
                AND empresa_id = ?
            `,[

                id,
                req.usuario.empresa_id

            ]);

            res.json({
                success:true
            });

        } catch (err) {

            console.error("ERRO DELETE PLANO:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    return router;

};