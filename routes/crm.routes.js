const express = require("express");
const router = express.Router();
const db = require("../database");

/*
 * CRM SGOS
 * Segurança multiempresa:
 * - empresa_id nunca é recebido do front-end.
 * - todas as consultas obtêm a empresa pelo usuário autenticado.
 */


let estruturaCache = null;

async function obterEstruturaBanco() {
    if (estruturaCache) return estruturaCache;

    const [colunasUsuarios] = await db.query("SHOW COLUMNS FROM usuarios");
    const [colunasLocalidades] = await db.query("SHOW COLUMNS FROM localidades");

    const usuarios = new Set(colunasUsuarios.map(c => c.Field));
    const localidades = new Set(colunasLocalidades.map(c => c.Field));

    const colunaNomeUsuario =
        usuarios.has("usuario") ? "usuario" :
        usuarios.has("nome_usuario") ? "nome_usuario" :
        usuarios.has("nome") ? "nome" :
        null;

    const colunaNomeLocalidade =
        localidades.has("localidade") ? "localidade" :
        localidades.has("nome") ? "nome" :
        localidades.has("descricao") ? "descricao" :
        null;

    if (!colunaNomeUsuario) {
        throw new Error("Não foi encontrada uma coluna de nome na tabela usuarios.");
    }

    if (!colunaNomeLocalidade) {
        throw new Error("Não foi encontrada uma coluna de nome na tabela localidades.");
    }

    estruturaCache = {
        colunaNomeUsuario,
        colunaNomeLocalidade,
        usuariosTemAtivo: usuarios.has("ativo"),
        usuariosTemStatus: usuarios.has("status"),
        localidadesTemEmpresaId: localidades.has("empresa_id")
    };

    return estruturaCache;
}

async function contextoUsuario(req) {
    const usuarioId =
        req.session?.usuario?.id ||
        req.session?.usuario_id ||
        req.usuario?.id ||
        req.headers["x-usuario-id"];

    if (!usuarioId) {
        const erro = new Error("Usuário não autenticado.");
        erro.status = 401;
        throw erro;
    }

    const estrutura = await obterEstruturaBanco();

    const [rows] = await db.query(
        `SELECT id, empresa_id, \`${estrutura.colunaNomeUsuario}\` AS nome
           FROM usuarios
          WHERE id = ?
          LIMIT 1`,
        [usuarioId]
    );

    if (!rows.length || !rows[0].empresa_id) {
        const erro = new Error("Empresa do usuário não encontrada.");
        erro.status = 403;
        throw erro;
    }

    return rows[0];
}

function tratarErro(res, erro) {
    console.error("=================================");
    console.error("ERRO COMPLETO DO CRM");
    console.error("Mensagem:", erro.message);
    console.error("Código:", erro.code);
    console.error("SQL:", erro.sql);
    console.error("SQL Message:", erro.sqlMessage);
    console.error("Stack:", erro.stack);
    console.error("=================================");

    res.status(erro.status || 500).json({
        erro: erro.message || "Erro interno no CRM.",
        codigo: erro.code || null,
        sqlMessage: erro.sqlMessage || null
    });
}

function periodoSql(periodo, campo = "c.criado_em") {
    switch (periodo) {
        case "hoje": return ` AND DATE(${campo}) = CURDATE() `;
        case "7dias": return ` AND ${campo} >= DATE_SUB(NOW(), INTERVAL 7 DAY) `;
        case "30dias": return ` AND ${campo} >= DATE_SUB(NOW(), INTERVAL 30 DAY) `;
        default: return "";
    }
}

router.get("/localidades", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const estrutura = await obterEstruturaBanco();

        const filtroEmpresa = estrutura.localidadesTemEmpresaId
            ? " WHERE empresa_id = ? "
            : "";

        const params = estrutura.localidadesTemEmpresaId
            ? [usuario.empresa_id]
            : [];

        const [rows] = await db.query(
            `SELECT id, \`${estrutura.colunaNomeLocalidade}\` AS nome
               FROM localidades
               ${filtroEmpresa}
              ORDER BY \`${estrutura.colunaNomeLocalidade}\``,
            params
        );

        res.json({ localidades: rows });
    } catch (erro) { tratarErro(res, erro); }
});

router.get("/responsaveis", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const estrutura = await obterEstruturaBanco();

        let filtroAtivo = "";
        if (estrutura.usuariosTemAtivo) {
            filtroAtivo = " AND ativo = 1 ";
        } else if (estrutura.usuariosTemStatus) {
            filtroAtivo = " AND (status IS NULL OR LOWER(status) NOT IN ('inativo','bloqueado')) ";
        }

        const [rows] = await db.query(
            `SELECT id, \`${estrutura.colunaNomeUsuario}\` AS nome
               FROM usuarios
              WHERE empresa_id = ?
              ${filtroAtivo}
              ORDER BY \`${estrutura.colunaNomeUsuario}\``,
            [usuario.empresa_id]
        );

        res.json({ responsaveis: rows });
    } catch (erro) { tratarErro(res, erro); }
});

router.get("/leads", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const { busca, localidade_id, responsavel_id, origem, prioridade, periodo } = req.query;

        const estrutura = await obterEstruturaBanco();

        let sql = `
            SELECT
                c.id, c.nome, c.telefone, c.telefone2, c.endereco, c.referencia,
                c.localidade_id, l.\`${estrutura.colunaNomeLocalidade}\` AS localidade_nome,
                c.origem, c.responsavel_id,
                u.\`${estrutura.colunaNomeUsuario}\` AS responsavel_nome,
                c.interesse, c.valor_estimado, c.etapa, c.prioridade,
                c.proximo_retorno, c.motivo_perda, c.observacoes,
                c.viabilidade_id, c.ordem_servico_id,
                c.criado_em, c.atualizado_em
            FROM crm_leads c
            LEFT JOIN localidades l
                   ON l.id = c.localidade_id
                  ${estrutura.localidadesTemEmpresaId ? "AND l.empresa_id = c.empresa_id" : ""}
            LEFT JOIN usuarios u
                   ON u.id = c.responsavel_id
                  AND u.empresa_id = c.empresa_id
            WHERE c.empresa_id = ?
        `;
        const params = [usuario.empresa_id];

        if (busca) {
            sql += ` AND (
                c.nome LIKE ? OR c.telefone LIKE ? OR c.telefone2 LIKE ?
                OR c.endereco LIKE ? OR c.interesse LIKE ?
            )`;
            const termo = `%${busca}%`;
            params.push(termo, termo, termo, termo, termo);
        }
        if (localidade_id) { sql += " AND c.localidade_id = ?"; params.push(localidade_id); }
        if (responsavel_id) { sql += " AND c.responsavel_id = ?"; params.push(responsavel_id); }
        if (origem) { sql += " AND c.origem = ?"; params.push(origem); }
        if (prioridade) { sql += " AND c.prioridade = ?"; params.push(prioridade); }

        sql += periodoSql(periodo);
        sql += ` ORDER BY
            FIELD(c.etapa,'novo','atendimento','viabilidade','proposta','instalacao','convertido','perdido'),
            c.prioridade = 'alta' DESC,
            COALESCE(c.proximo_retorno, '9999-12-31') ASC,
            c.criado_em DESC`;

        const [rows] = await db.query(sql, params);
        res.json({ leads: rows });
    } catch (erro) { tratarErro(res, erro); }
});

router.get("/estatisticas", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const periodo = req.query.periodo;
        const filtroPeriodo = periodoSql(periodo);

        const [rows] = await db.query(`
            SELECT
                COUNT(*) AS total,
                SUM(DATE(c.proximo_retorno) = CURDATE()
                    AND c.etapa NOT IN ('convertido','perdido')) AS retornos_hoje,
                SUM(c.etapa = 'convertido'
                    AND YEAR(c.convertido_em) = YEAR(CURDATE())
                    AND MONTH(c.convertido_em) = MONTH(CURDATE())) AS convertidos_mes,
                ROUND(
                    100 * SUM(c.etapa = 'convertido') /
                    NULLIF(SUM(c.etapa IN ('convertido','perdido')), 0),
                    1
                ) AS taxa_conversao
            FROM crm_leads c
            WHERE c.empresa_id = ?
            ${filtroPeriodo}
        `, [usuario.empresa_id]);

        res.json({
            total: Number(rows[0].total || 0),
            retornos_hoje: Number(rows[0].retornos_hoje || 0),
            convertidos_mes: Number(rows[0].convertidos_mes || 0),
            taxa_conversao: Number(rows[0].taxa_conversao || 0)
        });
    } catch (erro) { tratarErro(res, erro); }
});

router.post("/leads", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const b = req.body || {};

        if (!b.nome?.trim() || !b.telefone?.trim()) {
            return res.status(400).json({ erro: "Nome e telefone são obrigatórios." });
        }

        const [result] = await db.query(`
            INSERT INTO crm_leads (
                empresa_id, nome, telefone, telefone2, endereco, referencia,
                localidade_id, origem, responsavel_id, interesse, valor_estimado,
                etapa, prioridade, proximo_retorno, motivo_perda, observacoes,
                criado_por, atualizado_por, convertido_em
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
            usuario.empresa_id, b.nome.trim(), b.telefone.trim(), b.telefone2 || null,
            b.endereco || null, b.referencia || null, b.localidade_id || null,
            b.origem || "Outro", b.responsavel_id || usuario.id, b.interesse || null,
            Number(b.valor_estimado || 0), b.etapa || "novo", b.prioridade || "media",
            b.proximo_retorno || null, b.motivo_perda || null, b.observacoes || null,
            usuario.id, usuario.id, b.etapa === "convertido" ? new Date() : null
        ]);

        await db.query(`
            INSERT INTO crm_interacoes
                (empresa_id, lead_id, usuario_id, tipo, descricao)
            VALUES (?, ?, ?, 'cadastro', 'Lead cadastrado no CRM')
        `, [usuario.empresa_id, result.insertId, usuario.id]);

        res.status(201).json({ ok: true, id: result.insertId });
    } catch (erro) { tratarErro(res, erro); }
});

router.put("/leads/:id", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const b = req.body || {};

        const [atual] = await db.query(
            `SELECT id, etapa FROM crm_leads WHERE id = ? AND empresa_id = ? LIMIT 1`,
            [req.params.id, usuario.empresa_id]
        );
        if (!atual.length) return res.status(404).json({ erro: "Lead não encontrado." });

        const convertidoEm =
            b.etapa === "convertido" && atual[0].etapa !== "convertido"
                ? new Date()
                : null;

        await db.query(`
            UPDATE crm_leads SET
                nome=?, telefone=?, telefone2=?, endereco=?, referencia=?,
                localidade_id=?, origem=?, responsavel_id=?, interesse=?,
                valor_estimado=?, etapa=?, prioridade=?, proximo_retorno=?,
                motivo_perda=?, observacoes=?, atualizado_por=?,
                convertido_em = CASE
                    WHEN ? IS NOT NULL THEN ?
                    WHEN ? <> 'convertido' THEN NULL
                    ELSE convertido_em
                END
            WHERE id=? AND empresa_id=?
        `, [
            b.nome, b.telefone, b.telefone2 || null, b.endereco || null,
            b.referencia || null, b.localidade_id || null, b.origem || "Outro",
            b.responsavel_id || null, b.interesse || null, Number(b.valor_estimado || 0),
            b.etapa || "novo", b.prioridade || "media", b.proximo_retorno || null,
            b.motivo_perda || null, b.observacoes || null, usuario.id,
            convertidoEm, convertidoEm, b.etapa || "novo",
            req.params.id, usuario.empresa_id
        ]);

        if (atual[0].etapa !== b.etapa) {
            await db.query(`
                INSERT INTO crm_interacoes
                    (empresa_id, lead_id, usuario_id, tipo, descricao)
                VALUES (?, ?, ?, 'mudanca_etapa', ?)
            `, [
                usuario.empresa_id, req.params.id, usuario.id,
                `Etapa alterada de ${atual[0].etapa} para ${b.etapa}`
            ]);
        }

        res.json({ ok: true });
    } catch (erro) { tratarErro(res, erro); }
});

router.delete("/leads/:id", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const [result] = await db.query(
            `DELETE FROM crm_leads WHERE id = ? AND empresa_id = ?`,
            [req.params.id, usuario.empresa_id]
        );
        if (!result.affectedRows) return res.status(404).json({ erro: "Lead não encontrado." });
        res.json({ ok: true });
    } catch (erro) { tratarErro(res, erro); }
});

module.exports = router;
