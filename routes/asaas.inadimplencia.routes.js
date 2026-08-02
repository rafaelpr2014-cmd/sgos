'use strict';

const express = require('express');
const criarInadimplenciaService = require('../services/asaas.inadimplencia.service');

module.exports = function criarRotasInadimplenciaAsaas(pool) {
    const router = express.Router();
    const service = criarInadimplenciaService(pool);

    function somenteAdminEmpresa1(req, res, next) {
        const cargo = String(req.usuario?.cargo || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();

        if (Number(req.usuario?.empresa_id) !== 1 || cargo !== 'administrador') {
            return res.status(403).json({
                erro: 'Acesso exclusivo para administradores da empresa 1.',
                codigo: 'ASAAS_APENAS_ADMIN_EMPRESA_1'
            });
        }

        next();
    }

    router.use(somenteAdminEmpresa1);

    router.get('/resumo', async (req, res) => {
        try {
            const [resumoRows] = await pool.query(`
                SELECT
                    SUM(CASE WHEN financeiro_status = 'REGULAR' THEN 1 ELSE 0 END) AS regulares,
                    SUM(CASE WHEN financeiro_status = 'PENDENTE' THEN 1 ELSE 0 END) AS pendentes,
                    SUM(CASE WHEN financeiro_status = 'PROMESSA' THEN 1 ELSE 0 END) AS promessas,
                    SUM(CASE WHEN financeiro_status = 'SUSPENSO' THEN 1 ELSE 0 END) AS suspensas
                FROM empresa
            `);

            const [promessas] = await pool.query(`
                SELECT COUNT(*) AS total
                FROM empresa_promessas_pagamento
                WHERE status = 'ATIVA'
                  AND acesso_liberado_ate >= NOW()
            `);

            return res.json({
                ...(resumoRows[0] || {}),
                promessas_ativas: Number(promessas[0]?.total || 0),
                dias_tolerancia: service.DIAS_TOLERANCIA_PADRAO,
                hora_suspensao: '09:00'
            });
        } catch (erro) {
            console.error('Erro ao carregar resumo da inadimplência:', erro);
            return res.status(500).json({ erro: 'Erro ao carregar resumo financeiro.' });
        }
    });

    router.get('/promessas', async (req, res) => {
        try {
            const empresaId = Number(req.query.empresa_id || 0);
            const params = [];
            let filtro = '';

            if (empresaId) {
                filtro = 'WHERE p.empresa_id = ?';
                params.push(empresaId);
            }

            const [rows] = await pool.query(
                `SELECT
                    p.*,
                    c.competencia,
                    c.valor,
                    c.vencimento,
                    c.status_interno,
                    u.usuario AS criado_por_nome
                 FROM empresa_promessas_pagamento p
                 INNER JOIN empresa_cobrancas c ON c.id = p.cobranca_id
                 LEFT JOIN usuarios u ON u.id = p.criado_por
                 ${filtro}
                 ORDER BY p.id DESC`,
                params
            );

            return res.json(rows);
        } catch (erro) {
            console.error('Erro ao listar promessas:', erro);
            return res.status(500).json({ erro: 'Erro ao listar promessas.' });
        }
    });

    router.post('/promessas', async (req, res) => {
        try {
            const resultado = await service.criarPromessa({
                empresaId: Number(req.body.empresa_id || 0),
                cobrancaId: Number(req.body.cobranca_id || 0),
                dataPrometida: String(req.body.data_prometida || ''),
                observacao: String(req.body.observacao || ''),
                usuarioId: req.usuario.id
            });

            return res.status(201).json({
                sucesso: true,
                promessa: resultado
            });
        } catch (erro) {
            const status = [400, 404, 409].includes(Number(erro?.status))
                ? Number(erro.status)
                : 500;

            return res.status(status).json({
                erro: erro?.message || 'Erro ao registrar promessa.'
            });
        }
    });

    router.delete('/promessas/:id', async (req, res) => {
        try {
            await service.cancelarPromessa(Number(req.params.id), req.usuario.id);
            return res.json({ sucesso: true });
        } catch (erro) {
            const status = Number(erro?.status) === 404 ? 404 : 500;
            return res.status(status).json({
                erro: erro?.message || 'Erro ao cancelar promessa.'
            });
        }
    });

    router.post('/empresas/:id/suspender', async (req, res) => {
        try {
            const resultado = await service.suspenderEmpresa(
                Number(req.params.id),
                {
                    motivo: String(req.body?.motivo || 'Suspensão manual financeira'),
                    usuarioId: req.usuario.id,
                    origem: 'ADMINISTRADOR'
                }
            );

            return res.json({ sucesso: true, resultado });
        } catch (erro) {
            return res.status(500).json({ erro: erro?.message || 'Erro ao suspender empresa.' });
        }
    });

    router.post('/empresas/:id/reativar', async (req, res) => {
        try {
            const resultado = await service.reativarEmpresaSeRegular(
                Number(req.params.id),
                {
                    usuarioId: req.usuario.id,
                    origem: 'ADMINISTRADOR',
                    forcar: true
                }
            );

            return res.json({ sucesso: true, resultado });
        } catch (erro) {
            return res.status(500).json({ erro: erro?.message || 'Erro ao reativar empresa.' });
        }
    });

    router.post('/cobrancas/:id/registrar-aviso', async (req, res) => {
        try {
            const resultado = await service.programarSuspensaoPorCobranca(
                Number(req.params.id),
                {
                    origem: 'ADMINISTRADOR',
                    usuarioId: req.usuario.id
                }
            );

            return res.json({ sucesso: true, resultado });
        } catch (erro) {
            return res.status(500).json({ erro: erro?.message || 'Erro ao registrar aviso.' });
        }
    });

    router.post('/rotina/executar', async (req, res) => {
        try {
            const resultado = await service.executarRotina();
            return res.json({ sucesso: true, resultado });
        } catch (erro) {
            return res.status(500).json({ erro: erro?.message || 'Erro ao executar rotina.' });
        }
    });

    return router;
};
