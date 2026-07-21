const express = require("express");

module.exports = (pool, verificarAutenticacao) => {
    const router = express.Router();
    const OFFLINE_MINUTOS = 5;
    const LIMITE_EVENTOS = 300;

    function somenteEmpresa1(req, res, next) {
        if (Number(req.usuario?.empresa_id) !== 1) {
            return res.status(403).json({ erro: "Página disponível somente para usuários da empresa 1." });
        }
        next();
    }

    router.use(verificarAutenticacao, somenteEmpresa1);

    router.get("/acesso", (req, res) => {
        res.json({ permitido: true, usuario: req.usuario });
    });

    async function atualizarInativos() {
        await pool.query(
            `UPDATE log_acessos
             SET status = 'offline'
             WHERE logout IS NULL
               AND status = 'ativo'
               AND ultimo_ping IS NOT NULL
               AND ultimo_ping <= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
            [OFFLINE_MINUTOS]
        );
    }

    // Mantém sessões ativas e somente os 300 registros encerrados mais recentes.
    async function limparLogsAntigos() {
        try {
            await pool.query(`
                DELETE FROM log_acessos
                WHERE logout IS NOT NULL
                  AND id NOT IN (
                      SELECT id FROM (
                          SELECT id
                          FROM log_acessos
                          WHERE logout IS NOT NULL
                          ORDER BY id DESC
                          LIMIT ${LIMITE_EVENTOS}
                      ) AS ultimos
                  )
            `);
        } catch (err) {
            console.warn("Não foi possível limpar logs antigos de acesso:", err.message);
        }
    }

    router.get("/usuarios", async (req, res) => {
        try {
            await atualizarInativos();

            const [usuarios] = await pool.query(`
                SELECT
                    u.id,
                    u.usuario AS nome,
                    u.usuario AS login,
                    u.cargo AS tipo,
                    u.empresa_id,
                    COALESCE(e.nome_provedor, CONCAT('Empresa ', u.empresa_id)) AS empresa_nome,
                    CASE WHEN COALESCE(sa.sessoes_online, 0) > 0 THEN 'online' ELSE 'offline' END AS status,
                    COALESCE(sa.sessoes_online, 0) AS sessoes_online,
                    la.id AS log_id,
                    la.login AS conectado_em,
                    la.ultimo_ping AS ultima_atividade,
                    la.logout AS desconectado_em,
                    la.ip_origem AS ip,
                    la.porta_origem
                FROM usuarios u
                LEFT JOIN empresa e ON e.id = u.empresa_id
                LEFT JOIN (
                    SELECT usuario_id, COUNT(*) AS sessoes_online, MAX(id) AS ultimo_log_id
                    FROM log_acessos
                    WHERE logout IS NULL
                      AND status = 'ativo'
                      AND ultimo_ping > DATE_SUB(NOW(), INTERVAL ${OFFLINE_MINUTOS} MINUTE)
                    GROUP BY usuario_id
                ) sa ON sa.usuario_id = u.id
                LEFT JOIN log_acessos la ON la.id = COALESCE(
                    sa.ultimo_log_id,
                    (SELECT MAX(l2.id) FROM log_acessos l2 WHERE l2.usuario_id = u.id)
                )
                WHERE COALESCE(u.ativo, 1) = 1
                ORDER BY CASE WHEN COALESCE(sa.sessoes_online, 0) > 0 THEN 0 ELSE 1 END,
                         empresa_nome, u.usuario
            `);

            const online = usuarios.filter(u => u.status === "online").length;
            const empresas = new Set(usuarios.map(u => Number(u.empresa_id))).size;

            res.json({
                usuarios,
                resumo: {
                    total_usuarios: usuarios.length,
                    online,
                    offline: usuarios.length - online,
                    empresas
                }
            });
        } catch (err) {
            console.error("ERRO AO LISTAR USUÁRIOS ONLINE:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    router.get("/eventos", async (req, res) => {
        const limite = Math.min(Math.max(Number(req.query.limite) || LIMITE_EVENTOS, 1), LIMITE_EVENTOS);
        try {
            await limparLogsAntigos();
            const [sessoes] = await pool.query(`
                SELECT l.id, l.usuario_id, l.usuario, l.empresa_id,
                       COALESCE(e.nome_provedor, CONCAT('Empresa ', l.empresa_id)) AS empresa_nome,
                       l.ip_origem AS ip, l.porta_origem, l.login, l.logout,
                       l.status, l.motivo_logout
                FROM log_acessos l
                LEFT JOIN empresa e ON e.id = l.empresa_id
                ORDER BY l.id DESC
                LIMIT ?
            `, [limite]);

            const eventos = [];
            for (const s of sessoes) {
                if (s.login) eventos.push({
                    chave: `${s.id}-login`, log_id: s.id, usuario_id: s.usuario_id,
                    usuario: s.usuario, empresa_id: s.empresa_id, empresa_nome: s.empresa_nome,
                    tipo: 'conexao', ocorrido_em: s.login, ip: s.ip,
                    porta_origem: s.porta_origem, motivo: 'Login realizado'
                });
                if (s.logout) eventos.push({
                    chave: `${s.id}-logout`, log_id: s.id, usuario_id: s.usuario_id,
                    usuario: s.usuario, empresa_id: s.empresa_id, empresa_nome: s.empresa_nome,
                    tipo: 'desconexao', ocorrido_em: s.logout, ip: s.ip,
                    porta_origem: s.porta_origem, motivo: s.motivo_logout || 'Sessão encerrada'
                });
            }
            eventos.sort((a, b) => new Date(b.ocorrido_em) - new Date(a.ocorrido_em));
            res.json({ eventos: eventos.slice(0, limite) });
        } catch (err) {
            console.error("ERRO AO LISTAR EVENTOS DE ACESSO:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    router.get("/usuarios/:usuarioId/logs", async (req, res) => {
        const usuarioId = Number(req.params.usuarioId);
        const limite = Math.min(Math.max(Number(req.query.limite) || 100, 1), 100);
        if (!usuarioId) return res.status(400).json({ erro: "Usuário inválido." });

        try {
            const [sessoes] = await pool.query(`
                SELECT id, usuario_id, empresa_id, ip_origem AS ip, porta_origem,
                       login, logout, ultimo_ping, status, motivo_logout
                FROM log_acessos
                WHERE usuario_id = ?
                ORDER BY id DESC
                LIMIT ?
            `, [usuarioId, limite]);

            const logs = [];
            for (const item of sessoes) {
                if (item.login) logs.push({
                    id: `${item.id}-login`, tipo: 'conexao', ip: item.ip,
                    porta_origem: item.porta_origem, motivo: 'Login realizado', ocorrido_em: item.login
                });
                if (item.logout) logs.push({
                    id: `${item.id}-logout`, tipo: 'desconexao', ip: item.ip,
                    porta_origem: item.porta_origem,
                    motivo: item.motivo_logout || 'Sessão encerrada', ocorrido_em: item.logout
                });
            }
            logs.sort((a, b) => new Date(b.ocorrido_em) - new Date(a.ocorrido_em));
            res.json({ logs: logs.slice(0, limite), limite });
        } catch (err) {
            console.error("ERRO AO CARREGAR HISTÓRICO:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    router.post("/usuarios/:usuarioId/deslogar", async (req, res) => {
        const usuarioId = Number(req.params.usuarioId);
        if (!usuarioId) return res.status(400).json({ erro: "Usuário inválido." });

        try {
            const [usuarios] = await pool.query(
                `SELECT id, usuario, empresa_id FROM usuarios WHERE id = ? LIMIT 1`,
                [usuarioId]
            );
            if (!usuarios.length) return res.status(404).json({ erro: "Usuário não encontrado." });

            const alvo = usuarios[0];
            let resultado;

            // logout é o campo que efetivamente invalida a sessão no verificarAutenticacao.
            // Usa offline para não depender de ENUM que talvez não aceite o valor "logout".
            try {
                [resultado] = await pool.query(`
                    UPDATE log_acessos
                    SET logout = NOW(), status = 'offline', motivo_logout = 'deslogado_administrador_empresa_1'
                    WHERE usuario_id = ? AND logout IS NULL
                `, [usuarioId]);
            } catch (erroComMotivo) {
                console.warn("Tentativa sem motivo_logout:", erroComMotivo.message);
                [resultado] = await pool.query(`
                    UPDATE log_acessos
                    SET logout = NOW(), status = 'offline'
                    WHERE usuario_id = ? AND logout IS NULL
                `, [usuarioId]);
            }

            const io = req.app.get("io");
            if (io) {
                io.emit("sgos:forcar-logout", {
                    usuario_id: usuarioId,
                    motivo: "Sessão encerrada pela administração SGOS"
                });
            }

            try {
                await pool.query(`
                    INSERT INTO logs_acoes (usuario, acao, modulo, referencia_id, detalhes)
                    VALUES (?, 'DESLOGAR_USUARIO', 'SESSAO', ?, ?)
                `, [req.usuario.usuario, usuarioId,
                    `Usuário ${alvo.usuario} da empresa ${alvo.empresa_id} teve ${resultado.affectedRows} sessão(ões) encerrada(s)`]);
            } catch (logErr) {
                console.warn("Não foi possível registrar a ação administrativa:", logErr.message);
            }

            res.json({
                ok: true,
                sessoes_encerradas: resultado.affectedRows,
                mensagem: resultado.affectedRows
                    ? `${resultado.affectedRows} sessão(ões) de ${alvo.usuario} encerrada(s) com sucesso.`
                    : `${alvo.usuario} não possui sessão ativa.`
            });
        } catch (err) {
            console.error("ERRO AO DESLOGAR USUÁRIO:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    return router;
};
