const express = require("express");

module.exports = (db, verificarAutenticacao) => {

const router = express.Router();

// ==========================
// LISTAR TÉCNICOS
// ==========================
router.get("/", verificarAutenticacao, async (req, res) => {

    try {

        const [rows] = await db.query(`
            SELECT
                id,
                nome,
                ativo
            FROM tecnicos
            WHERE empresa_id = ?
            ORDER BY nome ASC
        `, [req.usuario.empresa_id]);

        res.json(rows);

    } catch (err) {

        console.error("ERRO AO LISTAR TÉCNICOS:", err);

        res.status(500).json({
            erro: err.message
        });

    }

});

// ==========================
// CADASTRAR TÉCNICO
// ==========================
router.post("/", verificarAutenticacao, async (req, res) => {

    try {

        const { nome } = req.body;

        if (!nome || nome.trim() === "") {

            return res.status(400).json({
                erro: "Nome é obrigatório."
            });

        }

        const [result] = await db.query(`
            INSERT INTO tecnicos
            (
                nome,
                ativo,
                empresa_id
            )
            VALUES (?, 1, ?)
        `, [
            nome.trim(),
            req.usuario.empresa_id
        ]);

        res.json({
            sucesso: true,
            id: result.insertId
        });

    } catch (err) {

        console.error("ERRO AO CADASTRAR TÉCNICO:", err);

        res.status(500).json({
            erro: err.message
        });

    }

});

// ==========================
// EDITAR TÉCNICO
// ==========================
router.put("/:id", verificarAutenticacao, async (req, res) => {

    try {

        const { id } = req.params;
        const { nome, ativo } = req.body;

        const [result] = await db.query(`
            UPDATE tecnicos
            SET
                nome = ?,
                ativo = ?
            WHERE
                id = ?
                AND empresa_id = ?
        `, [
            nome,
            ativo,
            id,
            req.usuario.empresa_id
        ]);

        if (result.affectedRows === 0) {

            return res.status(404).json({
                erro: "Técnico não encontrado."
            });

        }

        res.json({
            sucesso: true
        });

    } catch (err) {

        console.error("ERRO AO EDITAR TÉCNICO:", err);

        res.status(500).json({
            erro: err.message
        });

    }

});

// ==========================
// EXCLUIR TÉCNICO
// ==========================
router.delete("/:id", verificarAutenticacao, async (req, res) => {

    try {

        const { id } = req.params;

        const [result] = await db.query(`
            DELETE FROM tecnicos
            WHERE
                id = ?
                AND empresa_id = ?
        `, [
            id,
            req.usuario.empresa_id
        ]);

        if (result.affectedRows === 0) {

            return res.status(404).json({
                erro: "Técnico não encontrado."
            });

        }

        res.json({
            sucesso: true
        });

    } catch (err) {

        console.error("ERRO AO EXCLUIR TÉCNICO:", err);

        res.status(500).json({
            erro: err.message
        });

    }

});

return router;

};
