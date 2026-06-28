const express = require("express");
const router = express.Router();

const osService = require("../services/os.service");
const verificarAutenticacao = require("../middlewares/auth");

module.exports = (db, io) => {

    const logService = require("../services/log.service")(db);
    console.log("🔥 CHEGOU NA ROTA DE LOG");

    // ===============================
    // LISTAR OS
    // ===============================
    router.get("/", verificarAutenticacao, async (req, res) => {

        try {
            const data = await osService.listar(req.usuario);
            res.json(data);

        } catch (err) {

            console.error(err);
            res.status(500).json({ erro: "Erro ao listar OS" });
        }
    });

    // ===============================
    // CRIAR OS
    // ===============================
    router.post("/", verificarAutenticacao, async (req, res) => {

        try {

            const result = await osService.criar(req.body, req.usuario);

            await logService.registrarLog(
    req,
    "TESTE LOG",
    "OS",
    1,
    "teste direto"
);

            io.emit("os_update");

            res.json(result);

        } catch (err) {

            console.error(err);

            res.status(500).json({
                erro: "Erro ao criar OS"
            });
        }
    });

    return router;
};