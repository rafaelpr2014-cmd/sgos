'use strict';

module.exports = function criarMinhasFaturasService(pool) {
    async function empresa(id) {
        const [rows] = await pool.query(
            `SELECT id, nome_fantasia, razao_social, nome_provedor, plano_empresa,
                    financeiro_status, COALESCE(suspensa_financeiro,0) AS suspensa_financeiro,
                    suspensa_em, suspensa_motivo
             FROM empresa
             WHERE id = ?
             LIMIT 1`,
            [id]
        );
        return rows[0] || null;
    }

    async function faturas(id) {
        const [rows] = await pool.query(
            `SELECT c.*,
                    (
                        SELECT p.id
                        FROM empresa_promessas_pagamento p
                        WHERE p.cobranca_id = c.id
                          AND p.status = 'ATIVA'
                          AND p.acesso_liberado_ate >= NOW()
                        ORDER BY p.id DESC
                        LIMIT 1
                    ) AS promessa_id,
                    (
                        SELECT p.acesso_liberado_ate
                        FROM empresa_promessas_pagamento p
                        WHERE p.cobranca_id = c.id
                          AND p.status = 'ATIVA'
                          AND p.acesso_liberado_ate >= NOW()
                        ORDER BY p.id DESC
                        LIMIT 1
                    ) AS promessa_ate
             FROM empresa_cobrancas c
             WHERE c.empresa_id = ?
             ORDER BY c.vencimento DESC, c.id DESC`,
            [id]
        );
        return rows;
    }

    async function resumo(id) {
        const emp = await empresa(id);
        if (!emp) {
            const erro = new Error('Empresa não encontrada.');
            erro.status = 404;
            throw erro;
        }

        const lista = await faturas(id);
        const pendentes = lista.filter(item =>
            ['PENDENTE','VENCIDO'].includes(String(item.status_interno || '').toUpperCase())
        );
        const vencidas = lista.filter(item =>
            String(item.status_interno || '').toUpperCase() === 'VENCIDO'
        );
        const pagas = lista.filter(item =>
            String(item.status_interno || '').toUpperCase() === 'PAGO'
        );
        const proxima = lista
            .filter(item => String(item.status_interno || '').toUpperCase() === 'PENDENTE')
            .sort((a,b) => String(a.vencimento).localeCompare(String(b.vencimento)))[0] || null;

        let aviso = null;

        if (Number(emp.suspensa_financeiro) === 1) {
            aviso = {
                nivel: 'SUSPENSO',
                titulo: 'Acesso suspenso',
                mensagem: emp.suspensa_motivo || 'Pendência financeira',
                suspensao_programada_em: emp.suspensa_em
            };
        } else if (vencidas.length) {
            const cobranca = [...vencidas].sort(
                (a,b) => String(a.vencimento).localeCompare(String(b.vencimento))
            )[0];

            aviso = {
                nivel: 'VENCIDO',
                titulo: 'Existe uma mensalidade pendente',
                mensagem: 'Regularize a pendência para evitar suspensão.',
                suspensao_programada_em: cobranca.suspensao_programada_em,
                cobranca_id: cobranca.id
            };
        }

        return {
            empresa: emp,
            resumo: {
                total_aberto: pendentes.reduce((s,item) => s + Number(item.valor || 0), 0),
                pendentes: pendentes.length,
                vencidas: vencidas.length,
                pagas: pagas.length,
                proxima_fatura: proxima,
                ultimo_pagamento: pagas[0] || null,
                aviso
            },
            faturas: lista
        };
    }

    async function timeline(id) {
        const [rows] = await pool.query(
            `SELECT id, cobranca_id, acao, detalhes, criado_em
             FROM empresa_financeiro_logs
             WHERE empresa_id = ?
             ORDER BY id DESC
             LIMIT 100`,
            [id]
        );
        return rows;
    }

    async function solicitar({empresaId, cobrancaId, data, observacao, usuarioId}) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
            const erro = new Error('Informe uma data válida.');
            erro.status = 400;
            throw erro;
        }

        const [cobrancas] = await pool.query(
            `SELECT id, status_interno
             FROM empresa_cobrancas
             WHERE id = ?
               AND empresa_id = ?
             LIMIT 1`,
            [cobrancaId, empresaId]
        );

        if (!cobrancas.length) {
            const erro = new Error('Cobrança não encontrada.');
            erro.status = 404;
            throw erro;
        }

        const [existentes] = await pool.query(
            `SELECT id
             FROM empresa_solicitacoes_promessa
             WHERE empresa_id = ?
               AND cobranca_id = ?
               AND status = 'PENDENTE'
             LIMIT 1`,
            [empresaId, cobrancaId]
        );

        if (existentes.length) {
            const erro = new Error('Já existe solicitação pendente.');
            erro.status = 409;
            throw erro;
        }

        const [resultado] = await pool.query(
            `INSERT INTO empresa_solicitacoes_promessa
             (empresa_id, cobranca_id, data_solicitada, observacao, status, solicitado_por, solicitado_em)
             VALUES (?, ?, ?, ?, 'PENDENTE', ?, NOW())`,
            [empresaId, cobrancaId, data, String(observacao || ''), usuarioId || null]
        );

        await pool.query(
            `INSERT INTO empresa_financeiro_logs
             (empresa_id, cobranca_id, usuario_id, acao, detalhes, criado_em)
             VALUES (?, ?, ?, 'SOLICITACAO_PROMESSA_CRIADA', ?, NOW())`,
            [
                empresaId,
                cobrancaId,
                usuarioId || null,
                JSON.stringify({
                    solicitacao_id: resultado.insertId,
                    data_solicitada: data
                })
            ]
        );

        return { id: resultado.insertId };
    }

    async function solicitacoes(id) {
        const [rows] = await pool.query(
            `SELECT s.*, c.competencia, c.valor, c.vencimento, c.status_interno
             FROM empresa_solicitacoes_promessa s
             INNER JOIN empresa_cobrancas c ON c.id = s.cobranca_id
             WHERE s.empresa_id = ?
             ORDER BY s.id DESC`,
            [id]
        );
        return rows;
    }

    return {
        resumo,
        faturas,
        timeline,
        solicitar,
        solicitacoes
    };
};
