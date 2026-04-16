module.exports = (db) => {
    const express = require("express");
    const router = express.Router();

    // ===============================
    // LOGIN
    // ===============================
    router.post("/login", async (req, res) => {
        const { usuario, senha } = req.body;
        if (!usuario || !senha) return res.status(400).json({ erro: "Preencha usuário e senha" });

        try {
            // ⚠️ Em produção, use bcrypt para comparar hash
            const [users] = await db.execute(
                `SELECT u.*, e.nome_provedor AS nome_provedor 
                 FROM usuarios u 
                 LEFT JOIN empresa e ON u.empresa_id = e.id 
                 WHERE u.usuario = ? AND u.senha = ?`,
                [usuario, senha]
            );

            if (users.length === 0) return res.status(401).json({ erro: "Usuário ou senha inválidos" });

            const user = users[0];

            // Checa se o usuario tem empresa_id
            if (!user.empresa_id) {
                return res.status(400).json({ erro: "Usuário sem empresa vinculada" });
            }

            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

            console.log("Dados do login:", {
                usuario: usuario,
                empresa_id: user.empresa_id,
                ip: ip
            });

            // Registrar login com empresa_id e status
            const [result] = await db.execute(
                `INSERT INTO log_acessos 
                 (usuario, empresa_id, ip_origem, login, ultimo_ping, status) 
                 VALUES (?, ?, ?, NOW(), NOW(), 'ativo')`,
                [usuario, user.empresa_id, ip]
            );

            res.json({
                ok: true,
                usuario: {
                    id: user.id,
                    nome: user.nome || user.usuario,
                    cargo: user.cargo,
                    empresa_id: user.empresa_id,
                    usuario: user.usuario,
                    nome_provedor: user.nome_provedor
                },
                log_id: result.insertId
            });
        } catch (err) {
            console.error("ERRO LOGIN:", err);
            res.status(500).json({ erro: "Erro no servidor" });
        }
    });

    // ===============================
    // LOGOUT
    // ===============================
    router.post("/logout", async (req, res) => {
        const { log_id } = req.body;
        if (!log_id) return res.status(400).json({ erro: "log_id não informado" });

        try {
            await db.execute(
                "UPDATE log_acessos SET logout = NOW(), status = 'logout' WHERE id = ?",
                [log_id]
            );
            res.json({ ok: true });
        } catch (err) {
            console.error("ERRO LOGOUT:", err);
            res.status(500).json({ erro: "Erro ao registrar logout" });
        }
    });

    // ===============================
    // PING - manter usuário ativo
    // ===============================
    router.post("/ping", async (req, res) => {
        const { log_id } = req.body;
        if (!log_id) return res.status(400).json({ erro: "log_id não informado" });

        try {
            await db.execute(
                "UPDATE log_acessos SET ultimo_ping = NOW(), status = 'ativo' WHERE id = ?",
                [log_id]
            );
            res.json({ ok: true });
        } catch (err) {
            console.error("ERRO PING:", err);
            res.status(500).json({ erro: "Erro no ping" });
        }
    });

    // ===============================
    // ME - retorna info do usuário logado
    // ===============================
    router.get("/me", async (req, res) => {
        try {
            const userId = req.headers["x-usuario-id"];
            if (!userId) return res.status(400).json({ erro: "Usuário não informado" });

            const [users] = await db.execute(
                `SELECT u.usuario, u.cargo, u.empresa_id, e.nome_provedor AS nome_provedor 
                 FROM usuarios u 
                 LEFT JOIN empresa e ON u.empresa_id = e.id 
                 WHERE u.id = ?`,
                [userId]
            );

            if (users.length === 0) return res.status(404).json({ erro: "Usuário não encontrado" });
            res.json(users[0]);
        } catch (err) {
            console.error("ERRO ME:", err);
            res.status(500).json({ erro: "Erro ao buscar usuário" });
        }
    });

    // ===============================
    // LOGS - usuários ativos e inativos
    // ===============================
    router.get("/logs", async (req, res) => {
        try {
            const inactiveLimit = 20 * 60; // 20 minutos
            const [logs] = await db.execute("SELECT * FROM log_acessos ORDER BY id DESC");

            const logsAtualizados = await Promise.all(logs.map(async log => {
                if (!log.logout) {
                    const diff = (new Date() - new Date(log.ultimo_ping)) / 1000;
                    if (diff > inactiveLimit) {
                        await db.execute(
                            "UPDATE log_acessos SET logout = NOW(), status = 'inativo' WHERE id = ?",
                            [log.id]
                        );
                        log.logout = new Date();
                        log.status = 'inativo';
                    }
                }
                return log;
            }));

            res.json(logsAtualizados);
        } catch (err) {
            console.error("ERRO LOGS:", err);
            res.status(500).json({ erro: "Erro ao carregar logs" });
        }
    });

    return router;
};