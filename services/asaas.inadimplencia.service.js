'use strict';

module.exports = function criarAsaasInadimplenciaService(pool) {
    const DIAS_TOLERANCIA_PADRAO = 5;
    const HORA_SUSPENSAO = 9;

    function dataSql(valor) {
        if (!valor) return null;
        const data = new Date(valor);
        if (Number.isNaN(data.getTime())) return null;
        return data.toISOString().slice(0, 19).replace('T', ' ');
    }

    async function registrarLog({
        empresaId,
        cobrancaId = null,
        usuarioId = null,
        acao,
        detalhes = null
    }) {
        await pool.query(
            `INSERT INTO empresa_financeiro_logs
             (empresa_id, cobranca_id, usuario_id, acao, detalhes, criado_em)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [empresaId, cobrancaId, usuarioId, acao, detalhes]
        );
    }

    async function obterEmpresa(empresaId) {
        const [rows] = await pool.query(
            `SELECT *
               FROM empresa
              WHERE id = ?
              LIMIT 1`,
            [empresaId]
        );
        return rows[0] || null;
    }

    async function obterCobranca(cobrancaId) {
        const [rows] = await pool.query(
            `SELECT *
               FROM empresa_cobrancas
              WHERE id = ?
              LIMIT 1`,
            [cobrancaId]
        );
        return rows[0] || null;
    }

    async function obterPromessaAtiva(empresaId, cobrancaId = null) {
        const params = [empresaId];
        let filtroCobranca = '';

        if (cobrancaId) {
            filtroCobranca = ' AND cobranca_id = ?';
            params.push(cobrancaId);
        }

        const [rows] = await pool.query(
            `SELECT *
               FROM empresa_promessas_pagamento
              WHERE empresa_id = ?
                ${filtroCobranca}
                AND status = 'ATIVA'
                AND acesso_liberado_ate >= NOW()
              ORDER BY acesso_liberado_ate DESC
              LIMIT 1`,
            params
        );

        return rows[0] || null;
    }

    async function programarSuspensaoPorCobranca(cobrancaId, {
        origem = 'AVISO_AUTOMATICO',
        usuarioId = null
    } = {}) {
        const cobranca = await obterCobranca(cobrancaId);
        if (!cobranca) return null;

        if (['PAGO', 'REMOVIDO', 'ESTORNADO'].includes(
            String(cobranca.status_interno || '').toUpperCase()
        )) {
            return null;
        }

        const [resultado] = await pool.query(
            `UPDATE empresa_cobrancas
                SET aviso_pendencia_em = COALESCE(aviso_pendencia_em, NOW()),
                    suspensao_programada_em = COALESCE(
                        suspensao_programada_em,
                        TIMESTAMP(
                            DATE_ADD(DATE(COALESCE(aviso_pendencia_em, NOW())), INTERVAL ? DAY),
                            MAKETIME(?, 0, 0)
                        )
                    ),
                    status_interno = CASE
                        WHEN status_interno = 'PAGO' THEN status_interno
                        ELSE 'VENCIDO'
                    END,
                    atualizado_em = NOW()
              WHERE id = ?`,
            [DIAS_TOLERANCIA_PADRAO, HORA_SUSPENSAO, cobranca.id]
        );

        const atualizada = await obterCobranca(cobranca.id);

        await registrarLog({
            empresaId: cobranca.empresa_id,
            cobrancaId: cobranca.id,
            usuarioId,
            acao: 'AVISO_PENDENCIA_REGISTRADO',
            detalhes: JSON.stringify({
                origem,
                aviso_pendencia_em: atualizada?.aviso_pendencia_em || null,
                suspensao_programada_em: atualizada?.suspensao_programada_em || null,
                dias_tolerancia: DIAS_TOLERANCIA_PADRAO,
                hora_suspensao: '09:00'
            })
        });

        return {
            cobranca: atualizada,
            affectedRows: resultado.affectedRows
        };
    }

    async function criarPromessa({
        empresaId,
        cobrancaId,
        dataPrometida,
        observacao,
        usuarioId
    }) {
        const empresa = await obterEmpresa(empresaId);
        if (!empresa) {
            const erro = new Error('Empresa não encontrada.');
            erro.status = 404;
            throw erro;
        }

        const cobranca = await obterCobranca(cobrancaId);
        if (!cobranca || Number(cobranca.empresa_id) !== Number(empresaId)) {
            const erro = new Error('Cobrança não encontrada para esta empresa.');
            erro.status = 404;
            throw erro;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataPrometida || ''))) {
            const erro = new Error('Informe uma data válida para a promessa.');
            erro.status = 400;
            throw erro;
        }

        // O acesso permanece liberado até o fim da data prometida.
        // Caso não haja pagamento, a suspensão ocorre às 09:00 do dia seguinte.
        const acessoLiberadoAte = `${dataPrometida} 23:59:59`;
        const suspensaoAposPromessa = new Date(`${dataPrometida}T09:00:00-03:00`);
        suspensaoAposPromessa.setDate(suspensaoAposPromessa.getDate() + 1);

        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();

            await conexao.query(
                `UPDATE empresa_promessas_pagamento
                    SET status = 'CANCELADA',
                        cancelada_em = NOW(),
                        cancelada_por = ?
                  WHERE empresa_id = ?
                    AND cobranca_id = ?
                    AND status = 'ATIVA'`,
                [usuarioId, empresaId, cobrancaId]
            );

            const [resultado] = await conexao.query(
                `INSERT INTO empresa_promessas_pagamento
                 (
                    empresa_id,
                    cobranca_id,
                    data_prometida,
                    acesso_liberado_ate,
                    observacao,
                    status,
                    criado_por,
                    criado_em
                 )
                 VALUES (?, ?, ?, ?, ?, 'ATIVA', ?, NOW())`,
                [
                    empresaId,
                    cobrancaId,
                    dataPrometida,
                    acessoLiberadoAte,
                    String(observacao || '').trim(),
                    usuarioId
                ]
            );

            await conexao.query(
                `UPDATE empresa
                    SET financeiro_status = 'PROMESSA',
                        suspensa_financeiro = 0,
                        suspensa_em = NULL,
                        suspensa_motivo = NULL,
                        reativada_em = NOW()
                  WHERE id = ?`,
                [empresaId]
            );

            await conexao.query(
                `UPDATE empresa_cobrancas
                    SET suspensao_programada_em = ?,
                        atualizado_em = NOW()
                  WHERE id = ?`,
                [dataSql(suspensaoAposPromessa), cobrancaId]
            );

            await conexao.commit();

            await registrarLog({
                empresaId,
                cobrancaId,
                usuarioId,
                acao: 'PROMESSA_PAGAMENTO_CRIADA',
                detalhes: JSON.stringify({
                    promessa_id: resultado.insertId,
                    data_prometida: dataPrometida,
                    acesso_liberado_ate: acessoLiberadoAte,
                    suspensao_programada_em: dataSql(suspensaoAposPromessa),
                    observacao: String(observacao || '').trim()
                })
            });

            return {
                id: resultado.insertId,
                empresaId,
                cobrancaId,
                dataPrometida,
                acessoLiberadoAte,
                suspensaoProgramadaEm: dataSql(suspensaoAposPromessa)
            };
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }
    }

    async function cancelarPromessa(promessaId, usuarioId) {
        const [rows] = await pool.query(
            `SELECT *
               FROM empresa_promessas_pagamento
              WHERE id = ?
              LIMIT 1`,
            [promessaId]
        );

        if (!rows.length) {
            const erro = new Error('Promessa não encontrada.');
            erro.status = 404;
            throw erro;
        }

        const promessa = rows[0];

        await pool.query(
            `UPDATE empresa_promessas_pagamento
                SET status = 'CANCELADA',
                    cancelada_em = NOW(),
                    cancelada_por = ?
              WHERE id = ?`,
            [usuarioId, promessaId]
        );

        await registrarLog({
            empresaId: promessa.empresa_id,
            cobrancaId: promessa.cobranca_id,
            usuarioId,
            acao: 'PROMESSA_PAGAMENTO_CANCELADA',
            detalhes: JSON.stringify({ promessa_id: promessaId })
        });

        return promessa;
    }

    async function suspenderEmpresa(empresaId, {
        motivo = 'Pendência financeira',
        cobrancaId = null,
        usuarioId = null,
        origem = 'ROTINA_AUTOMATICA'
    } = {}) {
        const empresa = await obterEmpresa(empresaId);
        if (!empresa) return null;

        if (Number(empresa.id) === 1) {
            console.warn('A empresa 1 não será suspensa automaticamente.');
            return { ignorada: true, motivo: 'EMPRESA_1' };
        }

        if (Number(empresa.suspensa_financeiro) === 1) {
            return { jaSuspensa: true, empresa };
        }

        await pool.query(
            `UPDATE empresa
                SET financeiro_status = 'SUSPENSO',
                    suspensa_financeiro = 1,
                    suspensa_em = NOW(),
                    suspensa_motivo = ?,
                    reativada_em = NULL
              WHERE id = ?`,
            [motivo, empresaId]
        );

        await registrarLog({
            empresaId,
            cobrancaId,
            usuarioId,
            acao: 'EMPRESA_SUSPENSA_FINANCEIRO',
            detalhes: JSON.stringify({ origem, motivo })
        });

        return {
            suspensa: true,
            empresaId,
            motivo
        };
    }

    async function existemPendenciasBloqueantes(empresaId) {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS total
               FROM empresa_cobrancas c
              WHERE c.empresa_id = ?
                AND c.status_interno = 'VENCIDO'
                AND c.vencimento < CURDATE()
                AND NOT EXISTS (
                    SELECT 1
                      FROM empresa_promessas_pagamento p
                     WHERE p.empresa_id = c.empresa_id
                       AND p.cobranca_id = c.id
                       AND p.status = 'ATIVA'
                       AND p.acesso_liberado_ate >= NOW()
                )`,
            [empresaId]
        );

        return Number(rows[0]?.total || 0) > 0;
    }

    async function reativarEmpresaSeRegular(empresaId, {
        cobrancaId = null,
        usuarioId = null,
        origem = 'PAGAMENTO_ASAAS',
        forcar = false
    } = {}) {
        const empresa = await obterEmpresa(empresaId);
        if (!empresa) return null;

        if (!forcar && await existemPendenciasBloqueantes(empresaId)) {
            return {
                reativada: false,
                motivo: 'OUTRAS_PENDENCIAS'
            };
        }

        await pool.query(
            `UPDATE empresa
                SET financeiro_status = 'REGULAR',
                    suspensa_financeiro = 0,
                    suspensa_em = NULL,
                    suspensa_motivo = NULL,
                    reativada_em = NOW()
              WHERE id = ?`,
            [empresaId]
        );

        if (cobrancaId) {
            await pool.query(
                `UPDATE empresa_promessas_pagamento
                    SET status = 'CUMPRIDA',
                        cumprida_em = NOW()
                  WHERE empresa_id = ?
                    AND cobranca_id = ?
                    AND status = 'ATIVA'`,
                [empresaId, cobrancaId]
            );
        }

        await registrarLog({
            empresaId,
            cobrancaId,
            usuarioId,
            acao: 'EMPRESA_REATIVADA_FINANCEIRO',
            detalhes: JSON.stringify({ origem, forcar })
        });

        return {
            reativada: true,
            empresaId
        };
    }

    async function prepararCobrancasVencidasSemAviso() {
        const [rows] = await pool.query(
            `SELECT id
               FROM empresa_cobrancas
              WHERE status_interno NOT IN ('PAGO', 'REMOVIDO', 'ESTORNADO')
                AND vencimento < CURDATE()
                AND aviso_pendencia_em IS NULL
              ORDER BY id
              LIMIT 500`
        );

        for (const item of rows) {
            await programarSuspensaoPorCobranca(item.id, {
                origem: 'ROTINA_VENCIMENTO'
            });
        }

        return rows.length;
    }

    async function vencerPromessasExpiradas() {
        const [resultado] = await pool.query(
            `UPDATE empresa_promessas_pagamento
                SET status = 'VENCIDA',
                    vencida_em = NOW()
              WHERE status = 'ATIVA'
                AND acesso_liberado_ate < NOW()`
        );

        return resultado.affectedRows;
    }

    async function processarSuspensoesProgramadas() {
        const [rows] = await pool.query(
            `SELECT
                c.id AS cobranca_id,
                c.empresa_id,
                c.suspensao_programada_em,
                c.status_interno
             FROM empresa_cobrancas c
             INNER JOIN empresa e ON e.id = c.empresa_id
             WHERE c.status_interno = 'VENCIDO'
               AND c.suspensao_programada_em IS NOT NULL
               AND c.suspensao_programada_em <= NOW()
               AND COALESCE(e.suspensa_financeiro, 0) = 0
               AND e.id <> 1
               AND NOT EXISTS (
                    SELECT 1
                      FROM empresa_promessas_pagamento p
                     WHERE p.empresa_id = c.empresa_id
                       AND p.cobranca_id = c.id
                       AND p.status = 'ATIVA'
                       AND p.acesso_liberado_ate >= NOW()
               )
             ORDER BY c.suspensao_programada_em
             LIMIT 200`
        );

        let suspensas = 0;

        for (const item of rows) {
            const resultado = await suspenderEmpresa(item.empresa_id, {
                motivo: 'Mensalidade vencida após aviso e 5 dias de tolerância',
                cobrancaId: item.cobranca_id,
                origem: 'ROTINA_09H'
            });

            if (resultado?.suspensa) suspensas += 1;
        }

        return suspensas;
    }

    async function executarRotina() {
        const inicio = Date.now();

        try {
            const avisos = await prepararCobrancasVencidasSemAviso();
            const promessasVencidas = await vencerPromessasExpiradas();
            const suspensas = await processarSuspensoesProgramadas();

            if (avisos || promessasVencidas || suspensas) {
                console.log('ROTINA FINANCEIRA ASAAS:', {
                    avisos_registrados: avisos,
                    promessas_vencidas: promessasVencidas,
                    empresas_suspensas: suspensas,
                    duracao_ms: Date.now() - inicio
                });
            }

            return { avisos, promessasVencidas, suspensas };
        } catch (erro) {
            console.error('Erro na rotina financeira Asaas:', erro);
            throw erro;
        }
    }

    return {
        DIAS_TOLERANCIA_PADRAO,
        HORA_SUSPENSAO,
        obterPromessaAtiva,
        programarSuspensaoPorCobranca,
        criarPromessa,
        cancelarPromessa,
        suspenderEmpresa,
        reativarEmpresaSeRegular,
        executarRotina
    };
};
