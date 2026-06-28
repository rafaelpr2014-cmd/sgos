module.exports = (db, verificarAutenticacao) => {

    const express = require("express");
    const router = express.Router();

    // ===============================
    // LISTAR TIPOS
    // ===============================
    router.get("/", verificarAutenticacao, async (req, res) => {

        try {

            const [rows] = await db.query(`
                SELECT
                    id,
                    nome
                FROM tipos_servico
                WHERE empresa_id = ?
                ORDER BY nome ASC
            `, [req.usuario.empresa_id]);

            res.json(rows);

        } catch (err) {

            console.error("ERRO TIPOS SERVICO:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    // ===============================
    // ADICIONAR
    // ===============================
    router.post("/", verificarAutenticacao, async (req, res) => {

        try {

            const { nome } = req.body;

            if (!nome) {

                return res.status(400).json({
                    message: "Nome obrigatório"
                });

            }

            await db.query(`
                INSERT INTO tipos_servico
                (nome, empresa_id)
                VALUES (?, ?)
            `, [
                nome,
                req.usuario.empresa_id
            ]);

            res.json({
                success: true
            });

        } catch (err) {

            console.error("ERRO ADD TIPO SERVICO:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    // ===============================
    // EDITAR
    // ===============================
    router.put("/:id", verificarAutenticacao, async (req, res) => {

        try {

            const { id } = req.params;
            const { nome } = req.body;

            await db.query(`
                UPDATE tipos_servico
                SET nome = ?
                WHERE id = ?
                AND empresa_id = ?
            `, [
                nome,
                id,
                req.usuario.empresa_id
            ]);

            res.json({
                success: true
            });

        } catch (err) {

            console.error("ERRO EDIT TIPO SERVICO:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    // ===============================
    // EXCLUIR
    // ===============================
    router.delete("/:id", verificarAutenticacao, async (req, res) => {

        try {

            const { id } = req.params;

            await db.query(`
                DELETE FROM tipos_servico
                WHERE id = ?
                AND empresa_id = ?
            `, [
                id,
                req.usuario.empresa_id
            ]);

            res.json({
                success: true
            });

        } catch (err) {

            console.error("ERRO DELETE TIPO SERVICO:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    return router;

};