const db = require("../database");

async function obterPermissoes(req, res, next) {

    try {

        if (!req.usuario?.id) {
            return res.status(401).json({ erro: "Não autenticado" });
        }

        const cargo =
            String(req.usuario.cargo || "")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .trim()
                .toLowerCase();

        const isAdmin = cargo === "administrador";

        if (isAdmin) {

            req.permissoes = {
                localidades: [],
                tecnicos: [],
                isAdmin: true
            };

            return next();
        }

        const [localidades] = await db.query(`
            SELECT localidade_id
            FROM usuario_localidades
            WHERE usuario_id = ?
        `, [req.usuario.id]);

        const [tecnicos] = await db.query(`
            SELECT tecnico_id
            FROM usuario_tecnicos
            WHERE usuario_id = ?
        `, [req.usuario.id]);

        req.permissoes = {
            localidades: localidades.map(l => l.localidade_id),
            tecnicos: tecnicos.map(t => t.tecnico_id),
            isAdmin: false
        };

        next();

    } catch (err) {

        console.error("ERRO PERMISSOES:", err);

        res.status(500).json({
            erro: "Erro ao carregar permissões"
        });
    }
}

module.exports = { obterPermissoes };
