const express = require("express");
const router = express.Router();
const pool = require("../database");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ===============================
// 📦 CONFIG UPLOAD LOGO
// ===============================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, "../uploads/logos"));
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        const nome = "logo_" + Date.now() + ext;
        cb(null, nome);
    }
});

const upload = multer({ storage });

// ===============================
// 🔷 EMPRESA (1 - usado no PDF)
// ===============================
router.get("/", async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                nome_provedor,
                nome_completo,
                cpf,
                cnpj,
                email,
                telefone,
                logo
            FROM empresa
            LIMIT 1
        `);

        res.json(rows[0] || {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao buscar empresa" });
    }
});

// ===============================
// 🔷 LISTAR TODAS
// ===============================
router.get("/listar", async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT *
            FROM empresa
            ORDER BY id DESC
        `);

        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao listar empresas" });
    }
});

// ===============================
// 🔷 BUSCAR POR ID
// ===============================
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const [rows] = await pool.query(
            "SELECT * FROM empresa WHERE id = ?",
            [id]
        );

        res.json(rows[0] || {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao buscar empresa" });
    }
});

// ===============================
// 🔷 CRIAR EMPRESA
// ===============================
router.post("/", upload.single("logo"), async (req, res) => {
    try {

        const {
            cpf, nome_completo, nome_provedor,
            cnpj, nome_fantasia, razao_social,
            pessoa_fisica, pessoa_juridica,
            cep, cidade, estado, endereco,
            subdominio, plano_empresa,
            vencimento, prazo, ativo
        } = req.body;

        const logo = req.file ? req.file.filename : null;

        await pool.query(`
            INSERT INTO empresa (
                cpf, nome_completo, nome_provedor,
                cnpj, nome_fantasia, razao_social,
                pessoa_fisica, pessoa_juridica,
                cep, cidade, estado, endereco,
                subdominio, plano_empresa,
                vencimento, prazo, ativo, logo
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
            cpf, nome_completo, nome_provedor,
            cnpj, nome_fantasia, razao_social,
            pessoa_fisica, pessoa_juridica,
            cep, cidade, estado, endereco,
            subdominio, plano_empresa,
            vencimento, prazo, ativo, logo
        ]);

        res.json({ sucesso: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao cadastrar empresa" });
    }
});

// ===============================
// 🔷 ATUALIZAR EMPRESA
// ===============================
router.put("/:id", upload.single("logo"), async (req, res) => {
    try {

        const { id } = req.params;

        const {
            cpf, nome_completo, nome_provedor,
            cnpj, nome_fantasia, razao_social,
            pessoa_fisica, pessoa_juridica,
            cep, cidade, estado, endereco,
            subdominio, plano_empresa,
            vencimento, prazo, ativo
        } = req.body;

        // buscar logo antiga
        const [rows] = await pool.query(
            "SELECT logo FROM empresa WHERE id = ?",
            [id]
        );

        const logoAntiga = rows[0]?.logo;
        let novaLogo = logoAntiga;

        if(req.file){
            novaLogo = req.file.filename;

            if(logoAntiga){
                const caminho = path.join(__dirname, "../uploads/logos", logoAntiga);

                if(fs.existsSync(caminho)){
                    fs.unlinkSync(caminho);
                }
            }
        }

        await pool.query(`
            UPDATE empresa SET
                cpf=?, nome_completo=?, nome_provedor=?,
                cnpj=?, nome_fantasia=?, razao_social=?,
                pessoa_fisica=?, pessoa_juridica=?,
                cep=?, cidade=?, estado=?, endereco=?,
                subdominio=?, plano_empresa=?,
                vencimento=?, prazo=?, ativo=?, logo=?
            WHERE id=?
        `, [
            cpf, nome_completo, nome_provedor,
            cnpj, nome_fantasia, razao_social,
            pessoa_fisica, pessoa_juridica,
            cep, cidade, estado, endereco,
            subdominio, plano_empresa,
            vencimento, prazo, ativo, novaLogo,
            id
        ]);

        res.json({ sucesso: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao atualizar empresa" });
    }
});

// ===============================
// 🔷 REMOVER EMPRESA
// ===============================
router.delete("/:id", async (req, res) => {
    try {

        const { id } = req.params;

        const [rows] = await pool.query(
            "SELECT logo FROM empresa WHERE id = ?",
            [id]
        );

        const logo = rows[0]?.logo;

        if(logo){
            const caminho = path.join(__dirname, "../uploads/logos", logo);

            if(fs.existsSync(caminho)){
                fs.unlinkSync(caminho);
            }
        }

        await pool.query("DELETE FROM empresa WHERE id = ?", [id]);

        res.json({ sucesso: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao remover empresa" });
    }
});

// ===============================
// 🔷 ATIVAR / DESATIVAR
// ===============================
router.post("/toggle/:id", async (req, res) => {
    try {

        const { id } = req.params;

        await pool.query(`
            UPDATE empresa
            SET ativo = IF(ativo = 1, 0, 1)
            WHERE id = ?
        `, [id]);

        res.json({ sucesso: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao alterar status" });
    }
});

module.exports = router;