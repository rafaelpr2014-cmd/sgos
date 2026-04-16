const express = require("express");
const router = express.Router();
const osService = require("../services/os.service");
const verificarAutenticacao = require("../middlewares/auth");

// LISTAR
router.get("/", verificarAutenticacao, async (req, res) => {
    try {
        const data = await osService.listar(req.usuario);
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao listar OS" });
    }
});

// CRIAR
router.post("/", verificarAutenticacao, async (req, res) => {
    try {
        const result = await osService.criar(req.body, req.usuario);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao criar OS" });
    }
});

module.exports = router;