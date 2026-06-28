module.exports = (db) => {

    const express = require("express");
    const router = express.Router();

    // ===============================
    // FUNÇÃO NORMALIZAR IP
    // ===============================
    function getClientIP(req) {

        let ip =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.headers["x-real-ip"] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.ip;

        if (!ip) return "DESCONHECIDO";

        // IPv6 localhost
        if (ip === "::1") {
            ip = "127.0.0.1";
        }

        // Remove ::ffff:
        if (ip.includes("::ffff:")) {
            ip = ip.replace("::ffff:", "");
        }

        return ip;
    }

    // ===============================
    // LOGIN
    // ===============================
    router.post("/login", async (req, res) => {

        console.log("🔥 AUTH LOGIN ATIVO");

        const { usuario, senha } = req.body;

        if (!usuario || !senha) {

            return res.status(400).json({
                erro: "Preencha usuário e senha"
            });
        }

        try {

            const [users] = await db.execute(
                `SELECT 
                    u.*, 
                    e.nome_provedor AS nome_provedor 
                 FROM usuarios u 
                 LEFT JOIN empresa e 
                    ON u.empresa_id = e.id 
                 WHERE u.usuario = ? 
                 AND u.senha = ?`,
                [usuario, senha]
            );

            if (users.length === 0) {

                return res.status(401).json({
                    erro: "Usuário ou senha inválidos"
                });
            }

            const user = users[0];

            if (!user.empresa_id) {

                return res.status(400).json({
                    erro: "Usuário sem empresa vinculada"
                });
            }

            // ===============================
            // IP REAL
            // ===============================
            const ip = getClientIP(req);

            const porta =
                req.headers["x-real-port"] ||
                req.socket.remotePort ||
                req.connection.remotePort ||
                null;

            console.log("LOGIN:", {
                usuario,
                empresa_id: user.empresa_id,
                ip,
                porta
            });

            // ===============================
            // SALVA LOG
            // ===============================
            const [result] = await db.execute(
                `INSERT INTO log_acessos 
                (
                    usuario,
                    empresa_id,
                    ip_origem,
                    porta_origem,
                    login,
                    ultimo_ping,
                    status
                )
                VALUES
                (
                    ?, ?, ?, ?, NOW(), NOW(), 'ativo'
                )`,
                [
                    usuario,
                    user.empresa_id,
                    ip,
                    porta
                ]
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

            res.status(500).json({
                erro: "Erro no servidor"
            });
        }
    });

    // ===============================
    // LOGOUT
    // ===============================
    router.post("/logout", async (req, res) => {

        const { log_id } = req.body;

        if (!log_id) {

            return res.status(400).json({
                erro: "log_id não informado"
            });
        }

        try {

            await db.execute(
                `UPDATE log_acessos 
                 SET 
                    logout = NOW(),
                    status = 'logout'
                 WHERE id = ?`,
                [log_id]
            );

            console.log("🚪 LOGOUT:", log_id);

            res.json({
                ok: true
            });

        } catch (err) {

            console.error("ERRO LOGOUT:", err);

            res.status(500).json({
                erro: "Erro ao registrar logout"
            });
        }
    });

    // ===============================
    // PING
    // ===============================
    router.post("/ping", async (req, res) => {

        const { log_id } = req.body;

        if (!log_id) {

            return res.status(400).json({
                erro: "log_id não informado"
            });
        }

        try {

            await db.execute(
                `UPDATE log_acessos 
                 SET 
                    ultimo_ping = NOW(),
                    status = 'ativo'
                 WHERE id = ?
                 AND status != 'logout'`,
                [log_id]
            );

            res.json({
                ok: true
            });

        } catch (err) {

            console.error("ERRO PING:", err);

            res.status(500).json({
                erro: "Erro no ping"
            });
        }
    });

    // ===============================
    // ME
    // ===============================
    router.get("/me", async (req, res) => {

        try {

            const userId = req.headers["x-usuario-id"];

            if (!userId) {

                return res.status(400).json({
                    erro: "Usuário não informado"
                });
            }

            const [users] = await db.execute(
                `SELECT 
                    u.id,
                    u.usuario,
                    u.cargo,
                    u.empresa_id,
                    e.nome_provedor,
                    e.logo
                 FROM usuarios u
                 LEFT JOIN empresa e
                    ON u.empresa_id = e.id
                 WHERE u.id = ?`,
                [userId]
            );

            if (users.length === 0) {

                return res.status(404).json({
                    erro: "Usuário não encontrado"
                });
            }

            const u = users[0];

            res.json({
                id: u.id,
                usuario: u.usuario,
                cargo: u.cargo,
                empresa_id: u.empresa_id,
                empresa_nome: u.nome_provedor,
                empresa_logo: u.logo
                    ? `/uploads/logos/${u.logo}`
                    : null
            });

        } catch (err) {

            console.error("ERRO ME:", err);

            res.status(500).json({
                erro: "Erro ao buscar usuário"
            });
        }
    });

    // ===============================
    // LOGS
    // ===============================
    router.get("/logs", async (req, res) => {

        try {

            // 5 MINUTOS
            const inactiveLimit = 300;

            const [logs] = await db.execute(
                `SELECT * 
                 FROM log_acessos 
                 ORDER BY id DESC`
            );

            const logsAtualizados = logs.map(log => {

                // ===============================
                // NORMALIZA IP
                // ===============================
                if (log.ip_origem) {

                    if (log.ip_origem.includes("::ffff:")) {

                        log.ip_origem =
                            log.ip_origem.replace("::ffff:", "");
                    }

                    if (log.ip_origem === "::1") {

                        log.ip_origem = "127.0.0.1";
                    }
                }

                // ===============================
                // STATUS DINÂMICO
                // ===============================
                if (log.status !== "logout") {

                    const agora = new Date();

                    const ultimoPing =
                        new Date(log.ultimo_ping);

                    const diff =
                        (agora - ultimoPing) / 1000;

                    if (diff > inactiveLimit) {

                        log.status = "inativo";

                    } else {

                        log.status = "ativo";
                    }
                }

                return log;
            });

            res.json(logsAtualizados);

        } catch (err) {

            console.error("ERRO LOGS:", err);

            res.status(500).json({
                erro: "Erro ao carregar logs"
            });
        }
    });

    return router;
};