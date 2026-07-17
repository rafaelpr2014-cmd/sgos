const express = require('express');
const router = express.Router();

// SGOS: a conexão principal está em /root/sgos/database.js
const pool = require('../database');

async function executar(sql, params = []) {
    const [resultado] = await pool.query(sql, params);
    return resultado;
}

function obterUsuarioId(req) {
    return Number(
        req.user?.id ||
        req.usuario?.id ||
        req.session?.usuario?.id ||
        req.session?.usuario_id ||
        req.headers['x-usuario-id'] ||
        req.body?.usuario_id
    );
}

async function obterUsuario(usuarioId) {
    if (!usuarioId) return null;

    const rows = await executar(
        `SELECT id, usuario, empresa_id
           FROM usuarios
          WHERE id = ?
          LIMIT 1`,
        [usuarioId]
    );

    return rows[0] || null;
}

async function limparExpirados() {
    await executar(
        `DELETE FROM lembretes
          WHERE excluir_em IS NOT NULL
            AND excluir_em <= NOW()`
    );
}

router.get('/usuarios', async (req, res) => {
    try {
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);

        if (!usuario) {
            return res.status(401).json({ erro: 'Usuário não autenticado.' });
        }

        const usuarios = await executar(
            `SELECT id, usuario AS nome
               FROM usuarios
              WHERE empresa_id = ?
                AND id <> ?
              ORDER BY usuario ASC`,
            [usuario.empresa_id, usuario.id]
        );

        return res.json({ usuarios });
    } catch (erro) {
        console.error('Erro ao listar usuários para lembretes:', erro);
        return res.status(500).json({ erro: 'Erro ao carregar usuários.' });
    }
});

router.get('/me', async (req, res) => {
    try {
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);

        if (!usuario) {
            return res.status(401).json({ erro: 'Usuário não autenticado.' });
        }

        await limparExpirados();

        const lembretes = await executar(
            `SELECT l.id,
                    l.mensagem,
                    l.criado_em,
                    l.lido_em,
                    l.excluir_em,
                    l.criado_por_id,
                    COALESCE(NULLIF(u.usuario, ''), 'Usuário') AS criado_por_nome
               FROM lembretes l
               LEFT JOIN usuarios u ON u.id = l.criado_por_id
              WHERE l.empresa_id = ?
                AND l.destinatario_id = ?
                AND (l.excluir_em IS NULL OR l.excluir_em > NOW())
              ORDER BY (l.lido_em IS NULL) DESC, l.criado_em DESC`,
            [usuario.empresa_id, usuario.id]
        );

        return res.json({ lembretes });
    } catch (erro) {
        console.error('Erro ao buscar lembretes:', erro);
        return res.status(500).json({ erro: 'Erro ao carregar lembretes.' });
    }
});

router.post('/', async (req, res) => {
    try {
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);
        const destinatarioId = Number(req.body?.destinatario_id);
        const mensagem = String(req.body?.mensagem || '').trim();

        if (!usuario) {
            return res.status(401).json({ erro: 'Usuário não autenticado.' });
        }
        if (!destinatarioId) {
            return res.status(400).json({ erro: 'Selecione o usuário destinatário.' });
        }
        if (!mensagem) {
            return res.status(400).json({ erro: 'Digite o lembrete.' });
        }
        if (mensagem.length > 2000) {
            return res.status(400).json({ erro: 'O lembrete deve ter no máximo 2.000 caracteres.' });
        }
        if (destinatarioId === usuario.id) {
            return res.status(400).json({ erro: 'Selecione outro usuário.' });
        }

        const destinatario = await obterUsuario(destinatarioId);

        if (!destinatario || Number(destinatario.empresa_id) !== Number(usuario.empresa_id)) {
            return res.status(404).json({ erro: 'Usuário destinatário não encontrado nesta empresa.' });
        }

        const resultado = await executar(
            `INSERT INTO lembretes
                (empresa_id, destinatario_id, criado_por_id, mensagem, criado_em)
             VALUES (?, ?, ?, ?, NOW())`,
            [usuario.empresa_id, destinatario.id, usuario.id, mensagem]
        );

        return res.status(201).json({
            ok: true,
            id: resultado.insertId,
            mensagem: 'Lembrete enviado com sucesso.'
        });
    } catch (erro) {
        console.error('Erro ao criar lembrete:', erro);
        return res.status(500).json({ erro: 'Erro ao salvar lembrete.' });
    }
});

router.patch('/:id/lido', async (req, res) => {
    try {
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);
        const lembreteId = Number(req.params.id);

        if (!usuario) {
            return res.status(401).json({ erro: 'Usuário não autenticado.' });
        }
        if (!lembreteId) {
            return res.status(400).json({ erro: 'Lembrete inválido.' });
        }

        const resultado = await executar(
            `UPDATE lembretes
                SET lido_em = COALESCE(lido_em, NOW()),
                    excluir_em = COALESCE(excluir_em, DATE_ADD(NOW(), INTERVAL 30 DAY))
              WHERE id = ?
                AND empresa_id = ?
                AND destinatario_id = ?`,
            [lembreteId, usuario.empresa_id, usuario.id]
        );

        if (!resultado.affectedRows) {
            return res.status(404).json({ erro: 'Lembrete não encontrado.' });
        }

        return res.json({ ok: true, mensagem: 'Lembrete marcado como lido.' });
    } catch (erro) {
        console.error('Erro ao marcar lembrete como lido:', erro);
        return res.status(500).json({ erro: 'Erro ao atualizar lembrete.' });
    }
});

module.exports = router;
