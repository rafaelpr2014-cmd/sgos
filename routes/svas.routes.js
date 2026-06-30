const express = require("express");
const router = express.Router();
const pool = require("../database");

const LISTA_SVAS = [
    "CDNTV",
    "Watch Brasil",
    "PlayHub",
    "Unitel Play",
    "TMW PIX TV",
    "DirecTV GO Empresas",
    "Claro tv+",
    "Sky+",
    "Vero TV",
    "Watch",
    "TVD Digital",
    "Ministra",
    "Stalker Portal",
    "Xtream Codes",
    "Flix IPTV",
    "Customizado",
    "Outro"
];

// LISTAR SVAs DA EMPRESA
router.get("/", async (req, res) => {
    try {
        const empresa_id = req.headers["x-empresa-id"];

        if (!empresa_id) {
            return res.status(400).json({ erro: "empresa_id não informado" });
        }

        const [salvos] = await pool.query(
            "SELECT * FROM svas_empresa WHERE empresa_id = ?",
            [empresa_id]
        );

        const mapa = {};
        salvos.forEach(sva => {
            mapa[sva.nome_sva] = sva;
        });

        const lista = LISTA_SVAS.map(nome => {
            if (mapa[nome]) {
                return {
                    id: mapa[nome].id,
                    empresa_id: mapa[nome].empresa_id,
                    nome_sva: mapa[nome].nome_sva,
                    habilitado: Number(mapa[nome].habilitado) === 1,
                    url: mapa[nome].url || "",
                    criado_em: mapa[nome].criado_em,
                    atualizado_em: mapa[nome].atualizado_em
                };
            }

            return {
                id: null,
                empresa_id,
                nome_sva: nome,
                habilitado: nome === "CDNTV",
                url: nome === "CDNTV" ? "rpnet.tv.com.br" : ""
            };
        });

        res.json(lista);

    } catch (err) {
        console.error("Erro ao listar SVAs:", err);
        res.status(500).json({ erro: "Erro ao listar SVAs" });
    }
});

// SALVAR SVAs DA EMPRESA
router.post("/salvar", async (req, res) => {
    try {
        const empresa_id = req.headers["x-empresa-id"];
        const { svas } = req.body;

        if (!empresa_id) {
            return res.status(400).json({ erro: "empresa_id não informado" });
        }

        if (!Array.isArray(svas)) {
            return res.status(400).json({ erro: "Lista de SVAs inválida" });
        }

        for (const sva of svas) {
            await pool.query(
                `
                INSERT INTO svas_empresa
                (empresa_id, nome_sva, habilitado, url)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    habilitado = VALUES(habilitado),
                    url = VALUES(url),
                    atualizado_em = CURRENT_TIMESTAMP
                `,
                [
                    empresa_id,
                    sva.nome_sva,
                    sva.habilitado ? 1 : 0,
                    sva.url || ""
                ]
            );
        }

        res.json({ sucesso: true });

    } catch (err) {
        console.error("Erro ao salvar SVAs:", err);
        res.status(500).json({ erro: "Erro ao salvar SVAs" });
    }
});

// LISTAR APENAS SVAs HABILITADOS DA EMPRESA
router.get("/habilitados", async (req, res) => {
    try {
        const empresa_id = req.headers["x-empresa-id"];

        if (!empresa_id) {
            return res.status(400).json({ erro: "empresa_id não informado" });
        }

        const [rows] = await pool.query(
            `
            SELECT id, empresa_id, nome_sva, habilitado, url
            FROM svas_empresa
            WHERE empresa_id = ?
              AND habilitado = 1
            ORDER BY nome_sva ASC
            `,
            [empresa_id]
        );

        res.json(rows);

    } catch (err) {
        console.error("Erro ao listar SVAs habilitados:", err);
        res.status(500).json({ erro: "Erro ao listar SVAs habilitados" });
    }
});

module.exports = router;
