const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

module.exports = function criarRotasViabilidade(pool, verificarAutenticacao) {
    const router = express.Router();
    const pastaUploads = path.join(__dirname, "..", "uploads", "viabilidade");

    fs.mkdirSync(pastaUploads, { recursive: true });

    const storage = multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, pastaUploads),
        filename: (_req, file, cb) => {
            const extensao = path.extname(file.originalname || "").toLowerCase();
            const nomeSeguro = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extensao}`;
            cb(null, nomeSeguro);
        }
    });

    const upload = multer({
        storage,
        limits: {
            fileSize: 30 * 1024 * 1024,
            files: 1
        },
        fileFilter: (_req, file, cb) => {
            const permitido =
                String(file.mimetype || "").startsWith("image/") ||
                String(file.mimetype || "").startsWith("video/");

            if (!permitido) {
                return cb(new Error("Somente fotos e vídeos são permitidos."));
            }

            cb(null, true);
        }
    });

    function removerArquivo(caminhoRelativo) {
        if (!caminhoRelativo) return;

        const nome = path.basename(String(caminhoRelativo));
        const arquivo = path.join(pastaUploads, nome);

        fs.unlink(arquivo, (erro) => {
            if (erro && erro.code !== "ENOENT") {
                console.error("Erro ao remover anexo de viabilidade:", erro);
            }
        });
    }

    // LISTAR VIABILIDADES E SEUS ANEXOS
    router.get("/viabilidade", verificarAutenticacao, async (req, res) => {
        try {
            const empresaId = req.usuario.empresa_id;

            const [viabilidades] = await pool.query(
                `SELECT
                    v.id,
                    v.nome,
                    v.endereco,
                    v.observacao,
                    v.telefone,
                    v.empresa_id,
                    v.cadastrado_por,
                    v.registrado_em
                 FROM viabilidade v
                 WHERE v.empresa_id = ?
                 ORDER BY COALESCE(v.registrado_em, '1970-01-01') DESC, v.id DESC`,
                [empresaId]
            );

            if (!viabilidades.length) {
                return res.json([]);
            }

            const ids = viabilidades.map((item) => item.id);
            const placeholders = ids.map(() => "?").join(",");

            const [anexos] = await pool.query(
                `SELECT
                    id,
                    viabilidade_id,
                    nome_arquivo,
                    nome_original,
                    tipo,
                    tamanho,
                    cadastrado_por,
                    registrado_em
                 FROM viabilidade_anexos
                 WHERE empresa_id = ?
                   AND viabilidade_id IN (${placeholders})
                 ORDER BY registrado_em DESC, id DESC`,
                [empresaId, ...ids]
            );

            const anexosPorViabilidade = new Map();

            for (const anexo of anexos) {
                if (!anexosPorViabilidade.has(anexo.viabilidade_id)) {
                    anexosPorViabilidade.set(anexo.viabilidade_id, []);
                }

                anexosPorViabilidade.get(anexo.viabilidade_id).push({
                    id: anexo.id,
                    arquivo: `/uploads/viabilidade/${anexo.nome_arquivo}`,
                    url: `/uploads/viabilidade/${anexo.nome_arquivo}`,
                    nome_original: anexo.nome_original,
                    tipo: anexo.tipo,
                    tamanho: anexo.tamanho,
                    cadastrado_por: anexo.cadastrado_por,
                    registrado_em: anexo.registrado_em
                });
            }

            return res.json(
                viabilidades.map((item) => ({
                    ...item,
                    anexos: anexosPorViabilidade.get(item.id) || []
                }))
            );
        } catch (erro) {
            console.error("Erro ao listar viabilidades:", erro);
            return res.status(500).json({ erro: erro.message });
        }
    });

    // CONSULTAR UMA VIABILIDADE
    router.get("/viabilidade/:id", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT id, nome, endereco, observacao, telefone,
                        empresa_id, cadastrado_por, registrado_em
                 FROM viabilidade
                 WHERE id = ? AND empresa_id = ?
                 LIMIT 1`,
                [req.params.id, req.usuario.empresa_id]
            );

            if (!rows.length) {
                return res.status(404).json({ erro: "Viabilidade não encontrada." });
            }

            const [anexos] = await pool.query(
                `SELECT id, viabilidade_id, nome_arquivo, nome_original,
                        tipo, tamanho, cadastrado_por, registrado_em
                 FROM viabilidade_anexos
                 WHERE viabilidade_id = ? AND empresa_id = ?
                 ORDER BY registrado_em DESC, id DESC`,
                [req.params.id, req.usuario.empresa_id]
            );

            return res.json({
                ...rows[0],
                anexos: anexos.map((anexo) => ({
                    ...anexo,
                    arquivo: `/uploads/viabilidade/${anexo.nome_arquivo}`,
                    url: `/uploads/viabilidade/${anexo.nome_arquivo}`
                }))
            });
        } catch (erro) {
            console.error("Erro ao consultar viabilidade:", erro);
            return res.status(500).json({ erro: erro.message });
        }
    });

    // CRIAR
    router.post("/viabilidade", verificarAutenticacao, async (req, res) => {
        try {
            const nome = String(req.body.nome || "").trim();
            const endereco = String(req.body.endereco || "").trim();
            const observacao = String(req.body.observacao || "").trim() || null;
            const telefone = String(req.body.telefone || "").trim() || null;

            if (!nome || !endereco) {
                return res.status(400).json({ erro: "Nome e endereço são obrigatórios." });
            }

            const cadastradoPor = req.usuario.usuario || String(req.usuario.id);

            const [resultado] = await pool.query(
                `INSERT INTO viabilidade
                    (nome, endereco, observacao, telefone, empresa_id, cadastrado_por, registrado_em)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    nome,
                    endereco,
                    observacao,
                    telefone,
                    req.usuario.empresa_id,
                    cadastradoPor
                ]
            );

            return res.status(201).json({
                sucesso: true,
                id: resultado.insertId,
                viabilidade_id: resultado.insertId
            });
        } catch (erro) {
            console.error("Erro ao criar viabilidade:", erro);
            return res.status(500).json({ erro: erro.message });
        }
    });

    // EDITAR
    router.put("/viabilidade/:id", verificarAutenticacao, async (req, res) => {
        try {
            const nome = String(req.body.nome || "").trim();
            const endereco = String(req.body.endereco || "").trim();
            const observacao = String(req.body.observacao || "").trim() || null;
            const telefone = String(req.body.telefone || "").trim() || null;

            if (!nome || !endereco) {
                return res.status(400).json({ erro: "Nome e endereço são obrigatórios." });
            }

            const [resultado] = await pool.query(
                `UPDATE viabilidade
                 SET nome = ?, endereco = ?, observacao = ?, telefone = ?
                 WHERE id = ? AND empresa_id = ?`,
                [
                    nome,
                    endereco,
                    observacao,
                    telefone,
                    req.params.id,
                    req.usuario.empresa_id
                ]
            );

            if (!resultado.affectedRows) {
                return res.status(404).json({ erro: "Viabilidade não encontrada." });
            }

            return res.json({ sucesso: true });
        } catch (erro) {
            console.error("Erro ao editar viabilidade:", erro);
            return res.status(500).json({ erro: erro.message });
        }
    });

    // EXCLUIR VIABILIDADE E ANEXOS
    router.delete("/viabilidade/:id", verificarAutenticacao, async (req, res) => {
        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();

            const [viabilidade] = await conexao.query(
                `SELECT id
                 FROM viabilidade
                 WHERE id = ? AND empresa_id = ?
                 LIMIT 1`,
                [req.params.id, req.usuario.empresa_id]
            );

            if (!viabilidade.length) {
                await conexao.rollback();
                return res.status(404).json({ erro: "Viabilidade não encontrada." });
            }

            const [anexos] = await conexao.query(
                `SELECT nome_arquivo
                 FROM viabilidade_anexos
                 WHERE viabilidade_id = ? AND empresa_id = ?`,
                [req.params.id, req.usuario.empresa_id]
            );

            await conexao.query(
                `DELETE FROM viabilidade_anexos
                 WHERE viabilidade_id = ? AND empresa_id = ?`,
                [req.params.id, req.usuario.empresa_id]
            );

            await conexao.query(
                `DELETE FROM viabilidade
                 WHERE id = ? AND empresa_id = ?`,
                [req.params.id, req.usuario.empresa_id]
            );

            await conexao.commit();

            anexos.forEach((anexo) => removerArquivo(anexo.nome_arquivo));

            return res.json({ sucesso: true });
        } catch (erro) {
            await conexao.rollback();
            console.error("Erro ao excluir viabilidade:", erro);
            return res.status(500).json({ erro: erro.message });
        } finally {
            conexao.release();
        }
    });

    // LISTAR ANEXOS DE UMA VIABILIDADE
    router.get("/viabilidade_anexos/:id", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT a.id, a.viabilidade_id, a.nome_arquivo, a.nome_original,
                        a.tipo, a.tamanho, a.cadastrado_por, a.registrado_em
                 FROM viabilidade_anexos a
                 INNER JOIN viabilidade v ON v.id = a.viabilidade_id
                 WHERE a.viabilidade_id = ?
                   AND a.empresa_id = ?
                   AND v.empresa_id = ?
                 ORDER BY a.registrado_em DESC, a.id DESC`,
                [req.params.id, req.usuario.empresa_id, req.usuario.empresa_id]
            );

            return res.json(
                rows.map((item) => ({
                    ...item,
                    arquivo: `/uploads/viabilidade/${item.nome_arquivo}`,
                    url: `/uploads/viabilidade/${item.nome_arquivo}`
                }))
            );
        } catch (erro) {
            console.error("Erro ao listar anexos:", erro);
            return res.status(500).json({ erro: erro.message });
        }
    });

    // UPLOAD DE UMA FOTO OU VÍDEO POR REQUISIÇÃO
    router.post(
        "/upload_viabilidade",
        verificarAutenticacao,
        (req, res, next) => {
            upload.single("arquivo")(req, res, (erro) => {
                if (erro instanceof multer.MulterError) {
                    if (erro.code === "LIMIT_FILE_SIZE") {
                        return res.status(413).json({ erro: "O arquivo ultrapassa o limite de 30 MB." });
                    }
                    return res.status(400).json({ erro: erro.message });
                }

                if (erro) {
                    return res.status(400).json({ erro: erro.message });
                }

                next();
            });
        },
        async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ erro: "Arquivo não enviado." });
                }

                const viabilidadeId = Number(req.body.viabilidade_id);

                if (!Number.isInteger(viabilidadeId) || viabilidadeId <= 0) {
                    removerArquivo(req.file.filename);
                    return res.status(400).json({ erro: "viabilidade_id inválido." });
                }

                const [viabilidade] = await pool.query(
                    `SELECT id
                     FROM viabilidade
                     WHERE id = ? AND empresa_id = ?
                     LIMIT 1`,
                    [viabilidadeId, req.usuario.empresa_id]
                );

                if (!viabilidade.length) {
                    removerArquivo(req.file.filename);
                    return res.status(404).json({ erro: "Viabilidade não encontrada." });
                }

                const cadastradoPor = req.usuario.usuario || String(req.usuario.id);

                const [resultado] = await pool.query(
                    `INSERT INTO viabilidade_anexos
                        (viabilidade_id, nome_arquivo, nome_original, tipo, tamanho,
                         cadastrado_por, registrado_em, empresa_id)
                     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
                    [
                        viabilidadeId,
                        req.file.filename,
                        req.file.originalname || null,
                        req.file.mimetype || null,
                        req.file.size || null,
                        cadastradoPor,
                        req.usuario.empresa_id
                    ]
                );

                return res.status(201).json({
                    sucesso: true,
                    id: resultado.insertId,
                    arquivo: `/uploads/viabilidade/${req.file.filename}`,
                    url: `/uploads/viabilidade/${req.file.filename}`
                });
            } catch (erro) {
                if (req.file?.filename) removerArquivo(req.file.filename);
                console.error("Erro no upload de viabilidade:", erro);
                return res.status(500).json({ erro: erro.message });
            }
        }
    );

    // EXCLUIR UM ANEXO ESPECÍFICO
    router.delete("/viabilidade_anexos/:id", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT id, nome_arquivo
                 FROM viabilidade_anexos
                 WHERE id = ? AND empresa_id = ?
                 LIMIT 1`,
                [req.params.id, req.usuario.empresa_id]
            );

            if (!rows.length) {
                return res.status(404).json({ erro: "Anexo não encontrado." });
            }

            await pool.query(
                `DELETE FROM viabilidade_anexos
                 WHERE id = ? AND empresa_id = ?`,
                [req.params.id, req.usuario.empresa_id]
            );

            removerArquivo(rows[0].nome_arquivo);
            return res.json({ sucesso: true });
        } catch (erro) {
            console.error("Erro ao excluir anexo:", erro);
            return res.status(500).json({ erro: erro.message });
        }
    });

    return router;
};
