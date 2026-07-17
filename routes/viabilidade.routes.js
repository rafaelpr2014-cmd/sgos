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
            cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extensao}`);
        }
    });

    const upload = multer({
        storage,
        limits: { fileSize: 30 * 1024 * 1024, files: 1 },
        fileFilter: (_req, file, cb) => {
            const tipo = String(file.mimetype || "");
            if (!tipo.startsWith("image/") && !tipo.startsWith("video/")) {
                return cb(new Error("Somente fotos e vídeos são permitidos."));
            }
            cb(null, true);
        }
    });

    function caminhoPublico(nomeArquivo) {
        return `/uploads/viabilidade/${path.basename(String(nomeArquivo || ""))}`;
    }

    function removerArquivo(caminhoOuNome) {
        if (!caminhoOuNome) return;
        const arquivo = path.join(pastaUploads, path.basename(String(caminhoOuNome)));
        fs.unlink(arquivo, (erro) => {
            if (erro && erro.code !== "ENOENT") {
                console.error("Erro ao remover anexo de viabilidade:", erro);
            }
        });
    }

    function mapearAnexo(anexo) {
        const url = anexo.caminho || caminhoPublico(anexo.nome_arquivo);
        return {
            id: anexo.id,
            viabilidade_id: anexo.viabilidade_id,
            caminho: url,
            arquivo: url,
            url,
            nome_arquivo: anexo.nome_arquivo,
            tipo: anexo.tipo,
            data_upload: anexo.data_upload,
            cadastrado_por: anexo.cadastrado_por,
            registrado_em: anexo.registrado_em,
            categoria: anexo.categoria || "ANALISE"
        };
    }

    function normalizarTecnicosResponsaveis(valor) {
        const lista = Array.isArray(valor)
            ? valor
            : String(valor || "").split(/[,;|]/);
        const tecnicos = [...new Set(lista.map(v => String(v || "").trim()).filter(Boolean))];
        if (tecnicos.length > 4) {
            const erro = new Error("É permitido selecionar no máximo 4 técnicos.");
            erro.statusCode = 400;
            throw erro;
        }
        return tecnicos.length ? tecnicos.join(", ") : null;
    }

    router.get("/viabilidade", verificarAutenticacao, async (req, res) => {
        try {
            const empresaId = req.usuario.empresa_id;
            const [viabilidades] = await pool.query(
                `SELECT v.id, v.nome, v.endereco, v.observacao, v.telefone, v.telefone2, v.localidade,
                        COALESCE(l.nome, NULLIF(v.localidade, '')) AS localidade_nome,
                        v.empresa_id, v.cadastrado_por, v.registrado_em, v.status, v.status_instalacao, v.instalacao_aprovada_em,
                        v.atualizado_em, v.atualizado_por, v.tecnico_responsavel, v.observacao_pos_aprovacao,
                        v.latitude, v.longitude
                 FROM viabilidade v
                 LEFT JOIN localidades l
                        ON l.id = CAST(v.localidade AS UNSIGNED)
                       AND l.empresa_id = v.empresa_id
                 WHERE v.empresa_id = ?
                 ORDER BY COALESCE(v.registrado_em, '1970-01-01') DESC, v.id DESC`,
                [empresaId]
            );

            if (!viabilidades.length) return res.json([]);

            const ids = viabilidades.map(v => v.id);
            const placeholders = ids.map(() => "?").join(",");
            const [anexos] = await pool.query(
                `SELECT id, viabilidade_id, caminho, tipo, data_upload,
                        cadastrado_por, registrado_em, nome_arquivo, empresa_id, categoria
                 FROM viabilidade_anexos
                 WHERE empresa_id = ?
                   AND viabilidade_id IN (${placeholders})
                 ORDER BY COALESCE(registrado_em, data_upload) DESC, id DESC`,
                [empresaId, ...ids]
            );

            const mapa = new Map();
            for (const anexo of anexos) {
                if (!mapa.has(anexo.viabilidade_id)) mapa.set(anexo.viabilidade_id, []);
                mapa.get(anexo.viabilidade_id).push(mapearAnexo(anexo));
            }

            return res.json(viabilidades.map(v => ({ ...v, anexos: mapa.get(v.id) || [] })));
        } catch (erro) {
            console.error("Erro ao listar viabilidades:", erro);
            return res.status(erro.statusCode || 500).json({ erro: erro.message });
        }
    });

    router.get("/viabilidade/:id", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT v.id, v.nome, v.endereco, v.observacao, v.telefone, v.telefone2, v.localidade,
                        COALESCE(l.nome, NULLIF(v.localidade, '')) AS localidade_nome,
                        v.empresa_id, v.cadastrado_por, v.registrado_em, v.status, v.status_instalacao, v.instalacao_aprovada_em,
                        v.atualizado_em, v.atualizado_por, v.tecnico_responsavel, v.observacao_pos_aprovacao,
                        v.latitude, v.longitude
                 FROM viabilidade v
                 LEFT JOIN localidades l
                        ON l.id = CAST(v.localidade AS UNSIGNED)
                       AND l.empresa_id = v.empresa_id
                 WHERE v.id = ? AND v.empresa_id = ? LIMIT 1`,
                [req.params.id, req.usuario.empresa_id]
            );
            if (!rows.length) return res.status(404).json({ erro: "Viabilidade não encontrada." });

            const [anexos] = await pool.query(
                `SELECT id, viabilidade_id, caminho, tipo, data_upload,
                        cadastrado_por, registrado_em, nome_arquivo, empresa_id, categoria
                 FROM viabilidade_anexos
                 WHERE viabilidade_id = ? AND empresa_id = ?
                 ORDER BY COALESCE(registrado_em, data_upload) DESC, id DESC`,
                [req.params.id, req.usuario.empresa_id]
            );

            return res.json({ ...rows[0], anexos: anexos.map(mapearAnexo) });
        } catch (erro) {
            console.error("Erro ao consultar viabilidade:", erro);
            return res.status(erro.statusCode || 500).json({ erro: erro.message });
        }
    });

    router.post("/viabilidade", verificarAutenticacao, async (req, res) => {
        try {
            const nome = String(req.body.nome || "").trim();
            const endereco = String(req.body.endereco || "").trim();
            const observacao = String(req.body.observacao || "").trim() || null;
            const telefone = String(req.body.telefone || "").trim() || null;
            const telefone2 = String(req.body.telefone2 || "").trim() || null;
            const localidade = String(req.body.localidade || "").trim();
            const tecnicoResponsavel = normalizarTecnicosResponsaveis(req.body.tecnico_responsavel);
            const observacaoPosAprovacao = String(req.body.observacao_pos_aprovacao || "").trim() || null;
            const latitudeRecebida = req.body.latitude;
            const longitudeRecebida = req.body.longitude;
            const latitude = latitudeRecebida === "" || latitudeRecebida === null || latitudeRecebida === undefined
                ? null : Number(latitudeRecebida);
            const longitude = longitudeRecebida === "" || longitudeRecebida === null || longitudeRecebida === undefined
                ? null : Number(longitudeRecebida);
            if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) {
                return res.status(400).json({ erro: "Latitude ou longitude inválida." });
            }
            const statusRecebido = String(req.body.status || "PENDENTE").trim().toUpperCase();
            const statusPermitidos = ["PENDENTE", "EM_ANALISE", "APROVADA", "REPROVADA"];
            const status = statusPermitidos.includes(statusRecebido) ? statusRecebido : "PENDENTE";

            const statusInstalacaoPermitidos = ["PENDENTE", "INSTALADO"];
            let statusInstalacao = null;
            if (status === "APROVADA") {
                const recebido = String(req.body.status_instalacao || "PENDENTE").trim().toUpperCase();
                statusInstalacao = statusInstalacaoPermitidos.includes(recebido) ? recebido : "PENDENTE";
            }
            if (!nome || !endereco || !localidade) {
                return res.status(400).json({ erro: "Nome, endereço e localidade são obrigatórios." });
            }

            const cadastradoPor = req.usuario.usuario || String(req.usuario.id);
            const [resultado] = await pool.query(
                `INSERT INTO viabilidade
                    (nome, endereco, observacao, telefone, telefone2, localidade, tecnico_responsavel, observacao_pos_aprovacao, status, status_instalacao, instalacao_aprovada_em,
                     latitude, longitude, empresa_id, cadastrado_por, registrado_em, atualizado_em, atualizado_por)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)`,
                [nome, endereco, observacao, telefone, telefone2, localidade, tecnicoResponsavel, observacaoPosAprovacao, status, statusInstalacao, statusInstalacao === "INSTALADO" ? new Date() : null,
                 latitude, longitude, req.usuario.empresa_id, cadastradoPor, cadastradoPor]
            );

            return res.status(201).json({ sucesso: true, id: resultado.insertId, viabilidade_id: resultado.insertId });
        } catch (erro) {
            console.error("Erro ao criar viabilidade:", erro);
            return res.status(erro.statusCode || 500).json({ erro: erro.message });
        }
    });

    router.put("/viabilidade/:id", verificarAutenticacao, async (req, res) => {
        try {
            const nome = String(req.body.nome || "").trim();
            const endereco = String(req.body.endereco || "").trim();
            const observacao = String(req.body.observacao || "").trim() || null;
            const telefone = String(req.body.telefone || "").trim() || null;
            const telefone2 = String(req.body.telefone2 || "").trim() || null;
            const localidade = String(req.body.localidade || "").trim();
            const tecnicoResponsavel = normalizarTecnicosResponsaveis(req.body.tecnico_responsavel);
            const observacaoPosAprovacao = String(req.body.observacao_pos_aprovacao || "").trim() || null;
            const latitudeRecebida = req.body.latitude;
            const longitudeRecebida = req.body.longitude;
            const latitude = latitudeRecebida === "" || latitudeRecebida === null || latitudeRecebida === undefined
                ? null : Number(latitudeRecebida);
            const longitude = longitudeRecebida === "" || longitudeRecebida === null || longitudeRecebida === undefined
                ? null : Number(longitudeRecebida);
            if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) {
                return res.status(400).json({ erro: "Latitude ou longitude inválida." });
            }
            const statusRecebido = String(req.body.status || "PENDENTE").trim().toUpperCase();
            const statusPermitidos = ["PENDENTE", "EM_ANALISE", "APROVADA", "REPROVADA"];
            const status = statusPermitidos.includes(statusRecebido) ? statusRecebido : "PENDENTE";

            const statusInstalacaoPermitidos = ["PENDENTE", "INSTALADO"];
            let statusInstalacao = null;
            if (status === "APROVADA") {
                const recebido = String(req.body.status_instalacao || "PENDENTE").trim().toUpperCase();
                statusInstalacao = statusInstalacaoPermitidos.includes(recebido) ? recebido : "PENDENTE";
            }

            if (!nome || !endereco || !localidade) {
                return res.status(400).json({ erro: "Nome, endereço e localidade são obrigatórios." });
            }

            const atualizadoPor = req.usuario.usuario || String(req.usuario.id);
            const [resultado] = await pool.query(
                `UPDATE viabilidade
                 SET nome = ?, endereco = ?, observacao = ?, telefone = ?, telefone2 = ?, localidade = ?,
                     tecnico_responsavel = ?, observacao_pos_aprovacao = ?, status = ?, status_instalacao = ?,
                     instalacao_aprovada_em = CASE
                         WHEN ? = 'INSTALADO' AND COALESCE(status_instalacao, '') <> 'INSTALADO' THEN NOW()
                         WHEN ? <> 'INSTALADO' THEN NULL
                         ELSE instalacao_aprovada_em
                     END,
                     latitude = ?, longitude = ?, atualizado_em = NOW(), atualizado_por = ?
                 WHERE id = ? AND empresa_id = ?`,
                [nome, endereco, observacao, telefone, telefone2, localidade, tecnicoResponsavel, observacaoPosAprovacao, status, statusInstalacao,
                 statusInstalacao, statusInstalacao, latitude, longitude, atualizadoPor, req.params.id, req.usuario.empresa_id]
            );

            if (!resultado.affectedRows) {
                return res.status(404).json({ erro: "Viabilidade não encontrada." });
            }

            return res.json({ sucesso: true, id: Number(req.params.id) });
        } catch (erro) {
            console.error("Erro ao editar viabilidade:", erro);
            return res.status(erro.statusCode || 500).json({ erro: erro.message });
        }
    });

    router.delete("/viabilidade/:id", verificarAutenticacao, async (req, res) => {
        const conexao = await pool.getConnection();
        try {
            await conexao.beginTransaction();
            const [registro] = await conexao.query(
                `SELECT id FROM viabilidade WHERE id = ? AND empresa_id = ? LIMIT 1`,
                [req.params.id, req.usuario.empresa_id]
            );
            if (!registro.length) {
                await conexao.rollback();
                return res.status(404).json({ erro: "Viabilidade não encontrada." });
            }

            const [anexos] = await conexao.query(
                `SELECT caminho, nome_arquivo FROM viabilidade_anexos
                 WHERE viabilidade_id = ? AND empresa_id = ?`,
                [req.params.id, req.usuario.empresa_id]
            );
            await conexao.query(
                `DELETE FROM viabilidade_anexos WHERE viabilidade_id = ? AND empresa_id = ?`,
                [req.params.id, req.usuario.empresa_id]
            );
            await conexao.query(
                `DELETE FROM viabilidade WHERE id = ? AND empresa_id = ?`,
                [req.params.id, req.usuario.empresa_id]
            );
            await conexao.commit();
            anexos.forEach(a => removerArquivo(a.caminho || a.nome_arquivo));
            return res.json({ sucesso: true });
        } catch (erro) {
            await conexao.rollback();
            console.error("Erro ao excluir viabilidade:", erro);
            return res.status(erro.statusCode || 500).json({ erro: erro.message });
        } finally {
            conexao.release();
        }
    });

    router.get("/viabilidade_anexos/:id", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT a.id, a.viabilidade_id, a.caminho, a.tipo, a.data_upload,
                        a.cadastrado_por, a.registrado_em, a.nome_arquivo, a.empresa_id, a.categoria
                 FROM viabilidade_anexos a
                 INNER JOIN viabilidade v ON v.id = a.viabilidade_id
                 WHERE a.viabilidade_id = ? AND a.empresa_id = ? AND v.empresa_id = ?
                 ORDER BY COALESCE(a.registrado_em, a.data_upload) DESC, a.id DESC`,
                [req.params.id, req.usuario.empresa_id, req.usuario.empresa_id]
            );
            return res.json(rows.map(mapearAnexo));
        } catch (erro) {
            console.error("Erro ao listar anexos:", erro);
            return res.status(erro.statusCode || 500).json({ erro: erro.message });
        }
    });

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
                if (erro) return res.status(400).json({ erro: erro.message });
                next();
            });
        },
        async (req, res) => {
            try {
                if (!req.file) return res.status(400).json({ erro: "Arquivo não enviado." });
                const viabilidadeId = Number(req.body.viabilidade_id);
                if (!Number.isInteger(viabilidadeId) || viabilidadeId <= 0) {
                    removerArquivo(req.file.filename);
                    return res.status(400).json({ erro: "viabilidade_id inválido." });
                }

                const [viabilidade] = await pool.query(
                    `SELECT id FROM viabilidade WHERE id = ? AND empresa_id = ? LIMIT 1`,
                    [viabilidadeId, req.usuario.empresa_id]
                );
                if (!viabilidade.length) {
                    removerArquivo(req.file.filename);
                    return res.status(404).json({ erro: "Viabilidade não encontrada." });
                }

                const cadastradoPor = req.usuario.usuario || String(req.usuario.id);
                const categoriaRecebida = String(req.body.categoria || "ANALISE").trim().toUpperCase();
                const categoria = categoriaRecebida === "COMPROVACAO_VISITA" ? "COMPROVACAO_VISITA" : "ANALISE";
                const caminho = caminhoPublico(req.file.filename);
                const [resultado] = await pool.query(
                    `INSERT INTO viabilidade_anexos
                        (viabilidade_id, caminho, tipo, data_upload,
                         cadastrado_por, registrado_em, nome_arquivo, empresa_id, categoria)
                     VALUES (?, ?, ?, NOW(), ?, NOW(), ?, ?, ?)`,
                    [
                        viabilidadeId,
                        caminho,
                        req.file.mimetype || null,
                        cadastradoPor,
                        req.file.originalname || req.file.filename,
                        req.usuario.empresa_id,
                        categoria
                    ]
                );

                return res.status(201).json({
                    sucesso: true,
                    id: resultado.insertId,
                    caminho,
                    arquivo: caminho,
                    url: caminho,
                    categoria
                });
            } catch (erro) {
                if (req.file?.filename) removerArquivo(req.file.filename);
                console.error("Erro no upload de viabilidade:", erro);
                return res.status(erro.statusCode || 500).json({ erro: erro.message });
            }
        }
    );

    router.delete("/viabilidade_anexos/:id", verificarAutenticacao, async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT id, caminho, nome_arquivo FROM viabilidade_anexos
                 WHERE id = ? AND empresa_id = ? LIMIT 1`,
                [req.params.id, req.usuario.empresa_id]
            );
            if (!rows.length) return res.status(404).json({ erro: "Anexo não encontrado." });

            await pool.query(
                `DELETE FROM viabilidade_anexos WHERE id = ? AND empresa_id = ?`,
                [req.params.id, req.usuario.empresa_id]
            );
            removerArquivo(rows[0].caminho || rows[0].nome_arquivo);
            return res.json({ sucesso: true });
        } catch (erro) {
            console.error("Erro ao excluir anexo:", erro);
            return res.status(erro.statusCode || 500).json({ erro: erro.message });
        }
    });

    return router;
};
