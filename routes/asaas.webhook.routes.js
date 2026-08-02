'use strict';

const express = require('express');
const criarWebhookService = require('../services/asaas.webhook.service');

module.exports = function criarRotasWebhookAsaas(pool) {
    const router = express.Router();
    const webhookService = criarWebhookService(pool);

    function tokenConfigurado() {
        return String(process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
    }

    function tokenRecebido(req) {
        return String(
            req.headers['asaas-access-token'] ||
            req.headers['x-asaas-access-token'] ||
            ''
        ).trim();
    }

    router.get('/health', (req, res) => {
        return res.json({
            ok: true,
            webhook: 'asaas',
            token_configurado: Boolean(tokenConfigurado())
        });
    });

    router.post('/', async (req, res) => {
        const esperado = tokenConfigurado();
        const recebido = tokenRecebido(req);

        if (!esperado) {
            console.error('ASAAS_WEBHOOK_TOKEN não configurado no .env.');
            return res.status(503).json({
                erro: 'Webhook Asaas não configurado.',
                codigo: 'ASAAS_WEBHOOK_SEM_TOKEN'
            });
        }

        if (!recebido || recebido !== esperado) {
            return res.status(401).json({
                erro: 'Token do webhook inválido.',
                codigo: 'ASAAS_WEBHOOK_TOKEN_INVALIDO'
            });
        }

        try {
            const resultado = await webhookService.processarEvento(req.body || {});

            // Webhooks duplicados retornam 200 para o Asaas não insistir.
            return res.status(200).json({
                recebido: true,
                duplicado: Boolean(resultado.duplicado),
                event_id: resultado.eventId,
                event_type: resultado.eventType,
                payment_id: resultado.paymentId,
                encontrado: resultado.encontrado ?? null
            });
        } catch (erro) {
            console.error('Erro ao processar webhook Asaas:', erro);

            const status = [400, 404].includes(Number(erro?.status))
                ? Number(erro.status)
                : 500;

            return res.status(status).json({
                erro: erro?.message || 'Erro ao processar webhook Asaas.',
                codigo: erro?.codigo || 'ASAAS_WEBHOOK_ERRO'
            });
        }
    });

    return router;
};
