module.exports = (db, verificarAutenticacao) => {
    const express = require("express");
    const router = express.Router();
    const osService = require("../services/os.service");

    // ===============================
    // 📋 LISTAR ORDENS
    // ===============================
    router.get("/", verificarAutenticacao, async (req, res) => {
        try {
            if (!req.usuario?.empresa_id) {
                return res.status(400).json({ erro: "empresa_id não informado" });
            }

            const { id: userId, cargo: rawCargo, empresa_id } = req.usuario;
            const cargo = String(rawCargo || "").trim().toLowerCase();

            let query = `
                SELECT 
                    os.*,
                    u.usuario AS criado_por_nome,
                    l.nome AS localidade_nome,
                    p.nome AS plano_nome,
                    ts.nome AS tipo_servico_nome,
                    (
                        SELECT JSON_ARRAYAGG(t.nome)
                        FROM tecnicos t
                        WHERE JSON_CONTAINS(os.tecnico, CAST(t.id AS JSON))
                    ) AS tecnicos_nomes
                FROM ordens_servico os
                LEFT JOIN usuarios u ON os.criado_por = u.id
                LEFT JOIN localidades l ON os.localidade = l.id
                LEFT JOIN planos p ON os.plano = p.id
                LEFT JOIN tipos_servico ts ON os.tipo_servico = ts.id
                WHERE os.empresa_id = ?
            `;

            let params = [empresa_id];

            if (cargo !== "administrador") {
                const [locs] = await db.query(
                    "SELECT localidade_id FROM usuario_localidades WHERE usuario_id=?",
                    [userId]
                );

                const [tecs] = await db.query(
                    "SELECT tecnico_id FROM usuario_tecnicos WHERE usuario_id=?",
                    [userId]
                );

                const locIds = locs.map(l => l.localidade_id);
                const tecIds = tecs.map(t => t.tecnico_id);

                if (!locIds.length && !tecIds.length) {
                    return res.json([]);
                }

                query += " AND (";
                const conditions = [];
                if (locIds.length) conditions.push(`os.localidade IN (?)`);
                if (tecIds.length) conditions.push(`JSON_OVERLAPS(os.tecnico, ?)`);
                query += conditions.join(" OR ") + ")";
                if (locIds.length) params.push(locIds);
                if (tecIds.length) params.push(JSON.stringify(tecIds));
            }

            query += " ORDER BY os.data_abertura DESC";
            const [rows] = await db.query(query, params);
            res.json(rows);

        } catch (err) {
            console.error("ERRO LISTAR OS:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    // ===============================
    // 🔹 LISTAR LOCALIDADES
    // ===============================
    router.get("/localidades", verificarAutenticacao, async (req, res) => {
        try {
            const [result] = await db.query(
                "SELECT id, nome FROM localidades WHERE empresa_id=?",
                [req.usuario.empresa_id]
            );
            res.json(result);
        } catch (err) {
            console.error("ERRO LOCALIDADES:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    // ===============================
    // 🔹 LISTAR TÉCNICOS
    // ===============================
    router.get("/tecnicos", verificarAutenticacao, async (req, res) => {
        try {
            const [result] = await db.query(
                "SELECT id, nome FROM tecnicos WHERE empresa_id=?",
                [req.usuario.empresa_id]
            );
            res.json(result);
        } catch (err) {
            console.error("ERRO TECNICOS:", err);
            res.status(500).json({ erro: err.message });
        }
    });

  // ===============================
// 🆕 CRIAR OS
// ===============================
router.post("/", verificarAutenticacao, async (req, res) => {
    try {
        console.log("🚀 Requisição CRIAR OS recebida");

        const resultado = await osService.criar(req.body, req.usuario);

        res.json(resultado);

    } catch (err) {
        console.error("🔥 ERRO REAL CRIAR OS:", err);
res.status(500).json({ erro: err.message });
    }
});

// ===============================
// 🗑️ EXCLUIR OS
// ===============================
router.delete("/:id", verificarAutenticacao, async (req, res) => {
    try {
        await db.query(
            "DELETE FROM ordens_servico WHERE id=? AND empresa_id=?",
            [req.params.id, req.usuario.empresa_id]
        );

        res.json({ sucesso: true });

    } catch (err) {
        console.error("ERRO EXCLUIR OS:", err);
        res.status(500).json({ erro: err.message });
    }
});

// ===============================
// 🚀 INICIAR OS
// ===============================
router.post("/iniciar/:id", verificarAutenticacao, async (req, res) => {
    try {
        const resultado = await osService.iniciarOS(req.params.id, req.usuario);
        res.json(resultado);
    } catch (err) {
        console.error("ERRO INICIAR OS:", err);
        res.status(500).json({ erro: "Erro ao iniciar OS" });
    }
});

// ===============================
// 🚫 CLIENTE AUSENTE
// ===============================
router.post("/ausente/:id", verificarAutenticacao, async (req, res) => {
    try {
        const resultado = await osService.clienteAusente(req.params.id, req.usuario);
        res.json(resultado);
    } catch (err) {
        console.error("ERRO CLIENTE AUSENTE:", err);
        res.status(500).json({ erro: "Erro ao marcar cliente ausente" });
    }
});

// ===============================
// ✅ CONCLUIR OS
// ===============================
router.post("/concluir/:id", verificarAutenticacao, async (req, res) => {
    try {
        const resultado = await osService.concluirOS(req.params.id, req.usuario);
        res.json(resultado);
    } catch (err) {
        console.error("ERRO CONCLUIR OS:", err);
        res.status(500).json({ erro: "Erro ao concluir OS" });
    }
});

module.exports = router;

    // ===============================
    // 🔍 BUSCAR OS POR ID
    // ===============================
    router.get("/:id", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await db.query(
                "SELECT * FROM ordens_servico WHERE id=? AND empresa_id=?",
                [req.params.id, req.usuario.empresa_id]
            );
            if (!rows.length) return res.status(404).json({ erro: "OS não encontrada" });
            res.json(rows[0]);
        } catch (err) {
            console.error("ERRO BUSCAR OS:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    return router;
};