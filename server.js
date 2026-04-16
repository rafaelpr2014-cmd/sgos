// server.js
const express = require("express");
const pool = require("./database");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const whatsappRoutes = require('./whatsapp/whatsappRoutes');
const empresaRoutes = require("./routes/empresa.routes");
const path = require("path");
const cronJobs = require("./cron/jobs");
cronJobs(pool);


const app = express();
const port = 3000;

// ===============================
// MIDDLEWARES
// ===============================
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static("public"));
app.use('/api/whatsapp', whatsappRoutes);
app.use("/api/empresa", empresaRoutes);
app.use("/uploads", express.static("uploads"));
app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/uploads", express.static(path.join(__dirname, "uploads/logos")));


// ===============================
// AUTENTICAÇÃO
// ===============================
async function verificarAutenticacao(req, res, next) {
    const usuarioId = req.headers["x-usuario-id"];
    if (!usuarioId) return res.status(401).json({ erro: "Não autenticado" });

    try {
        const [rows] = await pool.query(
            "SELECT id, usuario, cargo, empresa_id FROM usuarios WHERE id = ? LIMIT 1",
            [usuarioId]
        );

        if (rows.length === 0) return res.status(401).json({ erro: "Usuário não encontrado" });

        req.usuario = rows[0];
        next();
    } catch (err) {
        console.error("ERRO AUTH:", err);
        res.status(500).json({ erro: err.message });
    }
}

// ===============================
// LOGIN
// ===============================
app.post("/api/login", async (req, res) => {
    const { usuario, senha } = req.body;
    if (!usuario || !senha) return res.status(400).json({ erro: "Preencha usuário e senha" });

    try {
        const [rows] = await pool.query(
            "SELECT id, usuario, senha, cargo, empresa_id FROM usuarios WHERE usuario = ? LIMIT 1",
            [usuario]
        );

        if (rows.length === 0) return res.status(401).json({ erro: "Usuário não encontrado" });

        const user = rows[0];
        const senhaValida = await bcrypt.compare(senha, user.senha);
        if (!senhaValida) return res.status(401).json({ erro: "Senha incorreta" });

        // Registrar login no log_acessos com empresa_id
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const [logResult] = await pool.query(
            "INSERT INTO log_acessos (usuario, empresa_id, ip_origem, login, ultimo_ping, status) VALUES (?, ?, ?, NOW(), NOW(), 'ativo')",
            [usuario, user.empresa_id, ip]
        );

        res.json({
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
        res.status(500).json({ erro: err.message });
    }
});

// ===============================
// LOGOUT
// ===============================
app.post("/api/logout", async (req, res) => {
    let log_id;

    // Lê log_id do body ou query
    if (req.body && req.body.log_id) {
        log_id = req.body.log_id;
    } else if (req.query && req.query.log_id) {
        log_id = req.query.log_id;
    } else {
        return res.status(400).json({ erro: "log_id não informado" });
    }

    try {
        await pool.query("UPDATE log_acessos SET logout = NOW(), status = 'logout' WHERE id = ?", [log_id]);
        res.json({ ok: true });
    } catch (err) {
        console.error("ERRO LOGOUT:", err);
        res.status(500).json({ erro: err.message });
    }
});



// ===============================
// ROTAS EXISTENTES
// ===============================
const ordensRoutes = require("./routes/ordens.routes")(pool, verificarAutenticacao);
const tecnicosRoutes = require("./routes/tecnicos.routes")(pool, verificarAutenticacao);
const localidadesRoutes = require("./routes/localidades.routes")(pool, verificarAutenticacao);
const planosRoutes = require("./routes/planos.routes")(pool, verificarAutenticacao);
const tiposRoutes = require("./routes/tipos_servico.routes")(pool, verificarAutenticacao);
const usuariosRoutes = require("./routes/usuarios.routes")(pool, verificarAutenticacao);
const loginRoutes = require("./routes/login.routes")(pool);
const relatoriosRoutes = require("./routes/relatorios.routes")(pool, verificarAutenticacao);

app.use("/api/ordens_servico", ordensRoutes);
app.use("/api/tecnicos", tecnicosRoutes);
app.use("/api/localidades", localidadesRoutes);
app.use("/api/planos", planosRoutes);
app.use("/api/tipos_servico", tiposRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api", loginRoutes);
app.use("/api", relatoriosRoutes);

// ===============================
// USUÁRIO LOGADO
// ===============================
app.get("/api/me", verificarAutenticacao, (req, res) => {
    res.json(req.usuario);
});

// ===============================
// HEALTH CHECK (opcional)
// ===============================
app.get("/api/health", (req, res) => {
    res.json({ status: "OK" });
});

app.get("/api/empresa", async (req, res) => {
    try {

        const [rows] = await pool.query(`
            SELECT 
                id,
                nome_provedor,
                nome_completo,
                cpf,
                cnpj,
                relatorio_envio_tipo,
                relatorio_email,
                relatorio_dia_semana,
                relatorio_dia_mes
            FROM empresa
        `);

        if(!rows.length){
            return res.status(404).json({ erro: "Empresa não encontrada" });
        }

        res.json(rows[0]);

    } catch (err) {
        console.error("Erro ao buscar empresa:", err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

app.put("/api/empresa/:id", async (req, res) => {

    const id = req.params.id;

    const {
        relatorio_envio_tipo,
        relatorio_email,
        relatorio_dia_semana,
        relatorio_dia_mes
    } = req.body;

    try {

        await pool.query(`
            UPDATE empresa
            SET relatorio_envio_tipo = ?,
                relatorio_email = ?,
                relatorio_dia_semana = ?,
                relatorio_dia_mes = ?
            WHERE id = ?
        `, [
            relatorio_envio_tipo,
            relatorio_email,
            relatorio_dia_semana,
            relatorio_dia_mes,
            id
        ]);

        res.json({ sucesso: true });

    } catch (err) {
        console.error("Erro ao atualizar empresa:", err);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// ===============================
// INICIAR SERVIDOR
// ===============================
app.listen(port, () => {
    console.log(`🚀 SGOS rodando em http://localhost:${port}`);
});