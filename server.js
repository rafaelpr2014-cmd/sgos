// ===============================
// IMPORTS
// ===============================
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const integracoesRoutes = require("./routes/integracoes.routes");


const pool = require("./database");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const whatsappRoutes = require('./whatsapp/whatsappRoutes');
const empresaRoutes = require("./routes/empresa.routes");
const escalaRoutes = require("./routes/escala.routes");
const osAvulsasRoutes = require("./routes/os-avulsas.routes");
const cronJobs = require("./cron/jobs");
const pushRoutes = require("./routes/push.routes");
const pushService = require("./services/push.service");

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

// 🔥 disponibiliza IO globalmente
app.set("io", io);
app.set("pushService", pushService(pool));

const onlineUsers = new Map();

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
    limit: "10mb",
    type: "application/json"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "10mb"
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
app.use('/api/whatsapp', whatsappRoutes);
app.use("/api/empresa", empresaRoutes);
app.use("/api/escalas", escalaRoutes);
app.use("/api/os-avulsas", osAvulsasRoutes(pool));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/integracoes", verificarAutenticacao, integracoesRoutes);
app.use("/api/push", pushRoutes(pool, verificarAutenticacao));

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

    if (!usuarioId) {
        return res.status(401).json({ erro: "Não autenticado" });
    }

    try {

        const [rows] = await pool.query(
            `
            SELECT id, usuario, cargo, empresa_id
            FROM usuarios
            WHERE id = ?
            LIMIT 1
            `,
            [usuarioId]
        );

        if (!rows.length) {
            return res.status(401).json({ erro: "Usuário não encontrado" });
        }

        req.usuario = rows[0];

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
        status
    )
    VALUES
    (?, ?, ?, ?, ?, NOW(), NOW(), 'ativo')
    `,
    [
        user.id,
        user.usuario,
        user.empresa_id,
        ip,
        porta
    ]
);

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
// PING ONLINE
// ===============================
app.post("/api/ping", async (req, res) => {

    const { log_id } = req.body;

    if (!log_id) {
        return res.status(400).json({ erro: "log_id não informado" });
    }

    try {

        await pool.query(
            `UPDATE log_acessos
             SET ultimo_ping = NOW()
             WHERE id = ?
             AND status != 'logout'`,
            [log_id]
        );

        return res.json({ ok: true });

    } catch (err) {

        console.error("ERRO PING:", err);

        return res.status(500).json({ erro: err.message });
    }
});

// ===============================
// LOGOUT
// ===============================
app.post("/api/logout", async (req, res) => {

    let log_id =
        req.body?.log_id ||
        req.query?.log_id;

    if (!log_id) {
        return res.status(400).json({ erro: "log_id não informado" });
    }

    try {

        await pool.query(
            "UPDATE log_acessos SET logout = NOW(), status = 'logout' WHERE id = ?",
            [log_id]
        );

        res.json({ ok: true });

    } catch (err) {

        console.error("ERRO LOGOUT:", err);

        res.status(500).json({ erro: err.message });
    }
});

// ===============================
// LOGS ONLINE
// ===============================
app.get("/api/logs", async (req, res) => {

    try {

        const empresa_id = req.headers["x-empresa-id"];

        if (!empresa_id) {
            return res.status(400).json({ erro: "empresa_id não informado" });
        }

        const [logs] = await pool.query(
            `
            SELECT
                l.id,
                l.usuario_id,
                l.usuario,
                l.empresa_id,
                l.ip_origem,
                l.login,
                l.logout,
                l.ultimo_ping
            FROM log_acessos l
            WHERE l.empresa_id = ?
            ORDER BY l.id DESC
            `,
            [empresa_id]
        );

        const agora = Date.now();
        const ONLINE_TIMEOUT = 90 * 1000;

        const mapa = new Map();

        for (const l of logs) {

    const ultimo = new Date(l.ultimo_ping || l.login).getTime();

    const online =
        !l.logout &&
        (Date.now() - ultimo < ONLINE_TIMEOUT);

    const existente = mapa.get(l.usuario_id);

    if (!existente || new Date(l.login) > new Date(existente.login)) {

        mapa.set(l.usuario_id, {
            usuario_id: l.usuario_id,
            usuario: l.usuario,
            empresa_id: l.empresa_id,

            ip_origem: l.ip_origem,
            porta_origem: l.porta_origem,

            login: l.login,
            logout: l.logout,

            ultimo_ping: l.ultimo_ping,

            status: online ? "ativo" : "offline"
        });
    }
}

        return res.json(Array.from(mapa.values()));

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

const loginRoutes =
    require("./routes/login.routes")(pool);

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
app.use("/api", loginRoutes);
app.use("/api", relatoriosRoutes);

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
    ? `/uploads/${empresaLogo}`
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