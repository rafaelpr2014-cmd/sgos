const express = require("express");

module.exports = (db, verificarAutenticacao) => {

const router = express.Router();

// ==========================
// LISTAR TÉCNICOS
// ==========================
router.get("/", verificarAutenticacao, async (req, res) => {
    try {
        const cargo = String(req.usuario.cargo || "").trim().toLowerCase();
        let sql = `
            SELECT t.id, t.nome, t.ativo
            FROM tecnicos t
            WHERE t.empresa_id = ?
        `;
        const params = [req.usuario.empresa_id];

        if (cargo !== "administrador") {
            sql += `
                AND EXISTS (
                    SELECT 1
                    FROM usuario_tecnicos ut
                    WHERE ut.usuario_id = ?
                      AND ut.empresa_id = t.empresa_id
                      AND ut.tecnico_id = t.id
                )
            `;
            params.push(req.usuario.id);
        }

        sql += " ORDER BY t.nome ASC";
        const [rows] = await db.query(sql, params);
        res.json(rows);
    } catch (err) {
        console.error("ERRO AO LISTAR TÉCNICOS:", err);
        res.status(500).json({ erro: err.message });
    }
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
