module.exports = (pool, verificarAutenticacao) => {
    const express = require("express");
    const router = express.Router();

    router.get("/", verificarAutenticacao, async (req,res) => {
        try{
            const empresaLogada = Number(req.usuario.empresa_id);
            const empresaSolicitada = Number(req.query.empresa_id || empresaLogada);

            // Usuários comuns enxergam somente a própria empresa.
            // Empresa 1 pode consultar outra empresa por query string.
            const empresaConsulta = empresaLogada === 1
                ? empresaSolicitada
                : empresaLogada;

            const [rows] = await pool.query(`
                SELECT
                    la.id,
                    la.empresa_id,
                    e.nome_provedor AS empresa_nome,
                    la.usuario,
                    la.acao,
                    la.modulo,
                    la.referencia_id,
                    la.detalhes,
                    la.created_at
                FROM logs_acoes la
                LEFT JOIN empresa e
                    ON e.id = la.empresa_id
                WHERE la.empresa_id = ?
                ORDER BY la.created_at DESC, la.id DESC
                LIMIT 2000
            `,[empresaConsulta]);

            res.json(rows);
        }catch(err){
            console.error("ERRO AO LISTAR LOGS DE AÇÕES:",err);
            res.status(500).json({erro:err.message});
        }
    });

    return router;
};
