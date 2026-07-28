const bcrypt = require("bcryptjs");

module.exports = (db) => {
    const express = require("express");
    const router = express.Router();

    const MAX_SESSOES = 3;
    const LIMITE_SESSAO_HORAS = 8;
    const LIMITE_OFFLINE_MINUTOS = 5;

    async function query(sql, params = []) {
        if (typeof db.execute === "function") {
            return db.execute(sql, params);
        }
        if (typeof db.query === "function") {
            return db.query(sql, params);
        }
        if (typeof db.promise === "function") {
            return db.promise().query(sql, params);
        }
        throw new Error("Conexão com banco incompatível");
    }

    function getClientIP(req) {
        let ip =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.headers["x-real-ip"] ||
            req.socket?.remoteAddress ||
            req.connection?.remoteAddress ||
            req.ip ||
            "DESCONHECIDO";

        if (ip === "::1") ip = "127.0.0.1";
        if (ip.includes("::ffff:")) ip = ip.replace("::ffff:", "");
        return ip;
    }

    async function senhaCorreta(senhaInformada, senhaSalva) {
        if (!senhaSalva) return false;
        const hashBcrypt = /^\$2[aby]\$/.test(String(senhaSalva));
        return hashBcrypt
            ? bcrypt.compare(String(senhaInformada), String(senhaSalva))
            : String(senhaInformada) === String(senhaSalva);
    }

    async function encerrarSessoesExpiradas(usuario, empresaId) {
        await query(
            `UPDATE log_acessos
                SET logout = COALESCE(logout, NOW()),
                    status = 'logout'
              WHERE usuario = ?
                AND empresa_id = ?
                AND logout IS NULL
                AND status <> 'logout'
                AND COALESCE(ultimo_ping, login) < DATE_SUB(NOW(), INTERVAL ${LIMITE_SESSAO_HORAS} HOUR)`,
            [usuario, empresaId]
        );
    }

    async function contarSessoesAbertas(usuario, empresaId) {
        const [rows] = await query(
            `SELECT COUNT(*) AS total
               FROM log_acessos
              WHERE usuario = ?
                AND empresa_id = ?
                AND logout IS NULL
                AND status <> 'logout'
                AND COALESCE(ultimo_ping, login) >= DATE_SUB(NOW(), INTERVAL ${LIMITE_SESSAO_HORAS} HOUR)`,
            [usuario, empresaId]
        );
        return Number(rows[0]?.total || 0);
    }

    router.post("/login", async (req, res) => {
        const { usuario, senha } = req.body || {};
        if (!usuario || !senha) {
            return res.status(400).json({ erro: "Preencha usuário e senha" });
        }

        try {
            const [users] = await query(
                `SELECT u.*, e.nome_provedor AS nome_provedor
                   FROM usuarios u
              LEFT JOIN empresa e ON e.id = u.empresa_id
                  WHERE u.usuario = ?
                  LIMIT 1`,
                [usuario]
            );

            if (!users.length || !(await senhaCorreta(senha, users[0].senha))) {
                return res.status(401).json({ erro: "Usuário ou senha inválidos" });
            }

            const user = users[0];
            if (!user.empresa_id) {
                return res.status(400).json({ erro: "Usuário sem empresa vinculada" });
            }
            if (user.ativo === 0 || user.ativo === false) {
                return res.status(401).json({ erro: "Usuário desativado" });
            }

            await encerrarSessoesExpiradas(user.usuario, user.empresa_id);
            const sessoesAbertas = await contarSessoesAbertas(user.usuario, user.empresa_id);

            if (sessoesAbertas >= MAX_SESSOES) {
                return res.status(409).json({
                    erro: `Limite de ${MAX_SESSOES} acessos simultâneos atingido para este usuário.`,
                    motivo: "limite_sessoes",
                    limite: MAX_SESSOES,
                    sessoes_ativas: sessoesAbertas
                });
            }

            const ip = getClientIP(req);
            const porta = req.headers["x-real-port"] || req.socket?.remotePort || null;
            const [result] = await query(
                `INSERT INTO log_acessos
                    (usuario, empresa_id, ip_origem, porta_origem, login, ultimo_ping, status)
                 VALUES (?, ?, ?, ?, NOW(), NOW(), 'ativo')`,
                [user.usuario, user.empresa_id, ip, porta]
            );

            return res.json({
                ok: true,
                usuario: {
                    id: user.id,
                    nome: user.nome || user.usuario,
                    usuario: user.usuario,
                    cargo: user.cargo,
                    empresa_id: user.empresa_id,
                    nome_provedor: user.nome_provedor
                },
                log_id: result.insertId,
                sessoes_ativas: sessoesAbertas + 1,
                limite_sessoes: MAX_SESSOES
            });
        } catch (err) {
            console.error("ERRO LOGIN:", err);
            return res.status(500).json({ erro: "Erro no servidor" });
        }
    });

    router.post("/logout", async (req, res) => {
        const logId = req.body?.log_id || req.query?.log_id || req.headers["x-log-id"];
        if (!logId) return res.status(400).json({ erro: "log_id não informado" });

        try {
            const [result] = await query(
                `UPDATE log_acessos
                    SET logout = COALESCE(logout, NOW()),
                        status = 'logout'
                  WHERE id = ?`,
                [logId]
            );

            if (!result.affectedRows) {
                return res.status(404).json({ erro: "Sessão não encontrada" });
            }
            return res.json({ ok: true });
        } catch (err) {
            console.error("ERRO LOGOUT:", err);
            return res.status(500).json({ erro: "Erro ao registrar logout" });
        }
    });

    router.post("/ping", async (req, res) => {
        const logId = req.body?.log_id || req.headers["x-log-id"];
        const ativo = req.body?.ativo !== false && req.body?.ativo !== 0;
        if (!logId) return res.status(400).json({ erro: "log_id não informado" });

        try {
            const [result] = await query(
                `UPDATE log_acessos
                    SET ultimo_ping = NOW(),
                        status = ?
                  WHERE id = ?
                    AND logout IS NULL
                    AND status <> 'logout'`,
                [ativo ? "ativo" : "inativo", logId]
            );

            if (!result.affectedRows) {
                return res.status(401).json({
                    erro: "Sessão encerrada ou inválida",
                    motivo: "sessao_encerrada"
                });
            }
            return res.json({ ok: true });
        } catch (err) {
            console.error("ERRO PING:", err);
            return res.status(500).json({ erro: "Erro no ping" });
        }
    });

    router.get("/me", async (req, res) => {
        try {
            const userId = req.headers["x-usuario-id"];
            const logId = req.headers["x-log-id"];
            if (!userId || !logId) {
                return res.status(401).json({ erro: "Sessão não informada", motivo: "sessao_invalida" });
            }

            const [sessions] = await query(
                `SELECT id FROM log_acessos
                  WHERE id = ? AND logout IS NULL AND status <> 'logout'
                    AND COALESCE(ultimo_ping, login) >= DATE_SUB(NOW(), INTERVAL ${LIMITE_SESSAO_HORAS} HOUR)
                  LIMIT 1`,
                [logId]
            );
            if (!sessions.length) {
                return res.status(401).json({ erro: "Sessão encerrada", motivo: "sessao_encerrada" });
            }

            const [users] = await query(
                `SELECT u.id, u.usuario, u.cargo, u.empresa_id, e.nome_provedor, e.logo
                   FROM usuarios u
              LEFT JOIN empresa e ON e.id = u.empresa_id
                  WHERE u.id = ? LIMIT 1`,
                [userId]
            );
            if (!users.length) return res.status(404).json({ erro: "Usuário não encontrado" });

            const u = users[0];
            return res.json({
                id: u.id,
                usuario: u.usuario,
                cargo: u.cargo,
                empresa_id: u.empresa_id,
                empresa_nome: u.nome_provedor,
                empresa_logo: u.logo ? `/uploads/logos/${u.logo}` : null
            });
        } catch (err) {
            console.error("ERRO ME:", err);
            return res.status(500).json({ erro: "Erro ao buscar usuário" });
        }
    });

    router.get("/logs", async (req, res) => {
        try {
            const empresaId = req.headers["x-empresa-id"];
            if (!empresaId) return res.status(400).json({ erro: "Empresa não informada" });

            await query(
                `UPDATE log_acessos
                    SET logout = COALESCE(logout, NOW()), status = 'logout'
                  WHERE empresa_id = ?
                    AND logout IS NULL
                    AND status <> 'logout'
                    AND COALESCE(ultimo_ping, login) < DATE_SUB(NOW(), INTERVAL ${LIMITE_SESSAO_HORAS} HOUR)`,
                [empresaId]
            );

            const [logs] = await query(
                `SELECT id, usuario, empresa_id, ip_origem, porta_origem,
                        login, logout, ultimo_ping, status
                   FROM log_acessos
                  WHERE empresa_id = ?
                  ORDER BY id DESC
                  LIMIT 300`,
                [empresaId]
            );

            const agora = Date.now();
            return res.json(logs.map((log) => {
                if (log.ip_origem === "::1") log.ip_origem = "127.0.0.1";
                if (log.ip_origem?.includes("::ffff:")) {
                    log.ip_origem = log.ip_origem.replace("::ffff:", "");
                }
                if (log.status !== "logout" && !log.logout) {
                    const base = new Date(log.ultimo_ping || log.login).getTime();
                    log.status = agora - base > LIMITE_OFFLINE_MINUTOS * 60 * 1000 ? "inativo" : "ativo";
                }
                return log;
            }));
        } catch (err) {
            console.error("ERRO LOGS:", err);
            return res.status(500).json({ erro: "Erro ao carregar logs" });
        }
    });

    return router;
};
