const db = require("../database");

async function verificarAutenticacao(req, res, next) {
    const usuarioId = req.headers["x-usuario-id"];
    const usuarioNome = req.headers["x-usuario-nome"];

    if (!usuarioId || !usuarioNome) {
        return res.status(401).json({ erro: "Não autenticado" });
    }

    try {
        const [result] = await db.promise().query(
            `SELECT u.id, u.usuario, u.cargo, u.empresa_id
             FROM usuarios u
             WHERE u.id = ?`,
            [usuarioId]
        );

        if (!result[0]) {
            return res.status(401).json({ erro: "Usuário não encontrado" });
        }

        req.usuario = result[0];

        next();
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao autenticar" });
    }
}

module.exports = { verificarAutenticacao };