'use strict';

const asaas = require('./asaas.service');

module.exports = function criarAsaasWebhookService(pool) {
    function mapearStatusInterno(statusAsaas) {
        const status = String(statusAsaas || '').toUpperCase();

        if ([
            'RECEIVED',
            'CONFIRMED',
            'RECEIVED_IN_CASH',
            'RECEIVED_WITH_OVERPAYMENT'
        ].includes(status)) {
            return 'PAGO';
        }

        if (status === 'OVERDUE') return 'VENCIDO';

        if ([
            'REFUNDED',
            'REFUND_REQUESTED',
            'CHARGEBACK_REQUESTED',
            'CHARGEBACK_DISPUTE'
        ].includes(status)) {
            return 'ESTORNADO';
        }

        if (['DELETED', 'CANCELLED'].includes(status)) return 'REMOVIDO';

        return 'PENDENTE';
    }

    function obterDataPagamento(payment, statusInterno) {
        if (statusInterno !== 'PAGO') return null;

        return (
            payment?.clientPaymentDate ||
            payment?.paymentDate ||
            payment?.confirmedDate ||
            payment?.creditDate ||
            null
        );
    }

    function obterValorPago(payment, local, statusInterno) {
        if (statusInterno !== 'PAGO') return null;

        const valor = Number(
            payment?.value ??
            payment?.netValue ??
            local?.valor ??
            0
        );

        return Number.isFinite(valor) ? valor : null;
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
            [
                empresaId,
                cobrancaId,
                usuarioId,
                acao,
                detalhes
            ]
        );
    }

    async function localizarCobranca(paymentId) {
        const [rows] = await pool.query(
            `SELECT *
               FROM empresa_cobrancas
              WHERE asaas_payment_id = ?
              LIMIT 1`,
            [paymentId]
        );

        return rows[0] || null;
    }

    async function atualizarCobrancaLocal(local, payment, {
        usuarioId = null,
        origem = 'WEBHOOK',
        eventType = null
    } = {}) {
        const statusInterno = mapearStatusInterno(payment?.status);
        const dataPagamento = obterDataPagamento(payment, statusInterno);
        const valorPago = obterValorPago(payment, local, statusInterno);

        const [resultado] = await pool.query(
            `UPDATE empresa_cobrancas SET
                valor = ?,
                valor_pago = ?,
                vencimento = ?,
                status_asaas = ?,
                status_interno = ?,
                pago_em = ?,
                invoice_url = ?,
                bank_slip_url = ?,
                atualizado_em = NOW()
             WHERE id = ?`,
            [
                payment?.value ?? local.valor,
                valorPago,
                payment?.dueDate ?? local.vencimento,
                payment?.status || local.status_asaas,
                statusInterno,
                dataPagamento,
                payment?.invoiceUrl || local.invoice_url,
                payment?.bankSlipUrl || local.bank_slip_url,
                local.id
            ]
        );

        const acao = eventType || (
            statusInterno === 'PAGO'
                ? 'COBRANCA_PAGA'
                : statusInterno === 'VENCIDO'
                    ? 'COBRANCA_VENCIDA'
                    : statusInterno === 'ESTORNADO'
                        ? 'COBRANCA_ESTORNADA'
                        : statusInterno === 'REMOVIDO'
                            ? 'COBRANCA_REMOVIDA_WEBHOOK'
                            : 'COBRANCA_ATUALIZADA_WEBHOOK'
        );

        await registrarLog({
            empresaId: local.empresa_id,
            cobrancaId: local.id,
            usuarioId,
            acao,
            detalhes: JSON.stringify({
                origem,
                event_type: eventType,
                payment_id: local.asaas_payment_id,
                status_asaas: payment?.status || null,
                status_interno: statusInterno,
                valor_pago: valorPago,
                pago_em: dataPagamento
            })
        });

        console.log('ASAAS COBRANÇA ATUALIZADA:', {
            origem,
            event_type: eventType,
            cobranca_local_id: local.id,
            asaas_payment_id: local.asaas_payment_id,
            status_asaas: payment?.status,
            status_interno: statusInterno,
            affectedRows: resultado.affectedRows,
            changedRows: resultado.changedRows
        });

        return {
            local,
            remoto: payment,
            statusInterno,
            valorPago,
            dataPagamento,
            affectedRows: resultado.affectedRows,
            changedRows: resultado.changedRows
        };
    }

    async function sincronizarPagamentoPorIdAsaas(paymentId, opcoes = {}) {
        if (!paymentId) {
            const erro = new Error('payment_id não informado.');
            erro.status = 400;
            throw erro;
        }

        const local = await localizarCobranca(paymentId);

        if (!local) {
            const erro = new Error('Cobrança do Asaas não encontrada no SGOS.');
            erro.status = 404;
            erro.codigo = 'COBRANCA_LOCAL_NAO_ENCONTRADA';
            throw erro;
        }

        const remoto = await asaas.consultarCobranca(paymentId);
        return atualizarCobrancaLocal(local, remoto, opcoes);
    }

    async function processarEvento(evento) {
        const eventId = String(evento?.id || '').trim();
        const eventType = String(evento?.event || '').trim().toUpperCase();
        const payment = evento?.payment || null;
        const paymentId = String(payment?.id || '').trim();

        if (!eventId || !eventType) {
            const erro = new Error('Webhook inválido: id e event são obrigatórios.');
            erro.status = 400;
            throw erro;
        }

        try {
            await pool.query(
                `INSERT INTO asaas_webhook_eventos
                 (
                    event_id,
                    event_type,
                    payment_id,
                    payload_json,
                    status_processamento,
                    recebido_em
                 )
                 VALUES (?, ?, ?, ?, 'PROCESSANDO', NOW())`,
                [
                    eventId,
                    eventType,
                    paymentId || null,
                    JSON.stringify(evento)
                ]
            );
        } catch (erro) {
            if (erro?.code === 'ER_DUP_ENTRY') {
                return {
                    duplicado: true,
                    eventId,
                    eventType,
                    paymentId
                };
            }
            throw erro;
        }

        try {
            let resultado = null;

            if (paymentId) {
                const local = await localizarCobranca(paymentId);

                if (local) {
                    // O payload do webhook normalmente já contém os dados necessários.
                    // A consulta à API é usada como fonte final quando possível.
                    let paymentAtualizado = payment;

                    try {
                        paymentAtualizado = await asaas.consultarCobranca(paymentId);
                    } catch (erroConsulta) {
                        console.warn(
                            'Não foi possível consultar a cobrança no Asaas; usando payload do webhook:',
                            erroConsulta.message
                        );
                    }

                    resultado = await atualizarCobrancaLocal(
                        local,
                        paymentAtualizado,
                        {
                            usuarioId: null,
                            origem: 'WEBHOOK',
                            eventType
                        }
                    );
                }
            }

            await pool.query(
                `UPDATE asaas_webhook_eventos
                    SET status_processamento = ?,
                        processado_em = NOW(),
                        erro = NULL
                  WHERE event_id = ?`,
                [
                    resultado ? 'PROCESSADO' : 'IGNORADO',
                    eventId
                ]
            );

            return {
                duplicado: false,
                eventId,
                eventType,
                paymentId,
                encontrado: Boolean(resultado),
                resultado
            };
        } catch (erro) {
            await pool.query(
                `UPDATE asaas_webhook_eventos
                    SET status_processamento = 'ERRO',
                        processado_em = NOW(),
                        erro = ?
                  WHERE event_id = ?`,
                [
                    String(erro?.message || erro).slice(0, 65000),
                    eventId
                ]
            );

            throw erro;
        }
    }

    return {
        mapearStatusInterno,
        localizarCobranca,
        atualizarCobrancaLocal,
        sincronizarPagamentoPorIdAsaas,
        processarEvento
    };
};
