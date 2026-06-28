const express = require("express");
const router = express.Router();
const db = require("../database");

function verificarAutenticacao(req, res, next){
    const usuarioId = req.headers["x-usuario-id"];

    if(!usuarioId){
        return res.status(401).json({ erro:"Não autorizado" });
    }

    next();
}

router.get("/", verificarAutenticacao, async (req, res) => {
    try{
        const usuarioId = req.headers["x-usuario-id"];

        const [[usuario]] = await db.query(
            "SELECT empresa_id FROM usuarios WHERE id = ?",
            [usuarioId]
        );

        const [rows] = await db.query(`
            SELECT 
                e.id,
                e.tecnico_id,
                t.nome AS tecnico,
                e.data_escala,
                e.periodo,
                e.empresa_id
            FROM escalas e
            INNER JOIN tecnicos t ON t.id = e.tecnico_id
            WHERE e.empresa_id = ?
            ORDER BY e.data_escala ASC, t.nome ASC
        `, [usuario.empresa_id]);

        res.json(rows);

    }catch(err){
        console.error(err);
        res.status(500).json({ erro:"Erro ao carregar escalas" });
    }
});

router.post("/", verificarAutenticacao, async (req, res) => {
    try{
        const usuarioId = req.headers["x-usuario-id"];
        const { tecnico_id, data_escala, periodo } = req.body;

        if(!tecnico_id || !data_escala || !periodo){
            return res.status(400).json({ erro:"Dados obrigatórios ausentes" });
        }

        const [[usuario]] = await db.query(
            "SELECT empresa_id FROM usuarios WHERE id = ?",
            [usuarioId]
        );

        await db.query(`
            INSERT INTO escalas 
            (tecnico_id, data_escala, periodo, empresa_id)
            VALUES (?, ?, ?, ?)
        `, [
            tecnico_id,
            data_escala,
            periodo,
            usuario.empresa_id
        ]);

        res.json({ success:true });

    }catch(err){
        console.error(err);
        res.status(500).json({ erro:"Erro ao adicionar escala" });
    }
});

router.delete("/:id", verificarAutenticacao, async (req, res) => {
    try{
        const usuarioId = req.headers["x-usuario-id"];
        const { id } = req.params;

        const [[usuario]] = await db.query(
            "SELECT empresa_id FROM usuarios WHERE id = ?",
            [usuarioId]
        );

        await db.query(
            "DELETE FROM escalas WHERE id = ? AND empresa_id = ?",
            [id, usuario.empresa_id]
        );

        res.json({ success:true });

    }catch(err){
        console.error(err);
        res.status(500).json({ erro:"Erro ao excluir escala" });
    }
});

module.exports = router;