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

/* =========================================================
 * CENTRAL OPERACIONAL — LEITURA ADAPTATIVA DOS MÓDULOS SGOS
 * Detecta tabelas e colunas existentes sem quebrar módulos ausentes.
 * ========================================================= */

let mapaBancoCache = null;

function idSeguro(nome) {
    if (!/^[A-Za-z0-9_]+$/.test(String(nome || ""))) {
        throw new Error("Identificador SQL inválido.");
    }
    return `\`${nome}\``;
}

async function obterMapaBanco() {
    if (mapaBancoCache) return mapaBancoCache;

    const [tabelasRaw] = await db.query("SHOW TABLES");
    const tabelas = tabelasRaw.map(r => Object.values(r)[0]);
    const colunas = {};

    async function cols(tabela) {
        if (!tabela) return new Set();
        if (!colunas[tabela]) {
            const [rows] = await db.query(`SHOW COLUMNS FROM ${idSeguro(tabela)}`);
            colunas[tabela] = new Set(rows.map(r => r.Field));
        }
        return colunas[tabela];
    }

    function tabelaExata(...nomes) {
        return nomes.find(n => tabelas.includes(n)) || null;
    }

    function tabelaPorPalavras(...palavras) {
        return tabelas.find(t => palavras.every(p => t.toLowerCase().includes(p.toLowerCase()))) || null;
    }

    mapaBancoCache = { tabelas, cols, tabelaExata, tabelaPorPalavras };
    return mapaBancoCache;
}

function primeiraColuna(colunas, candidatas) {
    return candidatas.find(c => colunas.has(c)) || null;
}

function sqlEmpresa(colunas, alias = "") {
    const prefixo = alias ? `${alias}.` : "";
    return colunas.has("empresa_id") ? `${prefixo}empresa_id = ?` : "1=1";
}

function paramsEmpresa(colunas, empresaId) {
    return colunas.has("empresa_id") ? [empresaId] : [];
}

function expressaoNome(colunas, alias = "") {
    const c = primeiraColuna(colunas, [
        "nome", "cliente", "cliente_nome", "nome_cliente", "titulo",
        "descricao", "usuario", "razao_social"
    ]);
    return c ? `${alias ? alias + "." : ""}${idSeguro(c)}` : "NULL";
}

function expressaoData(colunas, alias = "") {
    const c = primeiraColuna(colunas, [
        "atualizado_em", "updated_at", "criado_em", "created_at",
        "registrado_em", "data_cadastro", "data", "agendado_para",
        "data_agendamento", "finalizado_em", "enviado_em"
    ]);
    return c ? `${alias ? alias + "." : ""}${idSeguro(c)}` : "NULL";
}

function expressaoStatus(colunas, alias = "") {
    const c = primeiraColuna(colunas, [
        "status", "situacao", "estado", "etapa", "status_instalacao",
        "status_pagamento"
    ]);
    return c ? `${alias ? alias + "." : ""}${idSeguro(c)}` : "NULL";
}

async function consultaSegura(fn, fallback) {
    try {
        return await fn();
    } catch (erro) {
        console.error("CRM Central - módulo ignorado:", erro.message);
        return fallback;
    }
}

async function contarTabela(tabela, colunas, empresaId, condicao = "1=1", paramsExtras = []) {
    if (!tabela) return 0;
    const filtroEmpresa = sqlEmpresa(colunas);
    const params = [...paramsEmpresa(colunas, empresaId), ...paramsExtras];
    const [rows] = await db.query(
        `SELECT COUNT(*) AS total
           FROM ${idSeguro(tabela)}
          WHERE ${filtroEmpresa}
            AND (${condicao})`,
        params
    );
    return Number(rows[0]?.total || 0);
}

async function listarModulo(tabela, colunas, empresaId, opcoes = {}) {
    if (!tabela) return [];

    const nome = expressaoNome(colunas);
    const data = expressaoData(colunas);
    const status = expressaoStatus(colunas);
    const idCol = colunas.has("id") ? "id" : "NULL";
    const telefoneCol = primeiraColuna(colunas, ["telefone", "telefone1", "celular", "contato"]);
    const osCol = primeiraColuna(colunas, ["ordem_servico_id", "os_id", "id_os"]);
    const localCol = primeiraColuna(colunas, ["localidade", "localidade_nome", "endereco", "bairro"]);
    const filtroEmpresa = sqlEmpresa(colunas);
    const condicao = opcoes.condicao || "1=1";
    const params = [...paramsEmpresa(colunas, empresaId), ...(opcoes.params || [])];
    const limite = Math.max(1, Math.min(Number(opcoes.limite || 8), 30));

    const [rows] = await db.query(`
        SELECT
            ${idCol} AS id,
            ${nome} AS nome,
            ${status} AS status,
            ${data} AS data,
            ${telefoneCol ? idSeguro(telefoneCol) : "NULL"} AS telefone,
            ${osCol ? idSeguro(osCol) : "NULL"} AS ordem_servico_id,
            ${localCol ? idSeguro(localCol) : "NULL"} AS detalhe
        FROM ${idSeguro(tabela)}
        WHERE ${filtroEmpresa}
          AND (${condicao})
        ORDER BY ${data === "NULL" ? idCol : data} DESC
        LIMIT ${limite}
    `, params);

    return rows;
}

router.get("/central", async (req, res) => {
    try {
        const usuario = await contextoUsuario(req);
        const empresaId = Number(usuario.empresa_id);
        const mapa = await obterMapaBanco();
        const { tabelas, cols, tabelaExata, tabelaPorPalavras } = mapa;

        const existe = nome => tabelas.includes(nome);
        const tabelaViabilidade =
            tabelaExata("viabilidade", "viabilidades") ||
            tabelaPorPalavras("viabil");

        const tabelaAgendamentos =
            tabelaExata("agendamentos", "ordens_agendadas") ||
            tabelaPorPalavras("agend");

        const tabelaRelatorios =
            tabelaExata(
                "relatorios_automaticos_logs",
                "relatorios_envios",
                "logs_relatorios",
                "relatorios_automaticos"
            ) || tabelaPorPalavras("relatorio");

        const tabelaWhatsapp =
            tabelaExata(
                "whatsapp_fila",
                "whatsapp_mensagens",
                "mensagens_whatsapp",
                "whatsapp_envios"
            ) || tabelaPorPalavras("whatsapp");

        const cVia = tabelaViabilidade ? await cols(tabelaViabilidade) : new Set();
        const cAgenda = tabelaAgendamentos ? await cols(tabelaAgendamentos) : new Set();
        const cRel = tabelaRelatorios ? await cols(tabelaRelatorios) : new Set();
        const cWhats = tabelaWhatsapp ? await cols(tabelaWhatsapp) : new Set();

        /* =========================
         * SOLICITAÇÕES DO CRM
         * ========================= */
        const [[solicitacoesResumo]] = await db.query(`
            SELECT
                SUM(etapa NOT IN ('concluido','cancelado')) AS abertas,
                SUM(
                    proximo_retorno IS NOT NULL
                    AND DATE(proximo_retorno)=CURDATE()
                    AND etapa NOT IN ('concluido','cancelado')
                ) AS lembretes_hoje,
                SUM(
                    proximo_retorno IS NOT NULL
                    AND proximo_retorno < NOW()
                    AND etapa NOT IN ('concluido','cancelado')
                ) AS atrasadas
            FROM crm_leads
            WHERE empresa_id=?
        `, [empresaId]);

        const [listaSolicitacoes] = await db.query(`
            SELECT id,nome,telefone,etapa AS status,proximo_retorno AS data,
                   endereco AS detalhe,NULL AS ordem_servico_id
            FROM crm_leads
            WHERE empresa_id=?
              AND etapa NOT IN ('concluido','cancelado')
            ORDER BY COALESCE(proximo_retorno,'9999-12-31 23:59:59'),criado_em DESC
            LIMIT 8
        `, [empresaId]);

        /* =========================
         * VIABILIDADES REAIS
         * ========================= */
        let viabilidades = 0;
        let listaViabilidades = [];

        if (tabelaViabilidade) {
            const statusVia = primeiraColuna(cVia, ["status", "situacao"]);
            const statusInstalacao = primeiraColuna(
                cVia,
                ["status_instalacao", "instalacao_status", "instalacao"]
            );
            const nomeVia = primeiraColuna(cVia, ["nome", "cliente", "nome_cliente"]);
            const telefoneVia = primeiraColuna(cVia, ["telefone", "celular"]);
            const detalheVia = primeiraColuna(cVia, ["endereco", "localidade", "referencia"]);
            const dataVia = primeiraColuna(
                cVia,
                ["atualizado_em", "registrado_em", "criado_em", "created_at"]
            );

            const filtrosVia = [];
            const paramsVia = [];

            if (cVia.has("empresa_id")) {
                filtrosVia.push("empresa_id=?");
                paramsVia.push(empresaId);
            }

            if (statusVia) {
                filtrosVia.push(
                    `UPPER(COALESCE(${idSeguro(statusVia)},'PENDENTE')) <> 'REPROVADA'`
                );
            }

            if (statusInstalacao) {
                filtrosVia.push(
                    `UPPER(COALESCE(${idSeguro(statusInstalacao)},'PENDENTE')) NOT IN ('INSTALADO','REALIZADA','CONCLUIDA')`
                );
            }

            const whereVia = filtrosVia.length ? filtrosVia.join(" AND ") : "1=1";

            const [[rVia]] = await db.query(
                `SELECT COUNT(*) AS total
                   FROM ${idSeguro(tabelaViabilidade)}
                  WHERE ${whereVia}`,
                paramsVia
            );
            viabilidades = Number(rVia?.total || 0);

            [listaViabilidades] = await db.query(`
                SELECT
                    ${cVia.has("id") ? "id" : "NULL"} AS id,
                    ${nomeVia ? idSeguro(nomeVia) : "'Viabilidade'"} AS nome,
                    ${telefoneVia ? idSeguro(telefoneVia) : "NULL"} AS telefone,
                    ${statusVia ? idSeguro(statusVia) : "'PENDENTE'"} AS status,
                    ${dataVia ? idSeguro(dataVia) : "NULL"} AS data,
                    ${detalheVia ? idSeguro(detalheVia) : "NULL"} AS detalhe,
                    NULL AS ordem_servico_id
                FROM ${idSeguro(tabelaViabilidade)}
                WHERE ${whereVia}
                ORDER BY ${dataVia ? idSeguro(dataVia) : (cVia.has("id") ? "id" : "1")} DESC
                LIMIT 8
            `, paramsVia);
        }

        /* =========================
         * ORDENS DE SERVIÇO
         * ========================= */
        const statusOSAtiva = `
            LOWER(REPLACE(COALESCE(status,''),'_',' ')) IN
            ('aberto','aberta','agendado','agendada','em andamento','em execução','execucao','cliente ausente')
        `;

        const statusOSEmCampo = `
            LOWER(REPLACE(COALESCE(status,''),'_',' ')) IN
            ('em andamento','em execução','execucao')
        `;

        const [[resumoOS]] = await db.query(`
            SELECT
                SUM(${statusOSAtiva}) AS ativas,
                SUM(
                    LOWER(REPLACE(COALESCE(status,''),'_',' ')) IN
                    ('concluido','concluida','finalizado','finalizada')
                    AND YEAR(COALESCE(finalizado_em,atualizado_em,criado_em))=YEAR(CURDATE())
                    AND MONTH(COALESCE(finalizado_em,atualizado_em,criado_em))=MONTH(CURDATE())
                ) AS finalizadas_mes,
                SUM(
                    ${statusOSAtiva}
                    AND COALESCE(agendamento,data_abertura,criado_em) < DATE_SUB(NOW(),INTERVAL 2 DAY)
                ) AS atrasadas
            FROM ordens_servico
            WHERE empresa_id=?
        `, [empresaId]);

        const [listaOrdens] = await db.query(`
            SELECT
                id,nome,telefone,status,
                COALESCE(atualizado_em,iniciado_em,agendamento,data_abertura,criado_em) AS data,
                CONCAT(
                    COALESCE(endereco,rua,''),
                    CASE WHEN numero IS NOT NULL AND numero<>'' THEN CONCAT(', ',numero) ELSE '' END
                ) AS detalhe,
                id AS ordem_servico_id
            FROM ordens_servico
            WHERE empresa_id=?
              AND ${statusOSAtiva}
            ORDER BY COALESCE(atualizado_em,iniciado_em,agendamento,data_abertura,criado_em) DESC
            LIMIT 8
        `, [empresaId]).catch(async () => {
            return db.query(`
                SELECT
                    id,nome,telefone,status,
                    COALESCE(iniciado_em,agendamento,data_abertura,criado_em) AS data,
                    endereco AS detalhe,
                    id AS ordem_servico_id
                FROM ordens_servico
                WHERE empresa_id=?
                  AND ${statusOSAtiva}
                ORDER BY COALESCE(iniciado_em,agendamento,data_abertura,criado_em) DESC
                LIMIT 8
            `, [empresaId]);
        });

        /* Técnicos ficam em ordens_servico.tecnico como JSON ou lista. */
        const [osEmCampo] = await db.query(`
            SELECT tecnico
            FROM ordens_servico
            WHERE empresa_id=?
              AND ${statusOSEmCampo}
              AND tecnico IS NOT NULL
        `, [empresaId]);

        const tecnicosIds = new Set();
        for (const item of osEmCampo) {
            const bruto = item.tecnico;
            let ids = [];

            if (Array.isArray(bruto)) {
                ids = bruto;
            } else if (typeof bruto === "string") {
                const texto = bruto.trim();
                if (texto) {
                    try {
                        const convertido = JSON.parse(texto);
                        ids = Array.isArray(convertido) ? convertido : [convertido];
                    } catch {
                        ids = texto.split(",");
                    }
                }
            } else if (bruto !== null && bruto !== undefined) {
                ids = [bruto];
            }

            for (const id of ids) {
                const numero = Number(String(id).trim());
                if (Number.isInteger(numero) && numero > 0) tecnicosIds.add(numero);
            }
        }
        const tecnicosEmCampo = tecnicosIds.size;

        /* =========================
         * ESTOQUE RESERVADO NAS OS
         * ========================= */
        let estoqueReservado = 0;
        let estoqueCritico = 0;

        if (existe("os_materiais")) {
            const [[rReservado]] = await db.query(`
                SELECT COALESCE(SUM(om.quantidade),0) AS total
                FROM os_materiais om
                JOIN ordens_servico os
                  ON os.id=om.os_id
                 AND os.empresa_id=om.empresa_id
                WHERE om.empresa_id=?
                  AND os.origem_equipamento='empresa'
                  AND ${statusOSAtiva.replaceAll("status", "os.status")}
            `, [empresaId]);
            estoqueReservado = Number(rReservado?.total || 0);
        }

        if (existe("estoque_produtos")) {
            const [[rCritico]] = await db.query(`
                SELECT COUNT(*) AS total
                FROM estoque_produtos
                WHERE empresa_id=?
                  AND ativo=1
                  AND quantidade<=estoque_minimo
            `, [empresaId]);
            estoqueCritico = Number(rCritico?.total || 0);
        }

        /* =========================
         * FINANCEIRO VINCULADO ÀS OS
         * Inclui lançamentos ativos e vendas pendentes que,
         * pela regra do SGOS, ainda não entram no financeiro.
         * ========================= */
        let financeiroQuantidade = 0;
        let financeiroValor = 0;
        let financeiroPendente = 0;

        if (existe("financeiro_movimentacoes")) {
            const [[rFinanceiro]] = await db.query(`
                SELECT
                    COUNT(DISTINCT os_id) AS quantidade,
                    COALESCE(SUM(
                        CASE
                            WHEN LOWER(tipo)='saida' THEN -ABS(valor)
                            ELSE ABS(valor)
                        END
                    ),0) AS valor
                FROM financeiro_movimentacoes
                WHERE empresa_id=?
                  AND ativo=1
                  AND os_id IS NOT NULL
            `, [empresaId]);

            financeiroQuantidade = Number(rFinanceiro?.quantidade || 0);
            financeiroValor = Number(rFinanceiro?.valor || 0);
        }

        const [[rPendentesFinanceiro]] = await db.query(`
            SELECT
                COUNT(*) AS quantidade,
                COALESCE(SUM(total_equipamentos),0) AS valor
            FROM ordens_servico
            WHERE empresa_id=?
              AND origem_equipamento='empresa'
              AND modalidade_equipamento='vendido'
              AND status_pagamento_equipamento='pendente'
              AND equipamentos_utilizados=1
        `, [empresaId]).catch(() => [[{ quantidade: 0, valor: 0 }]]);

        financeiroPendente = Number(rPendentesFinanceiro?.quantidade || 0);
        financeiroQuantidade += financeiroPendente;
        financeiroValor += Number(rPendentesFinanceiro?.valor || 0);

        /* =========================
         * AGENDAMENTOS
         * ========================= */
        let agendamentos = 0;
        let agendamentosAtrasados = 0;
        let listaAgendamentos = [];

        if (tabelaAgendamentos) {
            const statusAgenda = primeiraColuna(cAgenda, ["status", "situacao"]);
            const dataAgenda = primeiraColuna(
                cAgenda,
                ["agendamento", "data_agendamento", "agendado_para", "data", "inicio", "criado_em"]
            );
            const nomeAgenda = primeiraColuna(
                cAgenda,
                ["nome", "cliente", "cliente_nome", "titulo", "descricao"]
            );
            const detalheAgenda = primeiraColuna(
                cAgenda,
                ["endereco", "localidade", "descricao", "referencia"]
            );

            const filtrosAgenda = [];
            const paramsAgenda = [];

            if (cAgenda.has("empresa_id")) {
                filtrosAgenda.push("empresa_id=?");
                paramsAgenda.push(empresaId);
            }
            if (statusAgenda) {
                filtrosAgenda.push(
                    `LOWER(REPLACE(COALESCE(${idSeguro(statusAgenda)},''),'_',' ')) NOT IN ('concluido','finalizado','cancelado','realizado')`
                );
            }

            const whereAgenda = filtrosAgenda.length ? filtrosAgenda.join(" AND ") : "1=1";
            const [[rAgenda]] = await db.query(
                `SELECT COUNT(*) AS total
                   FROM ${idSeguro(tabelaAgendamentos)}
                  WHERE ${whereAgenda}`,
                paramsAgenda
            );
            agendamentos = Number(rAgenda?.total || 0);

            if (dataAgenda) {
                const [[rAgendaAtrasada]] = await db.query(
                    `SELECT COUNT(*) AS total
                       FROM ${idSeguro(tabelaAgendamentos)}
                      WHERE ${whereAgenda}
                        AND ${idSeguro(dataAgenda)} < NOW()`,
                    paramsAgenda
                );
                agendamentosAtrasados = Number(rAgendaAtrasada?.total || 0);
            }

            [listaAgendamentos] = await db.query(`
                SELECT
                    ${cAgenda.has("id") ? "id" : "NULL"} AS id,
                    ${nomeAgenda ? idSeguro(nomeAgenda) : "'Agendamento'"} AS nome,
                    ${statusAgenda ? idSeguro(statusAgenda) : "'PENDENTE'"} AS status,
                    ${dataAgenda ? idSeguro(dataAgenda) : "NULL"} AS data,
                    ${detalheAgenda ? idSeguro(detalheAgenda) : "NULL"} AS detalhe,
                    NULL AS telefone,
                    NULL AS ordem_servico_id
                FROM ${idSeguro(tabelaAgendamentos)}
                WHERE ${whereAgenda}
                ORDER BY ${dataAgenda ? idSeguro(dataAgenda) : (cAgenda.has("id") ? "id" : "1")} ASC
                LIMIT 8
            `, paramsAgenda);
        } else {
            /* No SGOS, muitas OS agendadas ficam na própria ordens_servico. */
            const [[rAgendaOS]] = await db.query(`
                SELECT COUNT(*) AS total
                FROM ordens_servico
                WHERE empresa_id=?
                  AND LOWER(REPLACE(COALESCE(status,''),'_',' '))='agendado'
            `, [empresaId]);
            agendamentos = Number(rAgendaOS?.total || 0);

            const [[rAgendaOSAtrasada]] = await db.query(`
                SELECT COUNT(*) AS total
                FROM ordens_servico
                WHERE empresa_id=?
                  AND LOWER(REPLACE(COALESCE(status,''),'_',' '))='agendado'
                  AND agendamento<NOW()
            `, [empresaId]);
            agendamentosAtrasados = Number(rAgendaOSAtrasada?.total || 0);

            [listaAgendamentos] = await db.query(`
                SELECT id,nome,telefone,status,agendamento AS data,
                       endereco AS detalhe,id AS ordem_servico_id
                FROM ordens_servico
                WHERE empresa_id=?
                  AND LOWER(REPLACE(COALESCE(status,''),'_',' '))='agendado'
                ORDER BY agendamento ASC
                LIMIT 8
            `, [empresaId]);
        }

        /* =========================
         * RELATÓRIOS E WHATSAPP
         * ========================= */
        let relatoriosEnviados = 0;
        let listaRelatorios = [];
        if (tabelaRelatorios) {
            const dataRel = primeiraColuna(
                cRel,
                ["enviado_em", "criado_em", "created_at", "data_envio", "data"]
            );
            const statusRel = primeiraColuna(cRel, ["status", "situacao", "resultado"]);
            const nomeRel = primeiraColuna(cRel, ["nome", "titulo", "tipo", "descricao"]);
            const filtrosRel = [];
            const paramsRel = [];

            if (cRel.has("empresa_id")) {
                filtrosRel.push("empresa_id=?");
                paramsRel.push(empresaId);
            }
            if (statusRel) {
                filtrosRel.push(
                    `LOWER(COALESCE(${idSeguro(statusRel)},'')) NOT IN ('erro','falha','pendente')`
                );
            }
            if (dataRel) {
                filtrosRel.push(
                    `YEAR(${idSeguro(dataRel)})=YEAR(CURDATE()) AND MONTH(${idSeguro(dataRel)})=MONTH(CURDATE())`
                );
            }

            const whereRel = filtrosRel.length ? filtrosRel.join(" AND ") : "1=1";
            const [[rRel]] = await db.query(
                `SELECT COUNT(*) AS total FROM ${idSeguro(tabelaRelatorios)} WHERE ${whereRel}`,
                paramsRel
            );
            relatoriosEnviados = Number(rRel?.total || 0);

            [listaRelatorios] = await db.query(`
                SELECT
                    ${cRel.has("id") ? "id" : "NULL"} AS id,
                    ${nomeRel ? idSeguro(nomeRel) : "'Relatório automático'"} AS nome,
                    ${statusRel ? idSeguro(statusRel) : "'ENVIADO'"} AS status,
                    ${dataRel ? idSeguro(dataRel) : "NULL"} AS data,
                    NULL AS detalhe,NULL AS telefone,NULL AS ordem_servico_id
                FROM ${idSeguro(tabelaRelatorios)}
                WHERE ${whereRel}
                ORDER BY ${dataRel ? idSeguro(dataRel) : (cRel.has("id") ? "id" : "1")} DESC
                LIMIT 6
            `, paramsRel);
        }

        let whatsappPendentes = 0;
        let listaWhatsapp = [];
        if (tabelaWhatsapp) {
            const statusWhats = primeiraColuna(cWhats, ["status", "situacao", "estado"]);
            const dataWhats = primeiraColuna(
                cWhats,
                ["criado_em", "created_at", "enviado_em", "data", "atualizado_em"]
            );
            const nomeWhats = primeiraColuna(
                cWhats,
                ["nome", "destinatario", "telefone", "numero", "descricao"]
            );
            const filtrosWhats = [];
            const paramsWhats = [];

            if (cWhats.has("empresa_id")) {
                filtrosWhats.push("empresa_id=?");
                paramsWhats.push(empresaId);
            }
            if (statusWhats) {
                filtrosWhats.push(
                    `LOWER(COALESCE(${idSeguro(statusWhats)},'')) IN ('pendente','fila','aguardando','erro','falha')`
                );
            }

            const whereWhats = filtrosWhats.length ? filtrosWhats.join(" AND ") : "1=1";
            const [[rWhats]] = await db.query(
                `SELECT COUNT(*) AS total FROM ${idSeguro(tabelaWhatsapp)} WHERE ${whereWhats}`,
                paramsWhats
            );
            whatsappPendentes = Number(rWhats?.total || 0);

            [listaWhatsapp] = await db.query(`
                SELECT
                    ${cWhats.has("id") ? "id" : "NULL"} AS id,
                    ${nomeWhats ? idSeguro(nomeWhats) : "'Mensagem WhatsApp'"} AS nome,
                    ${statusWhats ? idSeguro(statusWhats) : "'PENDENTE'"} AS status,
                    ${dataWhats ? idSeguro(dataWhats) : "NULL"} AS data,
                    NULL AS detalhe,NULL AS telefone,NULL AS ordem_servico_id
                FROM ${idSeguro(tabelaWhatsapp)}
                WHERE ${whereWhats}
                ORDER BY ${dataWhats ? idSeguro(dataWhats) : (cWhats.has("id") ? "id" : "1")} DESC
                LIMIT 6
            `, paramsWhats);
        }

        const pendenciasCriticas =
            Number(resumoOS?.atrasadas || 0) +
            agendamentosAtrasados +
            Number(solicitacoesResumo?.atrasadas || 0) +
            estoqueCritico +
            financeiroPendente +
            whatsappPendentes;

        res.json({
            cards: {
                solicitacoes_clientes: Number(solicitacoesResumo?.abertas || 0),
                viabilidades,
                agendamentos,
                ordens_servico: Number(resumoOS?.ativas || 0),
                tecnicos_em_campo: tecnicosEmCampo,
                estoque_reservado: estoqueReservado,
                financeiro_os_quantidade: financeiroQuantidade,
                financeiro_os_valor: financeiroValor,
                relatorios_enviados: relatoriosEnviados,
                whatsapp_pendentes: whatsappPendentes,
                pendencias_criticas: pendenciasCriticas
            },
            indicadores: {
                os_finalizadas_mes: Number(resumoOS?.finalizadas_mes || 0),
                lembretes_hoje: Number(solicitacoesResumo?.lembretes_hoje || 0),
                os_atrasadas: Number(resumoOS?.atrasadas || 0),
                agendamentos_atrasados: agendamentosAtrasados,
                estoque_critico: estoqueCritico,
                financeiro_pendente: financeiroPendente
            },
            listas: {
                solicitacoes: listaSolicitacoes,
                viabilidades: listaViabilidades,
                agendamentos: listaAgendamentos,
                ordens_servico: listaOrdens,
                relatorios: listaRelatorios,
                whatsapp: listaWhatsapp
            },
            modulos_detectados: {
                solicitacoes: "crm_leads",
                viabilidades: tabelaViabilidade,
                agendamentos: tabelaAgendamentos || "ordens_servico",
                ordens: "ordens_servico",
                tecnicos: "ordens_servico.tecnico",
                estoque_reservado: existe("os_materiais") ? "os_materiais" : null,
                financeiro: existe("financeiro_movimentacoes") ? "financeiro_movimentacoes" : null,
                relatorios: tabelaRelatorios,
                whatsapp: tabelaWhatsapp
            }
        });
    } catch (erro) {
        tratarErro(res, erro);
    }
});

module.exports = router;
