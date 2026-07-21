const express = require('express');
const router = express.Router();

/*
  AJUSTE O CAMINHO ABAIXO PARA O ARQUIVO DE CONEXÃO DO SEU PROJETO.
  O objeto precisa expor pool.query(sql, params).
*/
const pool = require('../config/db');

const LIMITE_INATIVIDADE_MINUTOS = 5;

function usuarioSessao(req) {
  return req.usuario || req.user || req.session?.usuario || req.session?.user || null;
}

function exigirLogin(req, res, next) {
  const usuario = usuarioSessao(req);
  if (!usuario) return res.status(401).json({ erro: 'Sessão não autenticada.' });
  req.usuarioAtual = usuario;
  next();
}

function exigirEmpresa1(req, res, next) {
  const empresaId = Number(
    req.usuarioAtual?.empresa_id ??
    req.usuarioAtual?.empresaId ??
    req.session?.empresa_id
  );

  if (empresaId !== 1) {
    return res.status(403).json({ erro: 'Página disponível somente para administradores da empresa 1.' });
  }

  next();
}

function extrairIp(req) {
  const encaminhado = req.headers['x-forwarded-for'];
  return String(encaminhado ? encaminhado.split(',')[0] : req.socket?.remoteAddress || '')
    .trim()
    .replace(/^::ffff:/, '')
    .slice(0, 45);
}

async function marcarInativosOffline() {
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();

    const [inativos] = await conexao.query(`
      SELECT usuario_id, empresa_id, ip, user_agent
      FROM usuarios_presenca
      WHERE status = 'online'
        AND ultima_atividade < DATE_SUB(NOW(), INTERVAL ? MINUTE)
      FOR UPDATE
    `, [LIMITE_INATIVIDADE_MINUTOS]);

    if (inativos.length) {
      const ids = inativos.map(item => item.usuario_id);
      await conexao.query(`
        UPDATE usuarios_presenca
        SET status = 'offline', desconectado_em = NOW(), atualizado_em = NOW()
        WHERE usuario_id IN (?)
      `, [ids]);

      const valores = inativos.map(item => [
        item.usuario_id,
        item.empresa_id,
        'desconexao',
        item.ip || null,
        item.user_agent || null,
        'inatividade superior a 5 minutos'
      ]);

      await conexao.query(`
        INSERT INTO usuarios_conexao_logs
          (usuario_id, empresa_id, tipo, ip, user_agent, motivo)
        VALUES ?
      `, [valores]);
    }

    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

/*
  Chame esta função após um login concluído e também no ping já existente do auth.js.
  Ela mantém a sessão ativa, mas altera apenas o status visual online/offline.
*/
async function registrarPresenca(req, usuario) {
  const usuarioId = Number(usuario?.id || usuario?.usuario_id);
  const empresaId = Number(usuario?.empresa_id || usuario?.empresaId);
  if (!usuarioId || !empresaId) return;

  const ip = extrairIp(req);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
  const conexao = await pool.getConnection();

  try {
    await conexao.beginTransaction();

    const [presencas] = await conexao.query(
      'SELECT status FROM usuarios_presenca WHERE usuario_id = ? FOR UPDATE',
      [usuarioId]
    );

    const estavaOnline = presencas[0]?.status === 'online';

    await conexao.query(`
      INSERT INTO usuarios_presenca
        (usuario_id, empresa_id, status, conectado_em, ultima_atividade, ip, user_agent, atualizado_em)
      VALUES (?, ?, 'online', NOW(), NOW(), ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        empresa_id = VALUES(empresa_id),
        status = 'online',
        conectado_em = IF(status = 'offline', NOW(), conectado_em),
        ultima_atividade = NOW(),
        desconectado_em = NULL,
        ip = VALUES(ip),
        user_agent = VALUES(user_agent),
        atualizado_em = NOW()
    `, [usuarioId, empresaId, ip || null, userAgent || null]);

    if (!estavaOnline) {
      await conexao.query(`
        INSERT INTO usuarios_conexao_logs
          (usuario_id, empresa_id, tipo, ip, user_agent, motivo)
        VALUES (?, ?, 'conexao', ?, ?, 'login ou retorno de atividade')
      `, [usuarioId, empresaId, ip || null, userAgent || null]);
    }

    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

router.get('/acesso', exigirLogin, exigirEmpresa1, (req, res) => {
  res.json({
    permitido: true,
    usuario: {
      id: req.usuarioAtual.id || req.usuarioAtual.usuario_id,
      nome: req.usuarioAtual.nome || req.usuarioAtual.name || req.usuarioAtual.login
    }
  });
});

router.post('/ping', exigirLogin, async (req, res) => {
  try {
    await registrarPresenca(req, req.usuarioAtual);
    res.json({ ok: true, status: 'online' });
  } catch (erro) {
    console.error('Erro ao registrar presença:', erro);
    res.status(500).json({ erro: 'Não foi possível atualizar a presença.' });
  }
});

router.post('/logout', exigirLogin, async (req, res) => {
  const usuarioId = Number(req.usuarioAtual.id || req.usuarioAtual.usuario_id);
  const empresaId = Number(req.usuarioAtual.empresa_id || req.usuarioAtual.empresaId);
  try {
    const [presencas] = await pool.query(
      'SELECT status, ip, user_agent FROM usuarios_presenca WHERE usuario_id = ?',
      [usuarioId]
    );

    await pool.query(`
      UPDATE usuarios_presenca
      SET status = 'offline', desconectado_em = NOW(), atualizado_em = NOW()
      WHERE usuario_id = ?
    `, [usuarioId]);

    if (presencas[0]?.status === 'online') {
      await pool.query(`
        INSERT INTO usuarios_conexao_logs
          (usuario_id, empresa_id, tipo, ip, user_agent, motivo)
        VALUES (?, ?, 'desconexao', ?, ?, 'logout manual')
      `, [usuarioId, empresaId, presencas[0].ip || null, presencas[0].user_agent || null]);
    }

    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro ao registrar logout:', erro);
    res.status(500).json({ erro: 'Não foi possível registrar a desconexão.' });
  }
});

router.get('/usuarios', exigirLogin, exigirEmpresa1, async (req, res) => {
  try {
    await marcarInativosOffline();

    const [usuarios] = await pool.query(`
      SELECT
        u.id,
        u.nome,
        u.login,
        u.email,
        COALESCE(u.tipo, u.perfil, 'não informado') AS tipo,
        u.empresa_id,
        COALESCE(e.nome, e.razao_social, e.fantasia, CONCAT('Empresa ', u.empresa_id)) AS empresa_nome,
        COALESCE(p.status, 'offline') AS status,
        p.conectado_em,
        p.ultima_atividade,
        p.desconectado_em,
        p.ip,
        p.user_agent
      FROM usuarios u
      LEFT JOIN empresas e ON e.id = u.empresa_id
      LEFT JOIN usuarios_presenca p ON p.usuario_id = u.id
      WHERE COALESCE(u.ativo, 1) = 1
      ORDER BY
        CASE WHEN p.status = 'online' THEN 0 ELSE 1 END,
        empresa_nome,
        u.nome
    `);

    const empresas = new Set(usuarios.map(item => Number(item.empresa_id))).size;
    const online = usuarios.filter(item => item.status === 'online').length;

    res.json({
      usuarios,
      resumo: {
        total_usuarios: usuarios.length,
        online,
        offline: usuarios.length - online,
        empresas
      }
    });
  } catch (erro) {
    console.error('Erro ao listar usuários online:', erro);
    res.status(500).json({ erro: 'Erro ao carregar usuários e presença.' });
  }
});

router.get('/usuarios/:usuarioId/logs', exigirLogin, exigirEmpresa1, async (req, res) => {
  try {
    const usuarioId = Number(req.params.usuarioId);
    const limite = Math.min(Math.max(Number(req.query.limite) || 100, 1), 100);
    if (!usuarioId) return res.status(400).json({ erro: 'Usuário inválido.' });

    const [logs] = await pool.query(`
      SELECT id, usuario_id, empresa_id, tipo, ip, user_agent, motivo, ocorrido_em
      FROM usuarios_conexao_logs
      WHERE usuario_id = ?
      ORDER BY ocorrido_em DESC, id DESC
      LIMIT ?
    `, [usuarioId, limite]);

    res.json({ logs, limite });
  } catch (erro) {
    console.error('Erro ao carregar histórico do usuário:', erro);
    res.status(500).json({ erro: 'Erro ao carregar o histórico do usuário.' });
  }
});

/* Verifica inatividade mesmo sem a página administrativa aberta. */
const timerPresenca = setInterval(() => {
  marcarInativosOffline().catch(erro => console.error('Erro no verificador de presença:', erro));
}, 30000);

timerPresenca.unref?.();

module.exports = router;
module.exports.registrarPresenca = registrarPresenca;
module.exports.marcarInativosOffline = marcarInativosOffline;
