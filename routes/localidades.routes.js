module.exports = (db, verificarAutenticacao) => {

    const express = require("express");
    const router = express.Router();

    // ==========================
    // LISTAR LOCALIDADES
    // ==========================
    router.get("/", verificarAutenticacao, async (req, res) => {

        try {

            const [rows] = await db.query(`
                SELECT
                    id,
                    nome,
                    vlan
                FROM localidades
                WHERE empresa_id = ?
                ORDER BY nome ASC
            `, [req.usuario.empresa_id]);

            res.json(rows);

        } catch (err) {

            console.error("ERRO AO LISTAR LOCALIDADES:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    // ==========================
    // CADASTRAR LOCALIDADE
    // ==========================
    router.post("/", verificarAutenticacao, async (req, res) => {

        try {

            const { nome, vlan } = req.body;

            if (!nome || nome.trim() === "") {
                return res.status(400).json({
                    erro: "Nome da localidade é obrigatório."
                });
            }

            const [result] = await db.query(`
                INSERT INTO localidades
                (
                    empresa_id,
                    nome,
                    vlan
                )
                VALUES (?, ?, ?)
            `, [
                req.usuario.empresa_id,
                nome.trim(),
                vlan || null
            ]);

            res.json({
                sucesso: true,
                id: result.insertId
            });

        } catch (err) {

            console.error("ERRO AO CADASTRAR LOCALIDADE:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    // ==========================
    // EDITAR LOCALIDADE
    // ==========================
    router.put("/:id", verificarAutenticacao, async (req, res) => {

        try {

            const { id } = req.params;
            const { nome, vlan } = req.body;

            if (!nome || nome.trim() === "") {
                return res.status(400).json({
                    erro: "Nome da localidade é obrigatório."
                });
            }

            const [result] = await db.query(`
                UPDATE localidades
                SET
                    nome = ?,
                    vlan = ?
                WHERE
                    id = ?
                    AND empresa_id = ?
            `, [
                nome.trim(),
                vlan || null,
                id,
                req.usuario.empresa_id
            ]);

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    erro: "Localidade não encontrada."
                });
            }

            res.json({
                sucesso: true
            });

        } catch (err) {

            console.error("ERRO AO EDITAR LOCALIDADE:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    // ==========================
    // EXCLUIR LOCALIDADE
    // ==========================
    router.delete("/:id", verificarAutenticacao, async (req, res) => {

        try {

            const { id } = req.params;

            const [result] = await db.query(`
                DELETE FROM localidades
                WHERE
                    id = ?
                    AND empresa_id = ?
            `, [
                id,
                req.usuario.empresa_id
            ]);

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    erro: "Localidade não encontrada."
                });
            }

            res.json({
                sucesso: true
            });

        } catch (err) {

            console.error("ERRO AO EXCLUIR LOCALIDADE:", err);

            res.status(500).json({
                erro: err.message
            });

        }

    });

    return router;

};