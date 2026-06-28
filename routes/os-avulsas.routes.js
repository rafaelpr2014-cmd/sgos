const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "../uploads/os-avulsas");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || "");
        const nome = `os-avulsa-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
        cb(null, nome);
    }
});

const upload = multer({ storage });

module.exports = (db) => {

    let schemaVerificado = false;

    async function garantirColunasExtras() {
        if (schemaVerificado) return;
        schemaVerificado = true;

        const colunas = [
            { nome: "endereco", sql: "ALTER TABLE os_avulsas ADD COLUMN endereco VARCHAR(255) NULL" },
            { nome: "iniciado_em", sql: "ALTER TABLE os_avulsas ADD COLUMN iniciado_em DATETIME NULL" },
            { nome: "iniciado_por", sql: "ALTER TABLE os_avulsas ADD COLUMN iniciado_por INT NULL" },
            { nome: "finalizado_em", sql: "ALTER TABLE os_avulsas ADD COLUMN finalizado_em DATETIME NULL" },
            { nome: "finalizado_por", sql: "ALTER TABLE os_avulsas ADD COLUMN finalizado_por INT NULL" },
            { nome: "atualizado_em", sql: "ALTER TABLE os_avulsas ADD COLUMN atualizado_em DATETIME NULL" }
        ];

        for (const coluna of colunas) {
            try {
                const [rows] = await db.query(`SHOW COLUMNS FROM os_avulsas LIKE ?`, [coluna.nome]);

                if (!rows.length) {
                    await db.query(coluna.sql);
                }
            } catch (err) {
                console.warn(`Aviso: não foi possível verificar/criar coluna ${coluna.nome}:`, err.message);
            }
        }
    }

    function periodoSQL(periodo) {
        const hoje = new Date();
        hoje.setHours(23, 59, 59, 999);

        const inicio = new Date(hoje);
        const fim = new Date(hoje);

        if (periodo === "ontem") {
            inicio.setDate(inicio.getDate() - 1);
            inicio.setHours(0, 0, 0, 0);

            fim.setDate(fim.getDate() - 1);
            fim.setHours(23, 59, 59, 999);
        } else if (periodo === "7dias") {
            inicio.setDate(inicio.getDate() - 6);
            inicio.setHours(0, 0, 0, 0);
        } else if (periodo === "30dias") {
            inicio.setDate(inicio.getDate() - 29);
            inicio.setHours(0, 0, 0, 0);
        } else {
            inicio.setHours(0, 0, 0, 0);
        }

        const toMysql = (d) => {
            const pad = n => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        };

        return {
            inicio: toMysql(inicio),
            fim: toMysql(fim)
        };
    }

    // ===============================
    // LISTAR OS AVULSAS
    // ===============================
    router.get("/", async (req, res) => {
        try {
            await garantirColunasExtras();

            const status = req.query.status;

            let sql = `
                SELECT 
                    oa.*,
                    u.usuario AS criado_por_nome,
                    ui.usuario AS iniciado_por_nome,
                    uf.usuario AS finalizado_por_nome
                FROM os_avulsas oa
                LEFT JOIN usuarios u
                    ON u.id = oa.criado_por
                LEFT JOIN usuarios ui
                    ON ui.id = oa.iniciado_por
                LEFT JOIN usuarios uf
                    ON uf.id = oa.finalizado_por
            `;

            const params = [];

            if (status) {
                sql += ` WHERE oa.status = ? `;
                params.push(status);
            }

            sql += ` ORDER BY oa.criado_em DESC `;

            const [rows] = await db.query(sql, params);

            res.json(rows);

        } catch (err) {
            console.error("Erro ao listar OS Avulsas:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    // ===============================
    // LISTAR PARA PAINEL
    // Retorna abertas/em andamento sempre + concluídas do período
    // ===============================
    router.get("/painel", async (req, res) => {
        try {
            await garantirColunasExtras();

            const periodo = req.query.periodo || "hoje";
            const range = periodoSQL(periodo);

            const [rows] = await db.query(`
                SELECT 
                    oa.*,
                    u.usuario AS criado_por_nome,
                    ui.usuario AS iniciado_por_nome,
                    uf.usuario AS finalizado_por_nome
                FROM os_avulsas oa
                LEFT JOIN usuarios u
                    ON u.id = oa.criado_por
                LEFT JOIN usuarios ui
                    ON ui.id = oa.iniciado_por
                LEFT JOIN usuarios uf
                    ON uf.id = oa.finalizado_por
                WHERE
                    oa.status IN ('em_aberto','em_andamento')
                    OR (
                        oa.status = 'concluido'
                        AND COALESCE(oa.finalizado_em, oa.atualizado_em, oa.criado_em)
                            BETWEEN ? AND ?
                    )
                ORDER BY
                    CASE
                        WHEN oa.status = 'em_aberto' THEN 1
                        WHEN oa.status = 'em_andamento' THEN 2
                        WHEN oa.status = 'concluido' THEN 3
                        ELSE 4
                    END,
                    COALESCE(oa.finalizado_em, oa.atualizado_em, oa.criado_em) DESC
            `, [range.inicio, range.fim]);

            res.json(rows);

        } catch (err) {
            console.error("Erro ao listar OS Avulsas no painel:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    // ===============================
    // OPÇÕES PARA AUTOCOMPLETE
    // ===============================
    router.get("/opcoes/localidades", async (req, res) => {
        try {
            const q = `%${String(req.query.q || "").trim()}%`;

            // Busca somente nas localidades já usadas em OS Avulsas.
            // Assim, se digitar uma nova localidade e salvar, ela passa a aparecer nas próximas OS.
            const [rows] = await db.query(`
                SELECT DISTINCT localidade AS nome
                FROM os_avulsas
                WHERE localidade LIKE ?
                  AND localidade IS NOT NULL
                  AND TRIM(localidade) <> ''
                ORDER BY localidade ASC
                LIMIT 20
            `, [q]);

            res.json(rows);

        } catch (err) {
            console.error("Erro ao buscar localidades OS Avulsas:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    router.get("/opcoes/tipos-servicos", async (req, res) => {
        try {
            const q = `%${req.query.q || ""}%`;

            const [rows] = await db.query(`
                SELECT DISTINCT tipo_servico AS nome
                FROM os_avulsas
                WHERE tipo_servico LIKE ?
                  AND tipo_servico IS NOT NULL
                  AND tipo_servico <> ''
                ORDER BY tipo_servico ASC
                LIMIT 20
            `, [q]);

            res.json(rows);

        } catch (err) {
            console.error("Erro ao buscar tipos de serviços:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    router.get("/sugestoes/tipos-servicos", async (req, res) => {
    try {
        const q = `%${req.query.q || ""}%`;

        const [rows] = await db.query(`
            SELECT DISTINCT tipo_servico AS nome
            FROM os_avulsas
            WHERE tipo_servico LIKE ?
              AND tipo_servico IS NOT NULL
              AND tipo_servico <> ''
            ORDER BY tipo_servico ASC
            LIMIT 20
        `, [q]);

        res.json(rows);

    } catch (err) {
        console.error("Erro ao buscar tipos de serviços:", err);
        res.status(500).json({ erro: err.message });
    }
});

    // ===============================
    // ACESSAR ANEXO
    // ===============================
    router.get("/anexo/:arquivo", (req, res) => {
        const arquivo = req.params.arquivo;
        const filePath = path.join(uploadDir, arquivo);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("Anexo não encontrado");
        }

        res.sendFile(filePath);
    });

    // ===============================
    // COMPROVANTE OS AVULSA
    // ===============================
    router.get("/comprovacao/:id", async (req, res) => {
        try {
            await garantirColunasExtras();

            const [rows] = await db.query(`
                SELECT
                    oa.*,
                    u.usuario AS criado_por_nome,
                    ui.usuario AS iniciado_por_nome,
                    uf.usuario AS finalizado_por_nome
                FROM os_avulsas oa
                LEFT JOIN usuarios u
                    ON u.id = oa.criado_por
                LEFT JOIN usuarios ui
                    ON ui.id = oa.iniciado_por
                LEFT JOIN usuarios uf
                    ON uf.id = oa.finalizado_por
                WHERE oa.id = ?
            `, [req.params.id]);

            if (!rows.length) {
                return res.status(404).send("OS Avulsa não encontrada");
            }

            const os = rows[0];
            const fmt = (data) => data ? new Date(data).toLocaleString("pt-BR") : "-";
            const esc = (v) => String(v || "-")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");

            res.send(`
                <!DOCTYPE html>
                <html lang="pt-br">
                <head>
                    <meta charset="UTF-8">
                    <title>Comprovante OS Avulsa #${os.id}</title>
                    <style>
                        body{font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:30px;color:#111827;}
                        .box{max-width:900px;margin:auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
                        h1{margin:0 0 8px;color:#1f2937;}
                        .sub{color:#64748b;margin-bottom:22px;}
                        table{width:100%;border-collapse:collapse;}
                        td{padding:11px;border-bottom:1px solid #e5e7eb;vertical-align:top;}
                        td:first-child{font-weight:bold;width:220px;background:#f8fafc;}
                        .status{display:inline-block;padding:6px 10px;border-radius:999px;background:#dcfce7;color:#15803d;font-weight:bold;}
                        .print{margin-top:22px;text-align:right;}
                        button{border:none;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;cursor:pointer;}
                    </style>
                </head>
                <body>
                    <div class="box">
                        <h1>Comprovante de OS Avulsa #${os.id}</h1>
                        <div class="sub">SGOS - Sistema de Gestão de Ordens de Serviço</div>
                        <table>
                            <tr><td>Localidade</td><td>${esc(os.localidade)}</td></tr>
                            <tr><td>Endereço</td><td>${esc(os.endereco)}</td></tr>
                            <tr><td>Técnicos</td><td>${esc(os.tecnicos_nomes || os.tecnicos)}</td></tr>
                            <tr><td>Tipo de Serviço</td><td>${esc(os.tipo_servico)}</td></tr>
                            <tr><td>Descrição</td><td>${esc(os.descricao)}</td></tr>
                            <tr><td>Criada em</td><td>${fmt(os.criado_em)}</td></tr>
                            <tr><td>Iniciada em</td><td>${fmt(os.iniciado_em)}</td></tr>
                            <tr><td>Finalizada em</td><td>${fmt(os.finalizado_em || os.atualizado_em)}</td></tr>
                            <tr><td>Criada por</td><td>${esc(os.criado_por_nome)}</td></tr>
                            <tr><td>Finalizada por</td><td>${esc(os.finalizado_por_nome)}</td></tr>
                            <tr><td>Status</td><td><span class="status">${esc(os.status)}</span></td></tr>
                        </table>
                        <div class="print"><button onclick="window.print()">Imprimir</button></div>
                    </div>
                </body>
                </html>
            `);

        } catch (err) {
            console.error("Erro ao gerar comprovante OS Avulsa:", err);
            res.status(500).send(err.message);
        }
    });

    // ===============================
    // BUSCAR POR ID
    // ===============================
    router.get("/:id", async (req, res) => {
        try {
            await garantirColunasExtras();

            const [rows] = await db.query(`
                SELECT 
                    oa.*,
                    u.usuario AS criado_por_nome,
                    ui.usuario AS iniciado_por_nome,
                    uf.usuario AS finalizado_por_nome
                FROM os_avulsas oa
                LEFT JOIN usuarios u
                    ON u.id = oa.criado_por
                LEFT JOIN usuarios ui
                    ON ui.id = oa.iniciado_por
                LEFT JOIN usuarios uf
                    ON uf.id = oa.finalizado_por
                WHERE oa.id = ?
            `, [req.params.id]);

            if (rows.length === 0) {
                return res.status(404).json({ erro: "OS Avulsa não encontrada" });
            }

            res.json(rows[0]);

        } catch (err) {
            console.error("Erro ao buscar OS Avulsa:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    // ===============================
    // CRIAR OS AVULSA
    // ===============================
    router.post("/", upload.single("anexo"), async (req, res) => {
        try {
            await garantirColunasExtras();

            const usuarioId = req.headers["x-usuario-id"] || null;

            const {
                localidade,
                endereco,
                tecnicos,
                tecnicos_nomes,
                tipo_servico,
                descricao,
                status
            } = req.body;

            const anexo = req.file ? req.file.filename : null;

            if (!localidade || !tecnicos || !tipo_servico) {
                return res.status(400).json({
                    erro: "Campos obrigatórios não preenchidos"
                });
            }

            const [result] = await db.query(`
                INSERT INTO os_avulsas
                (
                    localidade,
                    endereco,
                    tecnicos,
                    tecnicos_nomes,
                    tipo_servico,
                    descricao,
                    anexo,
                    status,
                    criado_por,
                    atualizado_em
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                localidade,
                endereco,
                tecnicos,
                tecnicos_nomes || "",
                tipo_servico,
                descricao || "",
                anexo,
                status || "em_aberto",
                usuarioId
            ]);

            res.json({
                sucesso: true,
                id: result.insertId,
                mensagem: "OS Avulsa cadastrada com sucesso"
            });

        } catch (err) {
            console.error("Erro ao salvar OS Avulsa:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    // ===============================
    // EDITAR OS AVULSA
    // ===============================
    router.put("/:id", upload.single("anexo"), async (req, res) => {
        try {
            await garantirColunasExtras();

            const {
                localidade,
                endereco,
                tecnicos,
                tecnicos_nomes,
                tipo_servico,
                descricao,
                status
            } = req.body;

            if (!localidade || !tecnicos || !tipo_servico) {
                return res.status(400).json({
                    erro: "Campos obrigatórios não preenchidos"
                });
            }

            let sql = `
                UPDATE os_avulsas
                SET
                    localidade = ?,
                    endereco = ?,
                    tecnicos = ?,
                    tecnicos_nomes = ?,
                    tipo_servico = ?,
                    descricao = ?,
                    status = ?,
                    atualizado_em = NOW()
            `;

            const params = [
                localidade,
                endereco,
                tecnicos,
                tecnicos_nomes || "",
                tipo_servico,
                descricao || "",
                status || "em_aberto"
            ];

            if (req.file) {
                sql += `, anexo = ?`;
                params.push(req.file.filename);
            }

            sql += ` WHERE id = ?`;
            params.push(req.params.id);

            await db.query(sql, params);

            res.json({
                sucesso: true,
                mensagem: "OS Avulsa atualizada com sucesso"
            });

        } catch (err) {
            console.error("Erro ao editar OS Avulsa:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    // ===============================
    // ALTERAR STATUS
    // ===============================
    router.put("/:id/status", async (req, res) => {
        try {
            await garantirColunasExtras();

            const { status } = req.body;
            const usuarioId = req.headers["x-usuario-id"] || null;

            if (!["em_aberto", "em_andamento", "concluido"].includes(status)) {
                return res.status(400).json({
                    erro: "Status inválido"
                });
            }

            if (status === "em_andamento") {
                await db.query(`
                    UPDATE os_avulsas
                    SET
                        status = ?,
                        iniciado_em = COALESCE(iniciado_em, NOW()),
                        iniciado_por = COALESCE(iniciado_por, ?),
                        finalizado_em = NULL,
                        finalizado_por = NULL,
                        atualizado_em = NOW()
                    WHERE id = ?
                `, [
                    status,
                    usuarioId,
                    req.params.id
                ]);
            } else if (status === "concluido") {
                await db.query(`
                    UPDATE os_avulsas
                    SET
                        status = ?,
                        iniciado_em = COALESCE(iniciado_em, NOW()),
                        iniciado_por = COALESCE(iniciado_por, ?),
                        finalizado_em = NOW(),
                        finalizado_por = ?,
                        atualizado_em = NOW()
                    WHERE id = ?
                `, [
                    status,
                    usuarioId,
                    usuarioId,
                    req.params.id
                ]);
            } else {
                await db.query(`
                    UPDATE os_avulsas
                    SET
                        status = ?,
                        iniciado_em = NULL,
                        iniciado_por = NULL,
                        finalizado_em = NULL,
                        finalizado_por = NULL,
                        atualizado_em = NOW()
                    WHERE id = ?
                `, [
                    status,
                    req.params.id
                ]);
            }

            res.json({ sucesso: true });

        } catch (err) {
            console.error("Erro ao alterar status da OS Avulsa:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    // ===============================
    // EXCLUIR
    // ===============================
    router.delete("/:id", async (req, res) => {
        try {
            await garantirColunasExtras();

            await db.query(`
                DELETE FROM os_avulsas
                WHERE id = ?
            `, [req.params.id]);

            res.json({ sucesso: true });

        } catch (err) {
            console.error("Erro ao excluir OS Avulsa:", err);
            res.status(500).json({ erro: err.message });
        }
    });

    return router;
};
