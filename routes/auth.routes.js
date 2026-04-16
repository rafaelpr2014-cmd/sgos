// D:\sdos\routes\auth.routes.js
module.exports = (db) => {
    const express = require("express");
    const router = express.Router();
    const bcrypt = require("bcryptjs");

    // 🔑 LOGIN
    router.post("/login", async (req, res) => {
        const { usuario, senha } = req.body;

        try {
            const [rows] = await db.promise().query(
                "SELECT id, usuario, senha, cargo, ativo, empresa_id FROM usuarios WHERE usuario = ?",
                [usuario]
            );

            if (rows.length === 0) {
                return res.status(401).json({ erro: "Usuário ou senha incorretos" });
            }

            const user = rows[0];

            if (!user.ativo) {
                return res.status(401).json({ erro: "Usuário desativado" });
            }

            const senhaValida = await bcrypt.compare(senha, user.senha);

            if (!senhaValida) {
                return res.status(401).json({ erro: "Usuário ou senha incorretos" });
            }

            res.json({
                sucesso: true,
                usuario: {
                    id: user.id,
                    nome: user.usuario,
                    cargo: user.cargo,
                    empresa_id: user.empresa_id
                }
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({ erro: "Erro no servidor" });
        }
    });

    return router;
};