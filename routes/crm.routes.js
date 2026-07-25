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
        const mapa = await obterMapaBanco();
        const { cols, tabelaExata, tabelaPorPalavras } = mapa;
        const empresaId = usuario.empresa_id;

        const tabelas = {
            solicitacoes: tabelaExata("crm_leads", "solicitacoes_clientes", "solicitacoes"),
            viabilidades: tabelaExata("viabilidades", "viabilidade") || tabelaPorPalavras("viabil"),
            agendamentos: tabelaExata("agendamentos", "ordens_agendadas") || tabelaPorPalavras("agend"),
            ordens: tabelaExata("ordens_servico", "ordens_de_servico", "os") || tabelaPorPalavras("ordens", "servico"),
            tecnicos: tabelaExata("tecnicos", "usuarios") || tabelaPorPalavras("tecnic"),
            estoqueProdutos: tabelaExata("estoque_produtos", "produtos_estoque") || tabelaPorPalavras("estoque", "produto"),
            estoqueMov: tabelaExata("estoque_movimentacoes", "movimentacoes_estoque") || tabelaPorPalavras("estoque", "mov"),
            financeiro: tabelaExata("financeiro_lancamentos", "financeiro", "lancamentos_financeiros") || tabelaPorPalavras("financeir"),
            relatorios: tabelaExata("relatorios_envios", "relatorios_automaticos_logs", "logs_relatorios", "relatorios_automaticos") || tabelaPorPalavras("relatorio"),
            whatsapp: tabelaExata("whatsapp_fila", "whatsapp_mensagens", "mensagens_whatsapp", "whatsapp_envios") || tabelaPorPalavras("whatsapp")
        };

        const c = {};
        for (const [k, tabela] of Object.entries(tabelas)) {
            c[k] = tabela ? await cols(tabela) : new Set();
        }

        const statusSolic = primeiraColuna(c.solicitacoes, ["etapa", "status", "situacao"]);
        const statusVia = primeiraColuna(c.viabilidades, ["status", "situacao"]);
        const statusAgenda = primeiraColuna(c.agendamentos, ["status", "situacao"]);
        const statusOS = primeiraColuna(c.ordens, ["status", "situacao"]);
        const dataOS = primeiraColuna(c.ordens, ["finalizado_em", "atualizado_em", "updated_at", "criado_em"]);
        const dataAgenda = primeiraColuna(c.agendamentos, ["data_agendamento", "agendado_para", "data", "inicio", "criado_em"]);
        const retornoSolic = primeiraColuna(c.solicitacoes, ["proximo_retorno", "retorno_em", "lembrete_em"]);
        const statusFinanceiro = primeiraColuna(c.financeiro, ["status_pagamento", "status", "situacao"]);
        const valorFinanceiro = primeiraColuna(c.financeiro, ["valor", "valor_total", "total"]);
        const osFinanceiro = primeiraColuna(c.financeiro, ["ordem_servico_id", "os_id", "id_os"]);
        const statusWhatsapp = primeiraColuna(c.whatsapp, ["status", "situacao", "estado"]);
        const dataRelatorio = primeiraColuna(c.relatorios, ["enviado_em", "criado_em", "created_at", "data_envio", "data"]);
        const statusRelatorio = primeiraColuna(c.relatorios, ["status", "situacao", "resultado"]);
        const qtdEstoque = primeiraColuna(c.estoqueProdutos, ["quantidade", "estoque_atual", "saldo", "qtd"]);
        const minimoEstoque = primeiraColuna(c.estoqueProdutos, ["estoque_minimo", "quantidade_minima", "minimo"]);
        const reservadoEstoque = primeiraColuna(c.estoqueProdutos, ["reservado", "quantidade_reservada", "qtd_reservada"]);
        const statusMov = primeiraColuna(c.estoqueMov, ["status", "tipo", "movimento", "situacao"]);

        const condSolicAberta = statusSolic
            ? `LOWER(${idSeguro(statusSolic)}) NOT IN ('concluido','convertido','cancelado','perdido','finalizado')`
            : "1=1";

        const condViabilidade = statusVia
            ? `LOWER(${idSeguro(statusVia)}) NOT IN ('aprovada','reprovada','finalizada','concluida','instalado')`
            : "1=1";

        const condAgenda = statusAgenda
            ? `LOWER(${idSeguro(statusAgenda)}) NOT IN ('concluido','finalizado','cancelado','realizado')`
            : "1=1";

        const condOSExecucao = statusOS
            ? `LOWER(${idSeguro(statusOS)}) IN ('aberto','aberta','agendado','agendada','em andamento','em_andamento','em execução','em_execucao','execucao')`
            : "1=0";

        const condOSFinalizadaMes = statusOS
            ? `LOWER(${idSeguro(statusOS)}) IN ('finalizado','finalizada','concluido','concluida')
               ${dataOS ? `AND YEAR(${idSeguro(dataOS)})=YEAR(CURDATE()) AND MONTH(${idSeguro(dataOS)})=MONTH(CURDATE())` : ""}`
            : "1=0";

        const solicitacoesAbertas = await consultaSegura(
            () => contarTabela(tabelas.solicitacoes, c.solicitacoes, empresaId, condSolicAberta), 0
        );
        const viabilidadesPendentes = await consultaSegura(
            () => contarTabela(tabelas.viabilidades, c.viabilidades, empresaId, condViabilidade), 0
        );
        const agendamentosPendentes = await consultaSegura(
            () => contarTabela(tabelas.agendamentos, c.agendamentos, empresaId, condAgenda), 0
        );
        const ordensExecucao = await consultaSegura(
            () => contarTabela(tabelas.ordens, c.ordens, empresaId, condOSExecucao), 0
        );
        const ordensFinalizadasMes = await consultaSegura(
            () => contarTabela(tabelas.ordens, c.ordens, empresaId, condOSFinalizadaMes), 0
        );

        const lembretesHoje = retornoSolic ? await consultaSegura(
            () => contarTabela(
                tabelas.solicitacoes, c.solicitacoes, empresaId,
                `DATE(${idSeguro(retornoSolic)})=CURDATE() AND ${condSolicAberta}`
            ), 0
        ) : 0;

        let tecnicosCampo = 0;
        const tecnicoIdOS = primeiraColuna(c.ordens, ["tecnico_id", "tecnico_responsavel_id", "usuario_tecnico_id"]);
        const tecnicosTextoOS = primeiraColuna(c.ordens, ["tecnicos", "tecnicos_ids", "tecnico_responsavel"]);
        if (tabelas.ordens && (tecnicoIdOS || tecnicosTextoOS)) {
            tecnicosCampo = await consultaSegura(async () => {
                const filtroEmpresa = sqlEmpresa(c.ordens);
                const campo = tecnicoIdOS || tecnicosTextoOS;
                const [rows] = await db.query(
                    `SELECT COUNT(DISTINCT ${idSeguro(campo)}) AS total
                       FROM ${idSeguro(tabelas.ordens)}
                      WHERE ${filtroEmpresa}
                        AND (${condOSExecucao})
                        AND ${idSeguro(campo)} IS NOT NULL`,
                    paramsEmpresa(c.ordens, empresaId)
                );
                return Number(rows[0]?.total || 0);
            }, 0);
        }

        let estoqueReservado = 0;
        if (tabelas.estoqueProdutos && reservadoEstoque) {
            estoqueReservado = await consultaSegura(async () => {
                const [rows] = await db.query(
                    `SELECT COALESCE(SUM(${idSeguro(reservadoEstoque)}),0) AS total
                       FROM ${idSeguro(tabelas.estoqueProdutos)}
                      WHERE ${sqlEmpresa(c.estoqueProdutos)}`,
                    paramsEmpresa(c.estoqueProdutos, empresaId)
                );
                return Number(rows[0]?.total || 0);
            }, 0);
        } else if (tabelas.estoqueMov && statusMov) {
            estoqueReservado = await consultaSegura(
                () => contarTabela(
                    tabelas.estoqueMov, c.estoqueMov, empresaId,
                    `LOWER(${idSeguro(statusMov)}) LIKE '%reserv%'`
                ), 0
            );
        }

        let financeiroOS = { quantidade: 0, valor: 0, pendentes: 0 };
        if (tabelas.financeiro && osFinanceiro) {
            financeiroOS = await consultaSegura(async () => {
                const [rows] = await db.query(
                    `SELECT
                        COUNT(*) AS quantidade,
                        ${valorFinanceiro ? `COALESCE(SUM(${idSeguro(valorFinanceiro)}),0)` : "0"} AS valor,
                        ${statusFinanceiro ? `SUM(LOWER(${idSeguro(statusFinanceiro)}) IN ('pendente','aberto','a receber','nao pago','não pago'))` : "0"} AS pendentes
                     FROM ${idSeguro(tabelas.financeiro)}
                    WHERE ${sqlEmpresa(c.financeiro)}
                      AND ${idSeguro(osFinanceiro)} IS NOT NULL`,
                    paramsEmpresa(c.financeiro, empresaId)
                );
                return {
                    quantidade: Number(rows[0]?.quantidade || 0),
                    valor: Number(rows[0]?.valor || 0),
                    pendentes: Number(rows[0]?.pendentes || 0)
                };
            }, { quantidade: 0, valor: 0, pendentes: 0 });
        }

        const relatoriosEnviados = tabelas.relatorios ? await consultaSegura(
            () => contarTabela(
                tabelas.relatorios, c.relatorios, empresaId,
                `${statusRelatorio ? `LOWER(${idSeguro(statusRelatorio)}) NOT IN ('erro','falha','pendente')` : "1=1"}
                 ${dataRelatorio ? `AND YEAR(${idSeguro(dataRelatorio)})=YEAR(CURDATE()) AND MONTH(${idSeguro(dataRelatorio)})=MONTH(CURDATE())` : ""}`
            ), 0
        ) : 0;

        const whatsappPendentes = tabelas.whatsapp ? await consultaSegura(
            () => contarTabela(
                tabelas.whatsapp, c.whatsapp, empresaId,
                statusWhatsapp
                    ? `LOWER(${idSeguro(statusWhatsapp)}) IN ('pendente','fila','aguardando','erro','falha')`
                    : "1=1"
            ), 0
        ) : 0;

        const estoqueCritico = tabelas.estoqueProdutos && qtdEstoque && minimoEstoque
            ? await consultaSegura(
                () => contarTabela(
                    tabelas.estoqueProdutos, c.estoqueProdutos, empresaId,
                    `${idSeguro(qtdEstoque)} <= ${idSeguro(minimoEstoque)}`
                ), 0
            ) : 0;

        const osAtrasadas = tabelas.ordens && dataOS ? await consultaSegura(
            () => contarTabela(
                tabelas.ordens, c.ordens, empresaId,
                `${condOSExecucao} AND ${idSeguro(dataOS)} < DATE_SUB(NOW(), INTERVAL 2 DAY)`
            ), 0
        ) : 0;

        const agendaAtrasada = tabelas.agendamentos && dataAgenda ? await consultaSegura(
            () => contarTabela(
                tabelas.agendamentos, c.agendamentos, empresaId,
                `${condAgenda} AND ${idSeguro(dataAgenda)} < NOW()`
            ), 0
        ) : 0;

        const lembretesAtrasados = retornoSolic ? await consultaSegura(
            () => contarTabela(
                tabelas.solicitacoes, c.solicitacoes, empresaId,
                `${idSeguro(retornoSolic)} < NOW() AND ${condSolicAberta}`
            ), 0
        ) : 0;

        const pendenciasCriticas = osAtrasadas + agendaAtrasada + lembretesAtrasados + estoqueCritico + financeiroOS.pendentes + whatsappPendentes;

        const listas = {
            solicitacoes: await consultaSegura(
                () => listarModulo(tabelas.solicitacoes, c.solicitacoes, empresaId, { condicao: condSolicAberta }), []
            ),
            viabilidades: await consultaSegura(
                () => listarModulo(tabelas.viabilidades, c.viabilidades, empresaId, { condicao: condViabilidade }), []
            ),
            agendamentos: await consultaSegura(
                () => listarModulo(tabelas.agendamentos, c.agendamentos, empresaId, { condicao: condAgenda }), []
            ),
            ordens_servico: await consultaSegura(
                () => listarModulo(tabelas.ordens, c.ordens, empresaId, { condicao: condOSExecucao }), []
            ),
            relatorios: await consultaSegura(
                () => listarModulo(tabelas.relatorios, c.relatorios, empresaId, { limite: 6 }), []
            ),
            whatsapp: await consultaSegura(
                () => listarModulo(tabelas.whatsapp, c.whatsapp, empresaId, {
                    condicao: statusWhatsapp
                        ? `LOWER(${idSeguro(statusWhatsapp)}) IN ('pendente','fila','aguardando','erro','falha')`
                        : "1=1",
                    limite: 6
                }), []
            )
        };

        res.json({
            cards: {
                solicitacoes_clientes: solicitacoesAbertas,
                viabilidades: viabilidadesPendentes,
                agendamentos: agendamentosPendentes,
                ordens_servico: ordensExecucao,
                tecnicos_em_campo: tecnicosCampo,
                estoque_reservado: estoqueReservado,
                financeiro_os_quantidade: financeiroOS.quantidade,
                financeiro_os_valor: financeiroOS.valor,
                relatorios_enviados: relatoriosEnviados,
                whatsapp_pendentes: whatsappPendentes,
                pendencias_criticas: pendenciasCriticas
            },
            indicadores: {
                os_finalizadas_mes: ordensFinalizadasMes,
                lembretes_hoje: lembretesHoje,
                os_atrasadas: osAtrasadas,
                agendamentos_atrasados: agendaAtrasada,
                estoque_critico: estoqueCritico,
                financeiro_pendente: financeiroOS.pendentes
            },
            listas,
            modulos_detectados: tabelas
        });
    } catch (erro) {
        tratarErro(res, erro);
    }
});

module.exports = router;
