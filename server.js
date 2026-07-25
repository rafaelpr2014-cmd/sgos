// ===============================
// IMPORTS
// ===============================
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const integracoesRoutes = require("./routes/integracoes.routes");
const servicosPendentesRoutes = require("./routes/servicos-pendentes.routes");
const inviabilidadeRoutes = require("./routes/inviabilidades.routes");
const viabilidadeRoutes = require("./routes/viabilidade.routes");
const svasRoutes = require("./routes/svas.routes");
const lembretesRoutes = require("./routes/lembretes.routes");
const estoqueRoutes = require('./routes/estoque.routes');
const escritoriosRoutesFactory = require('./routes/escritorios.routes');
const financeiroRoutesFactory = require('./routes/financeiro.routes');

const viabilidadeClientesErpRoutesFactory =
    require("./routes/viabilidade-clientes-erp.routes");

const pool = require("./database");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const whatsappRoutes = require("./routes/whatsappRoutes");
const { criarSessaoCentral } = require("./services/whatsappService");
const empresaRoutes = require("./routes/empresa.routes");
const escalaRoutes = require("./routes/escala.routes");
const osAvulsasRoutes = require("./routes/os-avulsas.routes");
const cronJobs = require("./cron/jobs");
const pushRoutes = require("./routes/push.routes");
const pushService = require("./services/push.service");
const relatoriosAutomaticosRoutes = require('./routes/relatorios-automaticos.routes');


// ===============================
// INIT
// ===============================
const app = express();
app.set("trust proxy", true);
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" }
});

const port = 3000;

cronJobs(pool);
require("./services/agendamento.service")(pool, io);

// Restaura a sessão central logo na inicialização do servidor.
// A falha não derruba o SGOS; o QR continuará disponível pela página administrativa.
try {
    criarSessaoCentral();
} catch (err) {
    console.error("❌ Falha ao iniciar WhatsApp central:", err.message);
}

// 🔥 disponibiliza IO globalmente
app.set("io", io);
app.set("pushService", pushService(pool));

const onlineUsers = new Map();

const OFFLINE_MINUTOS = 5;
const LOGOUT_AUTOMATICO_HORAS = 8;

// Sessões do aplicativo móvel permanecem válidas até logout manual.
// A coluna é criada automaticamente para manter compatibilidade com bancos existentes.
async function garantirColunaSessaoApp() {
    try {
        const [colunas] = await pool.query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'log_acessos'
              AND COLUMN_NAME = 'app_mobile'
            LIMIT 1
        `);

        if (!colunas.length) {
            await pool.query(`
                ALTER TABLE log_acessos
                ADD COLUMN app_mobile TINYINT(1) NOT NULL DEFAULT 0 AFTER status
            `);
        }
    } catch (err) {
        console.error("ERRO AO PREPARAR SESSÃO DO APP:", err.message);
    }
}

function requisicaoDoApp(req) {
    const cabecalho = String(req.headers["x-sgos-app"] || "").trim().toLowerCase();
    const corpo = String(req.body?.app_mobile ?? req.body?.is_app ?? "").trim().toLowerCase();
    return ["1", "true", "sim", "mobile", "app"].includes(cabecalho) ||
           ["1", "true", "sim", "mobile", "app"].includes(corpo);
}

setTimeout(() => garantirColunaSessaoApp(), 1000);

async function registrarEventoAcesso({ usuario = "desconhecido", acao, detalhes = "-" }) {
    try {
        await pool.query(
            `INSERT INTO logs_acoes (usuario, acao, modulo, referencia_id, detalhes)
             VALUES (?, ?, 'SESSAO', NULL, ?)`,
            [usuario, acao, detalhes]
        );
    } catch (err) {
        console.error("ERRO AO REGISTRAR EVENTO DE SESSÃO:", err.message);
    }
}

async function garantirTabelaEventosUsuariosOnline() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS usuarios_online_eventos (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            log_id BIGINT NULL,
            usuario_id BIGINT NULL,
            usuario VARCHAR(150) NOT NULL,
            empresa_id BIGINT NULL,
            ip VARCHAR(100) NULL,
            porta_origem VARCHAR(30) NULL,
            tipo VARCHAR(30) NOT NULL,
            motivo VARCHAR(255) NULL,
            ocorrido_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_eventos_data (ocorrido_em),
            KEY idx_eventos_usuario (usuario_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function registrarEventoUsuariosOnline(logId, tipo, motivo) {
    try {
        await garantirTabelaEventosUsuariosOnline();
        const [rows] = await pool.query(
            `SELECT id, usuario_id, usuario, empresa_id, ip_origem, porta_origem
             FROM log_acessos WHERE id = ? LIMIT 1`,
            [logId]
        );
        if (!rows.length) return;
        const s = rows[0];
        await pool.query(
            `INSERT INTO usuarios_online_eventos
             (log_id, usuario_id, usuario, empresa_id, ip, porta_origem, tipo, motivo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [s.id, s.usuario_id, s.usuario, s.empresa_id, s.ip_origem, s.porta_origem, tipo, motivo]
        );
        await pool.query(`
            DELETE FROM usuarios_online_eventos
            WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id FROM usuarios_online_eventos ORDER BY id DESC LIMIT 300
                ) ultimos
            )
        `);
    } catch (err) {
        console.error("ERRO AO REGISTRAR EVENTO DE USUÁRIOS ONLINE:", err.message);
    }
}

setTimeout(() => garantirTabelaEventosUsuariosOnline().catch(err =>
    console.error("ERRO AO PREPARAR EVENTOS DE USUÁRIOS ONLINE:", err.message)
), 2000);

async function atualizarStatusPresenca(logId, novoStatus, motivo = null) {
    const [rows] = await pool.query(
        `SELECT id, usuario, status, logout FROM log_acessos WHERE id = ? LIMIT 1`,
        [logId]
    );

    if (!rows.length || rows[0].logout) return null;
    const atual = rows[0];

    if (atual.status !== novoStatus) {
        await pool.query(
            `UPDATE log_acessos SET status = ? WHERE id = ? AND logout IS NULL`,
            [novoStatus, logId]
        );

        await registrarEventoAcesso({
            usuario: atual.usuario,
            acao: novoStatus === "ativo" ? "USUARIO_ONLINE" : "USUARIO_OFFLINE",
            detalhes: motivo || (novoStatus === "ativo"
                ? "Usuário voltou a interagir com o sistema"
                : "Usuário sem atividade por 5 minutos")
        });
    }

    return atual;
}

async function expirarSessoesInativas() {
    try {
        const [sessoes] = await pool.query(
            `SELECT id, usuario
             FROM log_acessos
             WHERE logout IS NULL
               AND COALESCE(app_mobile, 0) = 0
               AND ultimo_ping IS NOT NULL
               AND ultimo_ping <= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
            [LOGOUT_AUTOMATICO_HORAS]
        );

        for (const sessao of sessoes) {
            await pool.query(
                `UPDATE log_acessos
                 SET logout = NOW(), status = 'logout', motivo_logout = 'inatividade_8h'
                 WHERE id = ? AND logout IS NULL`,
                [sessao.id]
            );

            await registrarEventoAcesso({
                usuario: sessao.usuario,
                acao: "LOGOUT_AUTOMATICO",
                detalhes: "Sessão encerrada após 8 horas sem atividade"
            });
            await registrarEventoUsuariosOnline(sessao.id, "expirado", "Logout — sessão expirada");
        }
    } catch (err) {
        console.error("ERRO AO EXPIRAR SESSÕES:", err.message);
    }
}

setInterval(expirarSessoesInativas, 60 * 1000);
setTimeout(expirarSessoesInativas, 5000);

// ===============================
// SOCKET.IO REALTIME PRESENCE
// ===============================
io.on("connection", (socket) => {

    console.log("📡 Cliente conectado:", socket.id);

    // ===============================
    // ENTRADA DO USUÁRIO
    // ===============================
    socket.on("join", (user) => {

        if (!user?.id || !user?.empresa_id) return;

        const key = `${user.empresa_id}:${user.id}`;

        onlineUsers.set(key, {
            id: user.id,
            usuario: user.usuario,
            empresa_id: user.empresa_id,
            socket_id: socket.id,
            last_seen: Date.now()
        });

        // atualiza todos os clientes
        io.emit("online:update", Array.from(onlineUsers.values()));
    });

    // ===============================
    // DESCONECTOU
    // ===============================
    socket.on("disconnect", () => {

        for (const [key, value] of onlineUsers) {

            if (value.socket_id === socket.id) {
                onlineUsers.delete(key);
                break;
            }
        }

        io.emit("online:update", Array.from(onlineUsers.values()));

        console.log("❌ Cliente desconectado:", socket.id);
    });
});

// ===============================
// MIDDLEWARES
// ===============================

app.use(cors());

// 🔥 IMPORTANTE: JSON só para rotas JSON (não quebra FormData)
app.use(express.json({
    limit: "100mb",
    type: "application/json"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "100mb"
}));

// ===============================
// PUBLIC
// ===============================
app.use(express.static(
    path.join(__dirname, "public")
));

// ===============================
// UPLOADS DINÂMICOS (CORRETO)
// ===============================
const uploadsPath = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use(
    "/uploads",
    express.static(uploadsPath)
);

// ===============================
// ROTAS
// ===============================
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/empresa", empresaRoutes);
app.use("/api/escalas", escalaRoutes);
app.use("/api/os-avulsas", osAvulsasRoutes(pool));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/integracoes", verificarAutenticacao, integracoesRoutes);
app.use("/api/push", pushRoutes(pool, verificarAutenticacao));
app.use("/api/servicos-pendentes", servicosPendentesRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/inviabilidades", inviabilidadeRoutes);
app.use("/api", viabilidadeRoutes(pool, verificarAutenticacao));
app.use('/api/relatorios-automaticos', relatoriosAutomaticosRoutes(pool, verificarAutenticacao));
app.use("/api/svas", svasRoutes);
app.use("/api/lembretes", lembretesRoutes);
app.use('/api/estoque', estoqueRoutes);
const usuariosOnlineRoutes =
    require('./routes/usuarios-online.routes')(
        pool,
        verificarAutenticacao
    );

app.use('/api/admin/usuarios-online', usuariosOnlineRoutes);

const viabilidadeClientesErpRoutes =
    viabilidadeClientesErpRoutesFactory(
        pool,
        verificarAutenticacao
    );

app.use(
    "/api/viabilidade-clientes-erp",
    viabilidadeClientesErpRoutes
);


// ===============================
// APP MOBILE
// ===============================
app.get("/appmobile.html", (req, res) => {

    res.sendFile(
        path.join(__dirname, "public", "appmobile.html")
    );
});


// ===============================
// AUTENTICAÇÃO
// ===============================
async function verificarAutenticacao(req, res, next) {
    const usuarioId = req.headers["x-usuario-id"];
    const logId = req.headers["x-log-id"];
    const usuarioAtivo = req.headers["x-sgos-active"] === "1";
    const acessoApp = requisicaoDoApp(req);

    if (!usuarioId || !logId) {
        return res.status(401).json({ erro: "Não autenticado", motivo: "sessao_invalida" });
    }

    try {
        await garantirColunaSessaoApp();

        if (acessoApp) {
            await pool.query(
                `UPDATE log_acessos SET app_mobile = 1 WHERE id = ? AND usuario_id = ?`,
                [logId, usuarioId]
            );
        }

        const [rows] = await pool.query(
            `SELECT u.id, u.usuario, u.cargo, u.empresa_id,
                    l.id AS log_id, l.ultimo_ping, l.logout, l.status,
                    COALESCE(l.app_mobile, 0) AS app_mobile
             FROM usuarios u
             INNER JOIN log_acessos l
                ON l.usuario_id = u.id
               AND l.id = ?
             WHERE u.id = ?
               AND l.logout IS NULL
             LIMIT 1`,
            [logId, usuarioId]
        );

        if (!rows.length) {
            return res.status(401).json({ erro: "Sessão inválida ou encerrada", motivo: "sessao_encerrada" });
        }

        const sessao = rows[0];
        const sessaoApp = acessoApp || Number(sessao.app_mobile) === 1;
        const ultimaAtividade = new Date(sessao.ultimo_ping).getTime();
        const expirou = !sessaoApp && (
            !Number.isFinite(ultimaAtividade) ||
            Date.now() - ultimaAtividade >= LOGOUT_AUTOMATICO_HORAS * 60 * 60 * 1000
        );

        if (expirou) {
            await pool.query(
                `UPDATE log_acessos
                 SET logout = NOW(), status = 'logout', motivo_logout = 'inatividade_8h'
                 WHERE id = ? AND logout IS NULL`,
                [logId]
            );
            await registrarEventoAcesso({
                usuario: sessao.usuario,
                acao: "LOGOUT_AUTOMATICO",
                detalhes: "Sessão encerrada após 8 horas sem atividade"
            });
            return res.status(401).json({ erro: "Sessão expirada por inatividade", motivo: "inatividade_8h" });
        }

        // No app, cada requisição autenticada renova a presença sem expirar a sessão.
        if (usuarioAtivo || sessaoApp) {
            await pool.query(
                `UPDATE log_acessos
                 SET ultimo_ping = NOW(), status = 'ativo', app_mobile = ?
                 WHERE id = ? AND logout IS NULL`,
                [sessaoApp ? 1 : 0, logId]
            );
            if (sessao.status !== "ativo") {
                await registrarEventoAcesso({
                    usuario: sessao.usuario,
                    acao: "USUARIO_ONLINE",
                    detalhes: sessaoApp
                        ? "Usuário ativo pelo aplicativo móvel"
                        : "Usuário voltou a interagir com o sistema"
                });
                await registrarEventoUsuariosOnline(logId, "conexao", "Usuário reconectado");
            }
        }

        req.usuario = {
            id: sessao.id,
            usuario: sessao.usuario,
            cargo: sessao.cargo,
            empresa_id: sessao.empresa_id
        };
        req.log_id = Number(logId);
        req.sessao_app = sessaoApp;
        next();
    } catch (err) {
        console.error("ERRO AUTH:", err);
        res.status(500).json({ erro: err.message });
    }
}

async function obterEmpresaPorSubdominio(req) {

    const host = (
        req.headers["x-forwarded-host"] ||
        req.headers.host ||
        ""
    )
        .split(":")[0]
        .toLowerCase();

    // ===============================
    // LOCALHOST
    // ===============================
    if (
    host === "localhost" ||
    host === "127.0.0.1"
) {

    const [empresa] = await pool.query(
        `
        SELECT id, subdominio
        FROM empresa
        ORDER BY id
        LIMIT 1
        `
    );

    if (!empresa.length) {
        throw new Error(
            "Nenhuma empresa cadastrada"
        );
    }

    return empresa[0];
}

    // ===============================
    // PRODUÇÃO (SUBDOMÍNIO)
    // ===============================
    const subdominio = host.split(".")[0];

    const [empresa] = await pool.query(
        `
        SELECT id, subdominio
        FROM empresa
        WHERE subdominio = ?
        LIMIT 1
        `,
        [subdominio]
    );

    if (!empresa.length) {
        throw new Error(
            `Empresa não encontrada para o subdomínio: ${subdominio}`
        );
    }

    return empresa[0];
}

// ===============================
// LOGIN
// ===============================
app.post("/api/login", async (req, res) => {

    const { usuario, senha } = req.body;
    const loginPeloApp = requisicaoDoApp(req);

    if (!usuario || !senha) {
        return res.status(400).json({
            erro: "Preencha usuário e senha"
        });
    }

    try {

        const empresa =
            await obterEmpresaPorSubdominio(req);

        const [rows] = await pool.query(
            `
            SELECT
                id,
                usuario,
                senha,
                cargo,
                ativo,
                empresa_id
            FROM usuarios
            WHERE usuario = ?
              AND empresa_id = ?
            LIMIT 1
            `,
            [usuario, empresa.id]
        );

        if (!rows.length) {
            return res.status(401).json({
                erro: "Usuário não encontrado"
            });
        }

        const user = rows[0];

        if (!user.ativo) {
            return res.status(401).json({
                erro: "Usuário desativado"
            });
        }

        const senhaValida =
            await bcrypt.compare(senha, user.senha);

        if (!senhaValida) {
            return res.status(401).json({
                erro: "Senha incorreta"
            });
        }

        await garantirColunaSessaoApp();

        // ===============================
        // 🔥 LIMPA SESSÃO ANTIGA (EVITA FANTASMAS)
        // ===============================
        await pool.query(
            `
            UPDATE log_acessos
            SET logout = NOW(),
                status = 'logout'
            WHERE usuario = ?
              AND empresa_id = ?
              AND logout IS NULL
            `,
            [usuario, user.empresa_id]
        );

        // ===============================
        // IP + PORTA
        // ===============================
        const ip =
            (req.headers["x-forwarded-for"] || "")
                .split(",")[0]
                .trim() ||
            req.socket.remoteAddress ||
            null;

        const porta =
    req.headers["x-forwarded-port"] ||
    req.headers["x-real-port"] ||
    req.socket.remotePort ||
    req.socket.localPort ||
    null;

        console.log("LOGIN INFO:", {
            usuario,
            empresa_id: user.empresa_id,
            subdominio: empresa.subdominio,
            ip,
            porta
        });

        // ===============================
        // CRIA NOVO LOG
        // ===============================
        const [logResult] = await pool.query(
    `
    INSERT INTO log_acessos
    (
        usuario_id,
        usuario,
        empresa_id,
        ip_origem,
        porta_origem,
        login,
        ultimo_ping,
        status,
        app_mobile
    )
    VALUES
    (?, ?, ?, ?, ?, NOW(), NOW(), 'ativo', ?)
    `,
    [
        user.id,
        user.usuario,
        user.empresa_id,
        ip,
        porta,
        loginPeloApp ? 1 : 0
    ]
);

        await registrarEventoAcesso({
            usuario: user.usuario,
            acao: "LOGIN",
            detalhes: `Login realizado | IP: ${ip || "-"} | Porta: ${porta || "-"}`
        });
        await registrarEventoUsuariosOnline(logResult.insertId, "conexao", "Login realizado");

        return res.json({
            ok: true,
            usuario: {
                id: user.id,
                usuario: user.usuario,
                cargo: user.cargo,
                empresa_id: user.empresa_id
            },
            log_id: logResult.insertId
        });

    } catch (err) {

        console.error("ERRO LOGIN:", err);

        return res.status(500).json({
            erro: err.message
        });
    }
});

// ===============================
// PING / PRESENÇA
// ===============================
app.post("/api/ping", async (req, res) => {
    const { log_id, ativo } = req.body || {};
    const acessoApp = requisicaoDoApp(req);

    if (!log_id) {
        return res.status(400).json({ erro: "log_id não informado" });
    }

    try {
        await garantirColunaSessaoApp();

        if (acessoApp) {
            await pool.query(`UPDATE log_acessos SET app_mobile = 1 WHERE id = ?`, [log_id]);
        }

        const [rows] = await pool.query(
            `SELECT id, usuario, status, ultimo_ping, logout, COALESCE(app_mobile,0) AS app_mobile
             FROM log_acessos WHERE id = ? LIMIT 1`,
            [log_id]
        );

        if (!rows.length || rows[0].logout) {
            return res.status(401).json({ erro: "Sessão encerrada", motivo: "sessao_encerrada" });
        }

        const sessao = rows[0];
        const sessaoApp = acessoApp || Number(sessao.app_mobile) === 1;
        const ultimaAtividade = new Date(sessao.ultimo_ping).getTime();
        const expirou = !sessaoApp && (
            !Number.isFinite(ultimaAtividade) ||
            Date.now() - ultimaAtividade >= LOGOUT_AUTOMATICO_HORAS * 60 * 60 * 1000
        );

        if (expirou) {
            await pool.query(
                `UPDATE log_acessos
                 SET logout = NOW(), status = 'logout', motivo_logout = 'inatividade_8h'
                 WHERE id = ? AND logout IS NULL`,
                [log_id]
            );
            await registrarEventoAcesso({
                usuario: sessao.usuario,
                acao: "LOGOUT_AUTOMATICO",
                detalhes: "Sessão encerrada após 8 horas sem atividade"
            });
            await registrarEventoUsuariosOnline(log_id, "expirado", "Logout — sessão expirada");
            return res.status(401).json({ erro: "Sessão expirada", motivo: "inatividade_8h" });
        }

        if (sessaoApp || ativo === true) {
            await pool.query(
                `UPDATE log_acessos SET ultimo_ping = NOW(), status = 'ativo', app_mobile = ?
                 WHERE id = ? AND logout IS NULL`,
                [sessaoApp ? 1 : 0, log_id]
            );
            if (sessao.status !== "ativo") {
                await registrarEventoAcesso({
                    usuario: sessao.usuario,
                    acao: "USUARIO_ONLINE",
                    detalhes: sessaoApp
                        ? "Usuário ativo pelo aplicativo móvel"
                        : "Usuário voltou a interagir com o sistema"
                });
                await registrarEventoUsuariosOnline(log_id, "reconectado", "Usuário reconectado após inatividade");
            }
        } else {
            const cincoMinutosSemAtividade = Date.now() - ultimaAtividade >= OFFLINE_MINUTOS * 60 * 1000;
            if (cincoMinutosSemAtividade && sessao.status !== "offline") {
                await pool.query(
                    `UPDATE log_acessos SET status = 'offline' WHERE id = ? AND logout IS NULL`,
                    [log_id]
                );
                await registrarEventoAcesso({
                    usuario: sessao.usuario,
                    acao: "USUARIO_OFFLINE",
                    detalhes: "Usuário sem atividade por 5 minutos; sessão permanece ativa"
                });
                await registrarEventoUsuariosOnline(log_id, "offline", "Desconectado por inatividade");
            }
        }

        return res.json({ ok: true, status: sessaoApp || ativo === true ? "ativo" : "offline", app_mobile: sessaoApp });
    } catch (err) {
        console.error("ERRO PING:", err);
        return res.status(500).json({ erro: err.message });
    }
});

// ===============================
// LOGOUT MANUAL / AUTOMÁTICO
// ===============================
app.post("/api/logout", async (req, res) => {
    const log_id = req.body?.log_id || req.query?.log_id;
    const motivo = req.body?.motivo === "inatividade_8h" ? "inatividade_8h" : "manual";

    if (!log_id) {
        return res.status(400).json({ erro: "log_id não informado" });
    }

    try {
        const [rows] = await pool.query(
            `SELECT usuario, logout FROM log_acessos WHERE id = ? LIMIT 1`,
            [log_id]
        );

        if (rows.length && !rows[0].logout) {
            await pool.query(
                `UPDATE log_acessos
                 SET logout = NOW(), status = 'logout', motivo_logout = ?
                 WHERE id = ? AND logout IS NULL`,
                [motivo, log_id]
            );

            await registrarEventoAcesso({
                usuario: rows[0].usuario,
                acao: motivo === "manual" ? "LOGOUT_MANUAL" : "LOGOUT_AUTOMATICO",
                detalhes: motivo === "manual"
                    ? "Logout solicitado pelo usuário"
                    : "Sessão encerrada após 8 horas sem atividade"
            });
            await registrarEventoUsuariosOnline(
                log_id,
                motivo === "manual" ? "logout" : "expirado",
                motivo === "manual" ? "Logout realizado" : "Logout — sessão expirada"
            );
        }

        return res.json({ ok: true });
    } catch (err) {
        console.error("ERRO LOGOUT:", err);
        return res.status(500).json({ erro: err.message });
    }
});

// ===============================
// LOGS DE ACESSO
// ===============================
app.get("/api/logs", verificarAutenticacao, async (req, res) => {
    try {
        const empresa_id = req.usuario.empresa_id;

        await pool.query(
            `UPDATE log_acessos
             SET status = 'offline'
             WHERE empresa_id = ?
               AND logout IS NULL
               AND status = 'ativo'
               AND ultimo_ping <= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
            [empresa_id, OFFLINE_MINUTOS]
        );

        const [logs] = await pool.query(
            `SELECT id, usuario_id, usuario, empresa_id, ip_origem, porta_origem,
                    login, logout, ultimo_ping, status, motivo_logout
             FROM log_acessos
             WHERE empresa_id = ?
             ORDER BY id DESC
             LIMIT 500`,
            [empresa_id]
        );

        return res.json(logs);
    } catch (err) {
        console.error("ERRO LOGS:", err);
        return res.status(500).json({ erro: err.message });
    }
});


// ===============================
// ROTAS PRINCIPAIS
// ===============================
const ordensRoutes =
    require("./routes/ordens.routes")(
        pool,
        verificarAutenticacao,
        io
    );

const tecnicosRoutes =
    require("./routes/tecnicos.routes")(
        pool,
        verificarAutenticacao
    );

const localidadesRoutes =
    require("./routes/localidades.routes")(
        pool,
        verificarAutenticacao
    );

const planosRoutes =
    require("./routes/planos.routes")(
        pool,
        verificarAutenticacao
    );

const tiposRoutes =
    require("./routes/tipos_servico.routes")(
        pool,
        verificarAutenticacao
    );

const usuariosRoutes =
    require("./routes/usuarios.routes")(
        pool,
        verificarAutenticacao
    );

const relatoriosRoutes =
    require("./routes/relatorios.routes")(
        pool,
        verificarAutenticacao
    );

app.use("/api/ordens_servico", ordensRoutes);
app.use("/api/tecnicos", tecnicosRoutes);
app.use("/api/localidades", localidadesRoutes);
app.use("/api/planos", planosRoutes);
app.use("/api/tipos-servico", tiposRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api", relatoriosRoutes);

const escritoriosRoutes =
    escritoriosRoutesFactory(pool, verificarAutenticacao);

const financeiroRoutes =
    financeiroRoutesFactory(pool, verificarAutenticacao);

app.use("/api/escritorios", escritoriosRoutes);
app.use("/api/financeiro", financeiroRoutes);

const logsAcoesRoutes =
    require("./routes/logs_acoes.routes")(pool, verificarAutenticacao);

app.use("/api/logs_acoes", logsAcoesRoutes);

// ===============================
// ME
// ===============================
app.get("/api/me", verificarAutenticacao, async (req, res) => {

    const user = req.usuario;

    try {

        let empresaNome = "";
        let empresaLogo = "";

        if (user.empresa_id) {

            const [empresa] = await pool.query(
                "SELECT nome_provedor, logo FROM empresa WHERE id = ? LIMIT 1",
                [user.empresa_id]
            );

            if (empresa.length > 0) {
                empresaNome = empresa[0].nome_provedor || "";
                empresaLogo = empresa[0].logo || "";
            }
        }

        res.json({
            id: user.id,
            usuario: user.usuario,
            cargo: user.cargo,
            empresa_id: user.empresa_id,
            empresa_nome: empresaNome,
            empresa_logo: empresaLogo
    ? `/uploads/logos/${encodeURIComponent(empresaLogo)}`
    : ""
        });

    } catch (err) {

        console.error("ERRO /api/me:", err);

        res.json({
            id: user.id,
            usuario: user.usuario,
            cargo: user.cargo,
            empresa_id: user.empresa_id,
            empresa_nome: "",
            empresa_logo: ""
        });
    }
});

// ===============================
// HEALTH
// ===============================
app.get("/api/health", (req, res) => {
    res.json({ status: "OK" });
});

// ===============================
// OS AVULSA
// ===============================
app.get("/nova-os.avulsa.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "nova-os.avulsa.html"));
});

// ===============================
// EMPRESA
// ===============================
app.get("/api/empresa", async (req, res) => {

    try {

        const [rows] = await pool.query(`SELECT * FROM empresa`);

        if (!rows.length) {
            return res.status(404).json({ erro: "Empresa não encontrada" });
        }

        res.json(rows[0]);

    } catch (err) {

        console.error(err);

        res.status(500).json({ erro: "Erro interno" });
    }
});

app.put("/api/empresa/:id", async (req, res) => {

    const id = req.params.id;

    try {

        await pool.query(
            `UPDATE empresa SET ? WHERE id = ?`,
            [req.body, id]
        );

        res.json({ sucesso: true });

    } catch (err) {

        console.error(err);

        res.status(500).json({ erro: "Erro interno" });
    }
});

app.get("/teste-notificacao", (req, res) => {
    const io = req.app.get("io") || global.io;

    io.emit("os_andamento", {
        os_id: "999",
        titulo: "🚀 Teste SGOS",
        mensagem: "Notificação web de teste recebida"
    });

    res.json({ ok: true });
});


// ===============================
// START
// ===============================
server.listen(port, () => {

    console.log(
        `🚀 SGOS rodando com SOCKET em http://localhost:${port}`
    );
});