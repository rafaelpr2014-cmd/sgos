// ===============================
// 📂 SERVIR UPLOAD
const fsExtra = require("fs");
const dirViabilidade = path.join(__dirname, "uploads/viabilidade");

if (!fsExtra.existsSync(dirViabilidade)) {
    fsExtra.mkdirSync(dirViabilidade, { recursive: true });
}

app.use('/uploads/viabilidade', express.static(dirViabilidade));

// ===============================
// 📊 VIABILIDADE
// ===============================

// LISTAR
app.get("/api/viabilidade", verificarAutenticacao, async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            `SELECT v.*, 
                (SELECT cadastrado_por FROM viabilidade_anexos 
                 WHERE viabilidade_id = v.id 
                 ORDER BY registrado_em DESC LIMIT 1) AS cadastrado_por,
                (SELECT registrado_em FROM viabilidade_anexos 
                 WHERE viabilidade_id = v.id 
                 ORDER BY registrado_em DESC LIMIT 1) AS registrado_em
             FROM viabilidade v
             WHERE v.empresa_id = ?`,
            [req.usuario.empresa_id]
        );

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: err.message });
    }
});

// CRIAR
app.post("/api/viabilidade", verificarAutenticacao, async (req, res) => {
    try {
        const { nome, endereco, telefone } = req.body;

        const [result] = await db.promise().query(
            "INSERT INTO viabilidade (nome, endereco, telefone, empresa_id) VALUES (?, ?, ?, ?)",
            [nome, endereco, telefone, req.usuario.empresa_id]
        );

        res.json({ id: result.insertId });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: err.message });
    }
});

// EDITAR
app.put("/api/viabilidade/:id", verificarAutenticacao, async (req, res) => {
    try {
        const { nome, endereco, telefone } = req.body;

        await db.promise().query(
            `UPDATE viabilidade 
             SET nome=?, endereco=?, telefone=? 
             WHERE id=? AND empresa_id=?`,
            [nome, endereco, telefone, req.params.id, req.usuario.empresa_id]
        );

        res.json({ sucesso: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: err.message });
    }
});

// EXCLUIR
app.delete("/api/viabilidade/:id", verificarAutenticacao, async (req, res) => {
    try {
        await db.promise().query(
            "DELETE FROM viabilidade WHERE id=? AND empresa_id=?",
            [req.params.id, req.usuario.empresa_id]
        );

        res.json({ sucesso: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: err.message });
    }
});

// ===============================
// ❌ INVIABILIDADES (AGORA SEGURA)
app.get("/api/inviabilidades", verificarAutenticacao, async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            `SELECT * FROM inviabilidades 
             WHERE empresa_id = ?
             ORDER BY criado_em DESC`,
            [req.usuario.empresa_id]
        );

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro no banco" });
    }
});

// ===============================
// 📎 ANEXOS
app.get("/api/viabilidade_anexos/:id", verificarAutenticacao, async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            `SELECT * FROM viabilidade_anexos 
             WHERE viabilidade_id=? AND empresa_id=?`,
            [req.params.id, req.usuario.empresa_id]
        );

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: err.message });
    }
});

// ===============================
// 📤 UPLOAD
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dirViabilidade),
    filename: (req, file, cb) => cb(null, Date.now() + "_" + file.originalname)
});

const upload = multer({ storage });

app.post("/api/upload_viabilidade", verificarAutenticacao, upload.single("arquivo"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro: "Arquivo não enviado" });

        const usuario = req.usuario.usuario;

        const [result] = await db.promise().query(
            `INSERT INTO viabilidade_anexos 
            (viabilidade_id, nome_arquivo, tipo, cadastrado_por, registrado_em, empresa_id)
            VALUES (?, ?, ?, ?, NOW(), ?)`,
            [
                req.body.viabilidade_id,
                req.file.filename,
                req.file.mimetype,
                usuario,
                req.usuario.empresa_id
            ]
        );

        res.json({ sucesso: true, id: result.insertId });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro upload" });
    }
});
