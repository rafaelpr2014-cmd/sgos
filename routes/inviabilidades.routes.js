const express = require("express");
const router = express.Router();
const pool = require("../database");

router.get("/", async (req, res) => {
    try {
        const usuarioId = req.headers["x-usuario-id"];

        if (!usuarioId) {
            return res.status(401).json({ erro: "Usuário não informado" });
        }

        const [usuarios] = await pool.query(
            "SELECT empresa_id FROM usuarios WHERE id = ? LIMIT 1",
            [usuarioId]
        );

        const empresaId = usuarios.length ? usuarios[0].empresa_id : null;

        let sql = `
    SELECT
        os.*,
        l.nome AS localidade_nome,
        p.nome AS plano_nome,
        ts.nome AS tipo_servico_nome,

        COALESCE(u.usuario, os.finalizado_por) AS finalizado_por_nome,

        GROUP_CONCAT(DISTINCT tec.nome SEPARATOR ', ') AS tecnicos_nomes

    FROM ordens_servico os
    LEFT JOIN localidades l ON l.id = os.localidade
    LEFT JOIN planos p ON p.id = os.plano
    LEFT JOIN tipos_servico ts ON ts.id = os.tipo_servico
    LEFT JOIN usuarios u ON u.id = os.finalizado_por

    LEFT JOIN tecnicos tec
        ON FIND_IN_SET(tec.id, REPLACE(REPLACE(REPLACE(os.tecnico, '[', ''), ']', ''), '"', ''))

    WHERE LOWER(TRIM(os.status)) LIKE '%inviabilidade%'
`;

        const params = [];

        if (empresaId) {
            sql += " AND (os.empresa_id = ? OR os.empresa_id IS NULL)";
            params.push(empresaId);
        }

sql += `
    GROUP BY os.id
`;

        sql += `
            ORDER BY
                COALESCE(
                    os.finalizado_em,
                    os.criado_em,
                    os.agendamento
                ) DESC,
                os.id DESC
        `;

        const [rows] = await pool.query(sql, params);

        res.json(rows);

    } catch (err) {
        console.error("Erro ao listar inviabilidades:", err);
        res.status(500).json({
            erro: "Erro ao listar inviabilidades",
            detalhes: err.sqlMessage
        });
    }
});

module.exports = router;