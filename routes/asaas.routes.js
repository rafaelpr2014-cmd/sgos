const express = require('express');
const asaas = require('../services/asaas.service');

module.exports = function criarRotasAsaas(pool) {
    const router = express.Router();

    function somenteEmpresa1(req, res, next) {
        if (!req.usuario) {
            return res.status(401).json({ erro: 'Não autenticado.' });
        }
        if (Number(req.usuario.empresa_id) !== 1) {
            return res.status(403).json({
                erro: 'Acesso exclusivo da administração SGOS.',
                codigo: 'ASAAS_APENAS_EMPRESA_1'
            });
        }
        next();
    }

    function nomeEmpresa(empresa) {
        return empresa.nome_fantasia || empresa.nome_provedor || empresa.razao_social ||
            empresa.nome_completo || `Empresa ${empresa.id}`;
    }

    function documentoEmpresa(empresa) {
        return asaas.normalizarDocumento(empresa.cnpj || empresa.cpf);
    }

    function mapearStatusInterno(statusAsaas) {
        const status = String(statusAsaas || '').toUpperCase();
        if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(status)) return 'PAGO';
        if (status === 'OVERDUE') return 'VENCIDO';
        if (['REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE'].includes(status)) return 'ESTORNADO';
        if (['DELETED', 'CANCELLED'].includes(status)) return 'REMOVIDO';
        return 'PENDENTE';
    }

    async function obterEmpresa(id) {
        const [rows] = await pool.query('SELECT * FROM empresa WHERE id = ? LIMIT 1', [id]);
        return rows[0] || null;
    }

    async function registrarLog({ empresaId, cobrancaId = null, usuarioId, acao, detalhes = null }) {
        await pool.query(
            `INSERT INTO empresa_financeiro_logs
             (empresa_id, cobranca_id, usuario_id, acao, detalhes, criado_em)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [empresaId, cobrancaId, usuarioId || null, acao, detalhes]
        );
    }

    async function sincronizarClienteEmpresa(empresaId, usuarioId) {
        const empresa = await obterEmpresa(empresaId);
        if (!empresa) {
            const erro = new Error('Empresa não encontrada.');
            erro.status = 404;
            throw erro;
        }

        const documento = documentoEmpresa(empresa);
        if (![11, 14].includes(documento.length)) {
            const erro = new Error('Cadastre um CPF ou CNPJ válido antes de sincronizar com o Asaas.');
            erro.status = 400;
            throw erro;
        }

        const payload = {
            name: nomeEmpresa(empresa),
            cpfCnpj: documento,
            email: empresa.email || undefined,
            mobilePhone: asaas.normalizarTelefone(empresa.telefone) || undefined,
            externalReference: `SGOS_EMPRESA_${empresa.id}`,
            notificationDisabled: false
        };

        let cliente;
        if (empresa.asaas_customer_id) {
            try {
                cliente = await asaas.atualizarCliente(empresa.asaas_customer_id, payload);
            } catch (erro) {
                if (erro.status !== 404) throw erro;
            }
        }

        if (!cliente) {
            const encontrados = await asaas.localizarClientes({ externalReference: payload.externalReference, limit: 1 });
            cliente = Array.isArray(encontrados?.data) ? encontrados.data[0] : null;
        }

        if (!cliente) {
            cliente = await asaas.criarCliente(payload);
        }

        await pool.query(
            `UPDATE empresa
             SET asaas_customer_id = ?, asaas_sincronizado_em = NOW()
             WHERE id = ?`,
            [cliente.id, empresa.id]
        );

        await registrarLog({
            empresaId: empresa.id,
            usuarioId,
            acao: 'CLIENTE_ASAAS_SINCRONIZADO',
            detalhes: JSON.stringify({ asaas_customer_id: cliente.id })
        });

        return { empresa, cliente };
    }

    router.use(somenteEmpresa1);

    router.get('/configuracao', (req, res) => {
        try {
            const config = asaas.getConfig();
            return res.json({ configurado: true, ambiente: config.ambiente, api_url: config.baseURL });
        } catch (erro) {
            return res.json({ configurado: false, ambiente: process.env.ASAAS_ENV || 'sandbox', erro: erro.message });
        }
    });

    router.get('/empresas', async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT e.*,
                       COUNT(c.id) AS total_cobrancas,
                       SUM(CASE WHEN c.status_interno = 'PAGO' THEN 1 ELSE 0 END) AS cobrancas_pagas,
                       SUM(CASE WHEN c.status_interno = 'VENCIDO' THEN 1 ELSE 0 END) AS cobrancas_vencidas
                FROM empresa e
                LEFT JOIN empresa_cobrancas c ON c.empresa_id = e.id
                GROUP BY e.id
                ORDER BY e.id DESC
            `);
            res.json(rows);
        } catch (erro) {
            console.error('Erro ao listar empresas no financeiro Asaas:', erro);
            res.status(500).json({ erro: 'Erro ao listar empresas.' });
        }
    });

    router.post('/empresas/:id/sincronizar', async (req, res) => {
        try {
            const resultado = await sincronizarClienteEmpresa(req.params.id, req.usuario.id);
            res.json({ sucesso: true, customer: resultado.cliente });
        } catch (erro) {
            console.error('Erro ao sincronizar cliente Asaas:', erro.detalhes || erro);
            res.status(erro.status || 500).json({ erro: erro.message, detalhes: erro.detalhes || null });
        }
    });

    router.get('/cobrancas', async (req, res) => {
        try {
            const empresaId = Number(req.query.empresa_id || 0);
            if (!empresaId) return res.status(400).json({ erro: 'empresa_id é obrigatório.' });

            const [rows] = await pool.query(
                `SELECT * FROM empresa_cobrancas
                 WHERE empresa_id = ?
                 ORDER BY vencimento DESC, id DESC`,
                [empresaId]
            );
            res.json(rows);
        } catch (erro) {
            console.error('Erro ao listar cobranças:', erro);
            res.status(500).json({ erro: 'Erro ao listar cobranças.' });
        }
    });

    router.post('/cobrancas', async (req, res) => {
        const empresaId = Number(req.body.empresa_id || 0);
        const valor = Number(req.body.valor || 0);
        const vencimento = String(req.body.vencimento || '').trim();
        const competencia = String(req.body.competencia || '').trim();
        const descricao = String(req.body.descricao || '').trim() || `Mensalidade SGOS ${competencia}`;

        if (!empresaId || !Number.isFinite(valor) || valor <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
            return res.status(400).json({ erro: 'Empresa, valor e vencimento válido são obrigatórios.' });
        }

        try {
            const { empresa, cliente } = await sincronizarClienteEmpresa(empresaId, req.usuario.id);
            const externalReference = `SGOS-${empresa.id}-${competencia || vencimento.slice(0, 7)}-${Date.now()}`;

            const cobrancaAsaas = await asaas.criarCobranca({
                customer: cliente.id,
                billingType: 'BOLETO',
                value: Number(valor.toFixed(2)),
                dueDate: vencimento,
                description: descricao,
                externalReference
            });

            const [resultado] = await pool.query(`
                INSERT INTO empresa_cobrancas (
                    empresa_id, asaas_payment_id, asaas_customer_id,
                    external_reference, competencia, descricao, valor,
                    vencimento, billing_type, status_asaas, status_interno,
                    invoice_url, bank_slip_url, criado_por, criado_em, atualizado_em
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [
                empresa.id,
                cobrancaAsaas.id,
                cliente.id,
                externalReference,
                competencia || vencimento.slice(0, 7),
                descricao,
                valor,
                vencimento,
                cobrancaAsaas.billingType || 'BOLETO',
                cobrancaAsaas.status || 'PENDING',
                mapearStatusInterno(cobrancaAsaas.status),
                cobrancaAsaas.invoiceUrl || null,
                cobrancaAsaas.bankSlipUrl || null,
                req.usuario.id
            ]);

            await registrarLog({
                empresaId: empresa.id,
                cobrancaId: resultado.insertId,
                usuarioId: req.usuario.id,
                acao: 'COBRANCA_CRIADA',
                detalhes: JSON.stringify({ payment_id: cobrancaAsaas.id, valor, vencimento })
            });

            res.status(201).json({ sucesso: true, id: resultado.insertId, cobranca: cobrancaAsaas });
        } catch (erro) {
            console.error('Erro ao criar cobrança Asaas:', erro.detalhes || erro);
            res.status(erro.status || 500).json({ erro: erro.message, detalhes: erro.detalhes || null });
        }
    });

    router.get('/cobrancas/:id/sincronizar', async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM empresa_cobrancas WHERE id = ? LIMIT 1', [req.params.id]);
            if (!rows.length) return res.status(404).json({ erro: 'Cobrança não encontrada.' });

            const local = rows[0];
            const remoto = await asaas.consultarCobranca(local.asaas_payment_id);
            await pool.query(`
                UPDATE empresa_cobrancas SET
                    valor = ?, vencimento = ?, status_asaas = ?, status_interno = ?,
                    invoice_url = ?, bank_slip_url = ?, atualizado_em = NOW()
                WHERE id = ?
            `, [
                remoto.value ?? local.valor,
                remoto.dueDate ?? local.vencimento,
                remoto.status || local.status_asaas,
                mapearStatusInterno(remoto.status),
                remoto.invoiceUrl || local.invoice_url,
                remoto.bankSlipUrl || local.bank_slip_url,
                local.id
            ]);

            res.json({ sucesso: true, cobranca: remoto });
        } catch (erro) {
            console.error('Erro ao sincronizar cobrança:', erro.detalhes || erro);
            res.status(erro.status || 500).json({ erro: erro.message, detalhes: erro.detalhes || null });
        }
    });

    router.put('/cobrancas/:id', async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM empresa_cobrancas WHERE id = ? LIMIT 1', [req.params.id]);
            if (!rows.length) return res.status(404).json({ erro: 'Cobrança não encontrada.' });
            const local = rows[0];

            const dados = {};
            if (req.body.valor !== undefined) {
                const valor = Number(req.body.valor);
                if (!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ erro: 'Valor inválido.' });
                dados.value = Number(valor.toFixed(2));
            }
            if (req.body.vencimento !== undefined) {
                const vencimento = String(req.body.vencimento || '');
                if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return res.status(400).json({ erro: 'Vencimento inválido.' });
                dados.dueDate = vencimento;
            }
            if (req.body.descricao !== undefined) dados.description = String(req.body.descricao || '').trim();
            if (!Object.keys(dados).length) return res.status(400).json({ erro: 'Nenhuma alteração informada.' });

            const remoto = await asaas.atualizarCobranca(local.asaas_payment_id, dados);
            await pool.query(`
                UPDATE empresa_cobrancas SET
                    valor = ?, vencimento = ?, descricao = ?, status_asaas = ?, status_interno = ?,
                    invoice_url = ?, bank_slip_url = ?, atualizado_em = NOW()
                WHERE id = ?
            `, [
                remoto.value ?? local.valor,
                remoto.dueDate ?? local.vencimento,
                remoto.description ?? local.descricao,
                remoto.status || local.status_asaas,
                mapearStatusInterno(remoto.status),
                remoto.invoiceUrl || local.invoice_url,
                remoto.bankSlipUrl || local.bank_slip_url,
                local.id
            ]);

            await registrarLog({
                empresaId: local.empresa_id,
                cobrancaId: local.id,
                usuarioId: req.usuario.id,
                acao: 'COBRANCA_ATUALIZADA',
                detalhes: JSON.stringify(dados)
            });

            res.json({ sucesso: true, cobranca: remoto });
        } catch (erro) {
            console.error('Erro ao atualizar cobrança:', erro.detalhes || erro);
            res.status(erro.status || 500).json({ erro: erro.message, detalhes: erro.detalhes || null });
        }
    });

    router.delete('/cobrancas/:id', async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM empresa_cobrancas WHERE id = ? LIMIT 1', [req.params.id]);
            if (!rows.length) return res.status(404).json({ erro: 'Cobrança não encontrada.' });
            const local = rows[0];

            await asaas.removerCobranca(local.asaas_payment_id);
            await pool.query(`
                UPDATE empresa_cobrancas SET
                    status_asaas = 'DELETED', status_interno = 'REMOVIDO',
                    removido_por = ?, removido_em = NOW(), atualizado_em = NOW()
                WHERE id = ?
            `, [req.usuario.id, local.id]);

            await registrarLog({
                empresaId: local.empresa_id,
                cobrancaId: local.id,
                usuarioId: req.usuario.id,
                acao: 'COBRANCA_REMOVIDA',
                detalhes: String(req.body?.motivo || 'Removida pelo painel SGOS')
            });

            res.json({ sucesso: true });
        } catch (erro) {
            console.error('Erro ao remover cobrança:', erro.detalhes || erro);
            res.status(erro.status || 500).json({ erro: erro.message, detalhes: erro.detalhes || null });
        }
    });

    return router;
};
