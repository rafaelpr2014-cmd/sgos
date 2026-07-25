const express = require("express");
const router = express.Router();
const db = require("../database");

/*
 * CRM OPERACIONAL SGOS
 * Fluxo:
 * nova_solicitacao -> triagem -> viabilidade -> aguardando_agendamento
 * -> os_execucao -> pos_atendimento -> concluido
 * Etapa alternativa: cancelado
 *
 * Segurança:
 * - empresa_id nunca é recebido do front-end;
 * - todas as operações usam a empresa do usuário autenticado.
 */

const ETAPAS = [
    "nova_solicitacao",
    "triagem",
    "viabilidade",
    "aguardando_agendamento",
    "os_execucao",
    "pos_atendimento",
    "concluido",
    "cancelado"
];

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
        usuarios.has("nome") ? "nome" : null;

    const colunaNomeLocalidade =
        localidades.has("localidade") ? "localidade" :
        localidades.has("nome") ? "nome" :
        localidades.has("descricao") ? "descricao" : null;

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
    console.error("ERRO COMPLETO DO CRM OPERACIONAL");
    console.error("Mensagem:", erro.message);
    console.error("Código:", erro.code);
    console.error("SQL:", erro.sql);
    console.error("SQL Message:", erro.sqlMessage);
    console.error("Stack:", erro.stack);
    console.error("=================================");

    res.status(erro.status || 500).json({
        erro: erro.message || "Erro interno no CRM Operacional.",
        codigo: erro.code || null,
        sqlMessage: erro.sqlMessage || null
    });
}

function validarEtapa(etapa) {
    return ETAPAS.includes(etapa) ? etapa : "nova_solicitacao";
}

function periodoSql(periodo, campo = "c.criado_em") {
    switch (periodo) {
        case "hoje": return ` AND DATE(${campo}) = CURDATE() `;
        case "ontem": return ` AND DATE(${campo}) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) `;
        case "7dias": return ` AND ${campo} >= DATE_SUB(NOW(), INTERVAL 7 DAY) `;
        case "30dias": return ` AND ${campo} >= DATE_SUB(NOW(), INTERVAL 30 DAY) `;
        default: return "";
    }
}

router.get("/localidades", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const estrutura = await obterEstruturaBanco();
        const filtro = estrutura.localidadesTemEmpresaId ? " WHERE empresa_id = ? " : "";
        const params = estrutura.localidadesTemEmpresaId ? [usuario.empresa_id] : [];

        const [rows] = await db.query(
            `SELECT id, \`${estrutura.colunaNomeLocalidade}\` AS nome
               FROM localidades
               ${filtro}
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

/* Mantido como /leads para compatibilidade com a instalação já feita. */
router.get("/leads", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const {
            busca, localidade_id, responsavel_id, origem,
            prioridade, periodo, etapa
        } = req.query;

        const estrutura = await obterEstruturaBanco();

        let sql = `
            SELECT
                c.id, c.nome, c.telefone, c.telefone2, c.endereco, c.referencia,
                c.localidade_id,
                l.\`${estrutura.colunaNomeLocalidade}\` AS localidade_nome,
                c.origem AS canal,
                c.origem,
                c.responsavel_id,
                u.\`${estrutura.colunaNomeUsuario}\` AS responsavel_nome,
                c.interesse AS servico_solicitado,
                c.interesse,
                c.etapa, c.prioridade,
                c.proximo_retorno,
                c.motivo_perda AS motivo_cancelamento,
                c.motivo_perda,
                c.observacoes,
                c.viabilidade_id,
                c.ordem_servico_id,
                c.agendamento_id,
                c.criado_em, c.atualizado_em,
                c.convertido_em AS concluido_em
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
                OR CAST(c.ordem_servico_id AS CHAR) LIKE ?
                OR CAST(c.viabilidade_id AS CHAR) LIKE ?
            )`;
            const termo = `%${busca}%`;
            params.push(termo, termo, termo, termo, termo, termo, termo);
        }
        if (localidade_id) { sql += " AND c.localidade_id = ?"; params.push(localidade_id); }
        if (responsavel_id) { sql += " AND c.responsavel_id = ?"; params.push(responsavel_id); }
        if (origem) { sql += " AND c.origem = ?"; params.push(origem); }
        if (prioridade) { sql += " AND c.prioridade = ?"; params.push(prioridade); }
        if (etapa) { sql += " AND c.etapa = ?"; params.push(etapa); }

        sql += periodoSql(periodo);
        sql += ` ORDER BY
            FIELD(c.etapa,
                'nova_solicitacao','triagem','viabilidade','aguardando_agendamento',
                'os_execucao','pos_atendimento','concluido','cancelado'
            ),
            FIELD(c.prioridade,'urgente','alta','media','baixa'),
            COALESCE(c.proximo_retorno, '9999-12-31 23:59:59'),
            c.criado_em DESC`;

        const [rows] = await db.query(sql, params);
        res.json({ leads: rows, solicitacoes: rows });
    } catch (erro) { tratarErro(res, erro); }
});

router.get("/estatisticas", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const filtroPeriodo = periodoSql(req.query.periodo);

        const [rows] = await db.query(`
            SELECT
                SUM(c.etapa NOT IN ('concluido','cancelado')) AS solicitacoes_abertas,
                SUM(DATE(c.proximo_retorno) = CURDATE()
                    AND c.etapa NOT IN ('concluido','cancelado')) AS lembretes_hoje,
                SUM(c.etapa = 'aguardando_agendamento') AS aguardando_agendamento,
                SUM(c.etapa = 'os_execucao') AS os_execucao,
                SUM(c.etapa = 'concluido'
                    AND YEAR(COALESCE(c.convertido_em,c.atualizado_em)) = YEAR(CURDATE())
                    AND MONTH(COALESCE(c.convertido_em,c.atualizado_em)) = MONTH(CURDATE())
                ) AS concluidos_mes,
                SUM(c.proximo_retorno < NOW()
                    AND c.etapa NOT IN ('concluido','cancelado')) AS pendencias_atrasadas
            FROM crm_leads c
            WHERE c.empresa_id = ?
            ${filtroPeriodo}
        `, [usuario.empresa_id]);

        const r = rows[0] || {};
        res.json({
            solicitacoes_abertas: Number(r.solicitacoes_abertas || 0),
            lembretes_hoje: Number(r.lembretes_hoje || 0),
            aguardando_agendamento: Number(r.aguardando_agendamento || 0),
            os_execucao: Number(r.os_execucao || 0),
            concluidos_mes: Number(r.concluidos_mes || 0),
            pendencias_atrasadas: Number(r.pendencias_atrasadas || 0)
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

        const etapa = validarEtapa(b.etapa);
        const concluidoEm = etapa === "concluido" ? new Date() : null;

        const [result] = await db.query(`
            INSERT INTO crm_leads (
                empresa_id, nome, telefone, telefone2, endereco, referencia,
                localidade_id, origem, responsavel_id, interesse, valor_estimado,
                etapa, prioridade, proximo_retorno, motivo_perda, observacoes,
                viabilidade_id, ordem_servico_id, agendamento_id,
                criado_por, atualizado_por, convertido_em
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
            usuario.empresa_id,
            b.nome.trim(),
            b.telefone.trim(),
            b.telefone2 || null,
            b.endereco || null,
            b.referencia || null,
            b.localidade_id || null,
            b.canal || b.origem || "Outro",
            b.responsavel_id || usuario.id,
            b.servico_solicitado || b.interesse || null,
            0,
            etapa,
            b.prioridade || "media",
            b.proximo_retorno || null,
            b.motivo_cancelamento || b.motivo_perda || null,
            b.observacoes || null,
            b.viabilidade_id || null,
            b.ordem_servico_id || null,
            b.agendamento_id || null,
            usuario.id,
            usuario.id,
            concluidoEm
        ]);

        await db.query(`
            INSERT INTO crm_interacoes
                (empresa_id, lead_id, usuario_id, tipo, descricao)
            VALUES (?, ?, ?, 'cadastro', 'Solicitação cadastrada no CRM Operacional')
        `, [usuario.empresa_id, result.insertId, usuario.id]);

        res.status(201).json({ ok: true, id: result.insertId });
    } catch (erro) { tratarErro(res, erro); }
});

router.put("/leads/:id", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const b = req.body || {};

        const [atual] = await db.query(
            `SELECT id, etapa
               FROM crm_leads
              WHERE id = ? AND empresa_id = ?
              LIMIT 1`,
            [req.params.id, usuario.empresa_id]
        );
        if (!atual.length) {
            return res.status(404).json({ erro: "Solicitação não encontrada." });
        }

        const etapa = validarEtapa(b.etapa);
        const concluidoAgora =
            etapa === "concluido" && atual[0].etapa !== "concluido"
                ? new Date() : null;

        await db.query(`
            UPDATE crm_leads SET
                nome=?, telefone=?, telefone2=?, endereco=?, referencia=?,
                localidade_id=?, origem=?, responsavel_id=?, interesse=?,
                etapa=?, prioridade=?, proximo_retorno=?, motivo_perda=?,
                observacoes=?, viabilidade_id=?, ordem_servico_id=?,
                agendamento_id=?, atualizado_por=?,
                convertido_em = CASE
                    WHEN ? IS NOT NULL THEN ?
                    WHEN ? <> 'concluido' THEN NULL
                    ELSE convertido_em
                END
            WHERE id=? AND empresa_id=?
        `, [
            b.nome,
            b.telefone,
            b.telefone2 || null,
            b.endereco || null,
            b.referencia || null,
            b.localidade_id || null,
            b.canal || b.origem || "Outro",
            b.responsavel_id || null,
            b.servico_solicitado || b.interesse || null,
            etapa,
            b.prioridade || "media",
            b.proximo_retorno || null,
            b.motivo_cancelamento || b.motivo_perda || null,
            b.observacoes || null,
            b.viabilidade_id || null,
            b.ordem_servico_id || null,
            b.agendamento_id || null,
            usuario.id,
            concluidoAgora, concluidoAgora, etapa,
            req.params.id, usuario.empresa_id
        ]);

        if (atual[0].etapa !== etapa) {
            await db.query(`
                INSERT INTO crm_interacoes
                    (empresa_id, lead_id, usuario_id, tipo, descricao)
                VALUES (?, ?, ?, 'mudanca_etapa', ?)
            `, [
                usuario.empresa_id,
                req.params.id,
                usuario.id,
                `Etapa alterada de ${atual[0].etapa} para ${etapa}`
            ]);
        }

        res.json({ ok: true });
    } catch (erro) { tratarErro(res, erro); }
});

router.patch("/leads/:id/etapa", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const etapa = validarEtapa(req.body?.etapa);

        const [atual] = await db.query(
            `SELECT etapa FROM crm_leads WHERE id=? AND empresa_id=? LIMIT 1`,
            [req.params.id, usuario.empresa_id]
        );
        if (!atual.length) {
            return res.status(404).json({ erro: "Solicitação não encontrada." });
        }

        await db.query(`
            UPDATE crm_leads
               SET etapa=?,
                   atualizado_por=?,
                   convertido_em=CASE
                       WHEN ?='concluido' THEN COALESCE(convertido_em,NOW())
                       ELSE NULL
                   END
             WHERE id=? AND empresa_id=?
        `, [etapa, usuario.id, etapa, req.params.id, usuario.empresa_id]);

        await db.query(`
            INSERT INTO crm_interacoes
                (empresa_id, lead_id, usuario_id, tipo, descricao)
            VALUES (?, ?, ?, 'mudanca_etapa', ?)
        `, [
            usuario.empresa_id,
            req.params.id,
            usuario.id,
            `Etapa alterada de ${atual[0].etapa} para ${etapa}`
        ]);

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
        if (!result.affectedRows) {
            return res.status(404).json({ erro: "Solicitação não encontrada." });
        }
        res.json({ ok: true });
    } catch (erro) { tratarErro(res, erro); }
});

module.exports = router;
