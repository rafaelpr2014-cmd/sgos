'use strict';

const express = require('express');

module.exports = function criarFinanceiroSgosRoutes(pool) {
    const router = express.Router();

    function normalizarCargo(valor) {
        return String(valor || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
    }

    function somenteAdminEmpresa1(req, res, next) {
        if (
            Number(req.usuario?.empresa_id) !== 1 ||
            normalizarCargo(req.usuario?.cargo) !== 'administrador'
        ) {
            return res.status(403).json({
                erro: 'Acesso exclusivo para administradores da empresa 1.',
                codigo: 'FINANCEIRO_SGOS_APENAS_ADMIN_EMPRESA_1'
            });
        }

        next();
    }

    function periodoMes(mes) {
        const valor = /^\d{4}-\d{2}$/.test(String(mes || ''))
            ? String(mes)
            : new Date().toISOString().slice(0, 7);

        const [ano, numeroMes] = valor.split('-').map(Number);
        const inicio = `${valor}-01`;
        const fimData = new Date(ano, numeroMes, 0);
        const fim = [
            fimData.getFullYear(),
            String(fimData.getMonth() + 1).padStart(2, '0'),
            String(fimData.getDate()).padStart(2, '0')
        ].join('-');

        return { mes: valor, inicio, fim };
    }

    function periodoConsulta(mes, dia) {
        const periodo = periodoMes(mes);
        const data = String(dia || '').trim();

        if (/^\d{4}-\d{2}-\d{2}$/.test(data) && data.startsWith(`${periodo.mes}-`)) {
            return {
                ...periodo,
                dia: data,
                inicioConsulta: data,
                fimConsulta: data
            };
        }

        return {
            ...periodo,
            dia: null,
            inicioConsulta: periodo.inicio,
            fimConsulta: periodo.fim
        };
    }

    router.use(somenteAdminEmpresa1);

    router.get('/resumo', async (req, res) => {
        try {
            const periodo = periodoConsulta(req.query.mes, req.query.dia);

            const [rows] = await pool.query(
                `SELECT
                    COUNT(*) AS boletos_gerados,
                    COALESCE(SUM(valor), 0) AS valor_gerado,
                    COALESCE(SUM(
                        CASE WHEN status_interno = 'PAGO'
                             THEN COALESCE(valor_pago, valor)
                             ELSE 0 END
                    ), 0) AS valor_recebido,
                    COALESCE(SUM(
                        CASE WHEN status_interno IN ('PENDENTE', 'VENCIDO')
                             THEN valor ELSE 0 END
                    ), 0) AS valor_em_aberto,
                    SUM(CASE WHEN status_interno = 'PAGO' THEN 1 ELSE 0 END) AS boletos_pagos,
                    SUM(CASE WHEN status_interno = 'PENDENTE' THEN 1 ELSE 0 END) AS boletos_pendentes,
                    SUM(CASE WHEN status_interno = 'VENCIDO' THEN 1 ELSE 0 END) AS boletos_vencidos,
                    SUM(CASE WHEN status_interno = 'REMOVIDO' THEN 1 ELSE 0 END) AS boletos_removidos,
                    COUNT(DISTINCT empresa_id) AS empresas_cobradas
                 FROM empresa_cobrancas
                 WHERE DATE(criado_em) BETWEEN ? AND ?`,
                [periodo.inicioConsulta, periodo.fimConsulta]
            );

            const [pagamentos] = await pool.query(
                `SELECT
                    COUNT(*) AS entradas,
                    COALESCE(SUM(COALESCE(valor_pago, valor)), 0) AS total
                 FROM empresa_cobrancas
                 WHERE status_interno = 'PAGO'
                   AND DATE(pago_em) BETWEEN ? AND ?`,
                [periodo.inicioConsulta, periodo.fimConsulta]
            );

            return res.json({
                periodo,
                ...(rows[0] || {}),
                entradas_pagamentos: Number(pagamentos[0]?.entradas || 0),
                total_entradas_pagamentos: Number(pagamentos[0]?.total || 0)
            });
        } catch (erro) {
            console.error('Erro ao carregar resumo financeiro SGOS:', erro);
            return res.status(500).json({
                erro: 'Erro ao carregar o resumo financeiro.'
            });
        }
    });

    router.get('/grafico', async (req, res) => {
        try {
            const periodo = periodoConsulta(req.query.mes, req.query.dia);

            const [rows] = await pool.query(
                `SELECT
                    DATE(pago_em) AS dia,
                    COUNT(*) AS quantidade,
                    COALESCE(SUM(COALESCE(valor_pago, valor)), 0) AS total
                 FROM empresa_cobrancas
                 WHERE status_interno = 'PAGO'
                   AND DATE(pago_em) BETWEEN ? AND ?
                 GROUP BY DATE(pago_em)
                 ORDER BY dia`,
                [periodo.inicioConsulta, periodo.fimConsulta]
            );

            return res.json({ periodo, dados: rows });
        } catch (erro) {
            console.error('Erro ao carregar gráfico financeiro SGOS:', erro);
            return res.status(500).json({
                erro: 'Erro ao carregar o gráfico financeiro.'
            });
        }
    });

    router.get('/pagamentos', async (req, res) => {
        try {
            const periodo = periodoConsulta(req.query.mes, req.query.dia);
            const busca = String(req.query.busca || '').trim();
            const params = [periodo.inicioConsulta, periodo.fimConsulta];
            let filtroBusca = '';

            if (busca) {
                filtroBusca = `
                    AND (
                        COALESCE(e.nome_fantasia, '') LIKE ?
                        OR COALESCE(e.nome_provedor, '') LIKE ?
                        OR COALESCE(e.razao_social, '') LIKE ?
                        OR COALESCE(c.competencia, '') LIKE ?
                        OR COALESCE(c.descricao, '') LIKE ?
                        OR COALESCE(c.asaas_payment_id, '') LIKE ?
                    )`;
                const termo = `%${busca}%`;
                params.push(termo, termo, termo, termo, termo, termo);
            }

            const [rows] = await pool.query(
                `SELECT
                    c.id,
                    c.empresa_id,
                    c.asaas_payment_id,
                    c.competencia,
                    c.descricao,
                    c.valor,
                    c.valor_pago,
                    c.vencimento,
                    c.pago_em,
                    c.status_asaas,
                    c.status_interno,
                    c.invoice_url,
                    c.bank_slip_url,
                    COALESCE(
                        e.nome_fantasia,
                        e.nome_provedor,
                        e.razao_social,
                        CONCAT('Empresa ', e.id)
                    ) AS empresa_nome
                 FROM empresa_cobrancas c
                 INNER JOIN empresa e ON e.id = c.empresa_id
                 WHERE c.status_interno = 'PAGO'
                   AND DATE(c.pago_em) BETWEEN ? AND ?
                   ${filtroBusca}
                 ORDER BY c.pago_em DESC, c.id DESC`,
                params
            );

            return res.json({ periodo, pagamentos: rows });
        } catch (erro) {
            console.error('Erro ao listar pagamentos SGOS:', erro);
            return res.status(500).json({
                erro: 'Erro ao listar os pagamentos.'
            });
        }
    });

    router.get('/boletos', async (req, res) => {
        try {
            const periodo = periodoConsulta(req.query.mes, req.query.dia);
            const status = String(req.query.status || '').trim().toUpperCase();
            const busca = String(req.query.busca || '').trim();
            const params = [periodo.inicioConsulta, periodo.fimConsulta];
            const filtros = [];

            if (status) {
                filtros.push('c.status_interno = ?');
                params.push(status);
            }

            if (busca) {
                filtros.push(`(
                    COALESCE(e.nome_fantasia, '') LIKE ?
                    OR COALESCE(e.nome_provedor, '') LIKE ?
                    OR COALESCE(e.razao_social, '') LIKE ?
                    OR COALESCE(c.competencia, '') LIKE ?
                    OR COALESCE(c.descricao, '') LIKE ?
                    OR COALESCE(c.asaas_payment_id, '') LIKE ?
                )`);
                const termo = `%${busca}%`;
                params.push(termo, termo, termo, termo, termo, termo);
            }

            const complemento = filtros.length
                ? ` AND ${filtros.join(' AND ')}`
                : '';

            const [rows] = await pool.query(
                `SELECT
                    c.id,
                    c.empresa_id,
                    c.asaas_payment_id,
                    c.competencia,
                    c.descricao,
                    c.valor,
                    c.valor_pago,
                    c.vencimento,
                    c.pago_em,
                    c.status_asaas,
                    c.status_interno,
                    c.invoice_url,
                    c.bank_slip_url,
                    c.criado_em,
                    c.atualizado_em,
                    COALESCE(
                        e.nome_fantasia,
                        e.nome_provedor,
                        e.razao_social,
                        CONCAT('Empresa ', e.id)
                    ) AS empresa_nome
                 FROM empresa_cobrancas c
                 INNER JOIN empresa e ON e.id = c.empresa_id
                 WHERE DATE(c.criado_em) BETWEEN ? AND ?
                 ${complemento}
                 ORDER BY c.criado_em DESC, c.id DESC`,
                params
            );

            return res.json({ periodo, boletos: rows });
        } catch (erro) {
            console.error('Erro ao listar boletos SGOS:', erro);
            return res.status(500).json({
                erro: 'Erro ao listar os boletos.'
            });
        }
    });

    router.get('/logs', async (req, res) => {
        try {
            const periodo = periodoConsulta(req.query.mes, req.query.dia);
            const busca = String(req.query.busca || '').trim();
            const params = [periodo.inicioConsulta, periodo.fimConsulta];
            let filtroBusca = '';

            if (busca) {
                filtroBusca = `
                    AND (
                        COALESCE(e.nome_fantasia, '') LIKE ?
                        OR COALESCE(e.nome_provedor, '') LIKE ?
                        OR COALESCE(e.razao_social, '') LIKE ?
                        OR COALESCE(l.acao, '') LIKE ?
                        OR COALESCE(l.detalhes, '') LIKE ?
                        OR COALESCE(u.usuario, '') LIKE ?
                    )`;
                const termo = `%${busca}%`;
                params.push(termo, termo, termo, termo, termo, termo);
            }

            const [rows] = await pool.query(
                `SELECT
                    l.id,
                    l.empresa_id,
                    l.cobranca_id,
                    l.acao,
                    l.detalhes,
                    l.criado_em,
                    COALESCE(
                        e.nome_fantasia,
                        e.nome_provedor,
                        e.razao_social,
                        CONCAT('Empresa ', e.id)
                    ) AS empresa_nome,
                    COALESCE(u.usuario, 'Automático / Asaas') AS usuario_nome,
                    c.competencia,
                    c.valor,
                    c.valor_pago,
                    c.status_interno
                 FROM empresa_financeiro_logs l
                 INNER JOIN empresa e ON e.id = l.empresa_id
                 LEFT JOIN usuarios u ON u.id = l.usuario_id
                 LEFT JOIN empresa_cobrancas c ON c.id = l.cobranca_id
                 WHERE DATE(l.criado_em) BETWEEN ? AND ?
                   ${filtroBusca}
                 ORDER BY l.criado_em DESC, l.id DESC
                 LIMIT 1000`,
                params
            );

            return res.json({ periodo, logs: rows });
        } catch (erro) {
            console.error('Erro ao listar logs financeiros SGOS:', erro);
            return res.status(500).json({
                erro: 'Erro ao listar os logs financeiros.'
            });
        }
    });

    return router;
};
