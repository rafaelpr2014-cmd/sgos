const db = require("../database");

async function verificarAutenticacao(req, res, next) {
    const usuarioId = Number(req.headers["x-usuario-id"]);
    const logId = Number(req.headers["x-log-id"]);
    const empresaIdHeader = Number(req.headers["x-empresa-id"] || 0);

    if (!usuarioId || !logId) {
        return res.status(401).json({
            erro: "Não autenticado",
            motivo: "sessao_invalida"
        });
    }

    try {
        const [rows] = await db.query(
            `SELECT
                u.id,
                u.usuario,
                u.cargo,
                u.empresa_id,
                u.ativo,
                l.id AS log_id,
                l.logout,
                l.status,
                l.ultimo_ping
             FROM usuarios u
             INNER JOIN log_acessos l
                     ON l.usuario_id = u.id
                    AND l.id = ?
            WHERE u.id = ?
              AND l.logout IS NULL
              AND l.status <> 'logout'
              AND COALESCE(u.ativo, 1) = 1
              AND (? = 0 OR u.empresa_id = ?)
            LIMIT 1`,
            [logId, usuarioId, empresaIdHeader, empresaIdHeader]
        );

        if (!rows.length) {
            return res.status(401).json({
                erro: "Sessão inválida ou encerrada",
                motivo: "sessao_encerrada"
            });
        }

        req.usuario = {
            id: rows[0].id,
            usuario: rows[0].usuario,
            cargo: rows[0].cargo,
            empresa_id: rows[0].empresa_id
        };
        req.log_id = logId;
        next();
    } catch (err) {
        console.error("ERRO AUTH MIDDLEWARE:", err);
        return res.status(500).json({ erro: "Erro ao autenticar" });
    }
}

module.exports = { verificarAutenticacao };
