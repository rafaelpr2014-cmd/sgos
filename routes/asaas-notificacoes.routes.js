'use strict';

const express = require('express');
const criarService = require('../services/asaas-notificacoes.service');

module.exports = function criarRotas(pool) {
    const router = express.Router();
    const service = criarService(pool);

    function somenteAdminEmpresa1(req, res, next) {
        const cargo = String(req.usuario?.cargo || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();

        if (Number(req.usuario?.empresa_id) !== 1 || cargo !== 'administrador') {
            return res.status(403).json({
                erro: 'Acesso exclusivo para administradores da empresa 1.'
            });
        }

        next();
    }

    router.use(somenteAdminEmpresa1);

    router.post('/rotina/executar', async (req, res) => {
        try {
            const resultado = await service.executarRotina();
            return res.json({ sucesso: true, resultado });
        } catch (erro) {
            return res.status(500).json({
                erro: erro?.message || 'Erro ao executar notificações.'
            });
        }
    });

    router.post('/cobrancas/:id/lembrete-d1', async (req, res) => {
        try {
            await service.enviarLembreteUmDiaAntes(Number(req.params.id));
            return res.json({ sucesso: true });
        } catch (erro) {
            return res.status(500).json({ erro: erro?.message || 'Erro no lembrete.' });
        }
    });

    router.post('/cobrancas/:id/vencimento-d0', async (req, res) => {
        try {
            await service.enviarVencimentoHoje(Number(req.params.id));
            return res.json({ sucesso: true });
        } catch (erro) {
            return res.status(500).json({ erro: erro?.message || 'Erro no envio do boleto.' });
        }
    });

    return router;
};
