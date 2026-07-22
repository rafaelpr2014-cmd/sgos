const express = require("express");

module.exports = function viabilidadeClientesErpRoutes(pool, verificarAutenticacao) {
    const router = express.Router();

    async function garantirEstrutura() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS viabilidade_clientes_erp (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                empresa_id TINYINT UNSIGNED NOT NULL,
                viabilidade_id INT UNSIGNED NOT NULL,
                origem_erp VARCHAR(30) NOT NULL,
                id_erp VARCHAR(100) NOT NULL,
                cliente_id_erp VARCHAR(100) NULL,
                nome VARCHAR(180) NOT NULL,
                endereco VARCHAR(500) NULL,
                numero VARCHAR(40) NULL,
                bairro VARCHAR(150) NULL,
                referencia VARCHAR(255) NULL,
                plano_nome_erp VARCHAR(255) NULL,
                login VARCHAR(150) NULL,
                telefone VARCHAR(60) NULL,
                status_contrato VARCHAR(80) NULL,
                servidor VARCHAR(255) NULL,
                criado_por INT UNSIGNED NULL,
                criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uk_viabilidade_cliente_erp
                    (empresa_id, viabilidade_id, origem_erp, id_erp),
                KEY idx_vce_viabilidade (empresa_id, viabilidade_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const [colunas] = await pool.query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'viabilidade'
              AND COLUMN_NAME = 'observacao_pos_instalacao'
        `);

        if (!colunas.length) {
            await pool.query(`
                ALTER TABLE viabilidade
                ADD COLUMN observacao_pos_instalacao TEXT NULL
                AFTER observacao_pos_aprovacao
            `);
        }
    }

    const pronto = garantirEstrutura().catch((err) => {
        console.error("Erro ao preparar clientes ERP da viabilidade:", err);
    });

    router.use(verificarAutenticacao);
    router.use(async (req, res, next) => {
        try {
            await pronto;
            next();
        } catch (err) {
            res.status(500).json({ erro: err.message });
        }
    });

    router.get("/viabilidade/:viabilidadeId", async (req, res) => {
        try {
            const empresaId = Number(req.usuario.empresa_id);
            const viabilidadeId = Number(req.params.viabilidadeId);

            const [rows] = await pool.query(`
                SELECT
                    id AS vinculo_id,
                    viabilidade_id,
                    origem_erp,
                    id_erp,
                    cliente_id_erp,
                    nome,
                    endereco,
                    numero,
                    bairro,
                    referencia,
                    plano_nome_erp,
                    login,
                    telefone,
                    status_contrato,
                    servidor,
                    criado_em
                FROM viabilidade_clientes_erp
                WHERE empresa_id = ?
                  AND viabilidade_id = ?
                ORDER BY id
            `, [empresaId, viabilidadeId]);

            res.json({ clientes: rows });
        } catch (err) {
            console.error("Erro ao listar clientes ERP da viabilidade:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    router.get("/lote", async (req, res) => {
        try {
            const empresaId = Number(req.usuario.empresa_id);
            const ids = String(req.query.ids || "")
                .split(",")
                .map(Number)
                .filter((id) => Number.isInteger(id) && id > 0)
                .slice(0, 1000);

            if (!ids.length) {
                return res.json({ por_viabilidade: {} });
            }

            const marcadores = ids.map(() => "?").join(",");
            const [rows] = await pool.query(`
                SELECT
                    id AS vinculo_id,
                    viabilidade_id,
                    origem_erp,
                    id_erp,
                    cliente_id_erp,
                    nome,
                    endereco,
                    numero,
                    bairro,
                    referencia,
                    plano_nome_erp,
                    login,
                    telefone,
                    status_contrato,
                    servidor,
                    criado_em
                FROM viabilidade_clientes_erp
                WHERE empresa_id = ?
                  AND viabilidade_id IN (${marcadores})
                ORDER BY viabilidade_id, id
            `, [empresaId, ...ids]);

            const porViabilidade = {};
            for (const row of rows) {
                const chave = String(row.viabilidade_id);
                if (!porViabilidade[chave]) porViabilidade[chave] = [];
                porViabilidade[chave].push(row);
            }

            res.json({ por_viabilidade: porViabilidade });
        } catch (err) {
            console.error("Erro ao listar clientes ERP em lote:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    router.post("/", async (req, res) => {
        try {
            const empresaId = Number(req.usuario.empresa_id);
            const usuarioId = Number(req.usuario.id);
            const dados = req.body || {};
            const viabilidadeId = Number(dados.viabilidade_id);

            if (!viabilidadeId || !dados.origem_erp || !dados.id_erp || !dados.nome) {
                return res.status(400).json({
                    erro: "Viabilidade, ERP, ID do cliente e nome são obrigatórios."
                });
            }

            const [viabilidade] = await pool.query(`
                SELECT id
                FROM viabilidade
                WHERE id = ?
                  AND empresa_id = ?
                LIMIT 1
            `, [viabilidadeId, empresaId]);

            if (!viabilidade.length) {
                return res.status(404).json({ erro: "Viabilidade não encontrada." });
            }

            const valores = [
                empresaId,
                viabilidadeId,
                String(dados.origem_erp).toLowerCase().slice(0, 30),
                String(dados.id_erp).slice(0, 100),
                dados.cliente_id_erp ? String(dados.cliente_id_erp).slice(0, 100) : null,
                String(dados.nome).slice(0, 180),
                dados.endereco ? String(dados.endereco).slice(0, 500) : null,
                dados.numero ? String(dados.numero).slice(0, 40) : null,
                dados.bairro ? String(dados.bairro).slice(0, 150) : null,
                dados.referencia ? String(dados.referencia).slice(0, 255) : null,
                dados.plano_nome_erp ? String(dados.plano_nome_erp).slice(0, 255) : null,
                dados.login ? String(dados.login).slice(0, 150) : null,
                dados.telefone ? String(dados.telefone).slice(0, 60) : null,
                dados.status_contrato ? String(dados.status_contrato).slice(0, 80) : null,
                dados.servidor ? String(dados.servidor).slice(0, 255) : null,
                usuarioId || null
            ];

            const [resultado] = await pool.query(`
                INSERT INTO viabilidade_clientes_erp (
                    empresa_id,
                    viabilidade_id,
                    origem_erp,
                    id_erp,
                    cliente_id_erp,
                    nome,
                    endereco,
                    numero,
                    bairro,
                    referencia,
                    plano_nome_erp,
                    login,
                    telefone,
                    status_contrato,
                    servidor,
                    criado_por
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    cliente_id_erp = VALUES(cliente_id_erp),
                    nome = VALUES(nome),
                    endereco = VALUES(endereco),
                    numero = VALUES(numero),
                    bairro = VALUES(bairro),
                    referencia = VALUES(referencia),
                    plano_nome_erp = VALUES(plano_nome_erp),
                    login = VALUES(login),
                    telefone = VALUES(telefone),
                    status_contrato = VALUES(status_contrato),
                    servidor = VALUES(servidor),
                    id = LAST_INSERT_ID(id)
            `, valores);

            res.json({
                sucesso: true,
                id: resultado.insertId,
                vinculo_id: resultado.insertId
            });
        } catch (err) {
            console.error("Erro ao salvar cliente ERP da viabilidade:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    router.delete("/:id", async (req, res) => {
        try {
            const empresaId = Number(req.usuario.empresa_id);
            const id = Number(req.params.id);

            const [resultado] = await pool.query(`
                DELETE FROM viabilidade_clientes_erp
                WHERE id = ?
                  AND empresa_id = ?
            `, [id, empresaId]);

            if (!resultado.affectedRows) {
                return res.status(404).json({ erro: "Vínculo ERP não encontrado." });
            }

            res.json({ sucesso: true });
        } catch (err) {
            console.error("Erro ao remover cliente ERP da viabilidade:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    return router;
};
