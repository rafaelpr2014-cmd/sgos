const express = require('express');
const router = express.Router();

/*
 * Ajuste somente esta importação caso o pool do SGOS esteja em outro caminho.
 * O módulo espera um pool mysql2/promise com pool.query() e pool.getConnection().
 */
const pool = require('../config/db');

function getEmpresaId(req) {
  return Number(req.user?.empresa_id || req.session?.user?.empresa_id || req.session?.usuario?.empresa_id || 0);
}

function getUsuarioId(req) {
  return Number(req.user?.id || req.session?.user?.id || req.session?.usuario?.id || 0);
}

function getUsuarioNome(req) {
  return String(req.user?.usuario || req.session?.user?.usuario || req.session?.usuario?.usuario || 'Sistema');
}

function getCargo(req) {
  return String(req.user?.cargo || req.session?.user?.cargo || req.session?.usuario?.cargo || '').toLowerCase();
}

function somenteAdmin(req, res, next) {
  if (getCargo(req) !== 'administrador') {
    return res.status(403).json({ erro: 'Acesso permitido apenas para administradores.' });
  }
  next();
}

function normalizarIds(valor) {
  const lista = Array.isArray(valor) ? valor : [];
  return [...new Set(lista.map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 3);
}

async function criarLembretesEstoqueBaixo(conn, empresaId, produto) {
  if (Number(produto.quantidade) > Number(produto.estoque_minimo)) return;

  const titulo = `Estoque baixo: ${produto.nome}`;
  const mensagem = `${produto.nome} está com ${produto.quantidade} unidade(s). Estoque mínimo configurado: ${produto.estoque_minimo}.`;

  const [admins] = await conn.query(
    `SELECT id
       FROM usuarios
      WHERE empresa_id = ?
        AND LOWER(cargo) = 'administrador'
        AND ativo = 1`,
    [empresaId]
  );

  for (const admin of admins) {
    const [existente] = await conn.query(
      `SELECT id
         FROM lembretes
        WHERE empresa_id = ?
          AND destinatario_id = ?
          AND origem = 'estoque'
          AND referencia_id = ?
          AND lido = 0
          AND criado_em >= DATE_SUB(NOW(), INTERVAL 12 HOUR)
        LIMIT 1`,
      [empresaId, admin.id, produto.id]
    ).catch(() => [[]]);

    if (existente.length) continue;

    await conn.query(
      `INSERT INTO lembretes
        (empresa_id, titulo, mensagem, destinatario_id, remetente_id, origem, referencia_id, lido, criado_em)
       VALUES (?, ?, ?, ?, NULL, 'estoque', ?, 0, NOW())`,
      [empresaId, titulo, mensagem, admin.id, produto.id]
    ).catch(() => null);
  }
}

router.get('/resumo', somenteAdmin, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const [[resumo]] = await pool.query(
      `SELECT
          COUNT(*) AS total_produtos,
          COALESCE(SUM(quantidade), 0) AS total_unidades,
          SUM(CASE WHEN quantidade <= estoque_minimo THEN 1 ELSE 0 END) AS estoque_baixo,
          SUM(CASE WHEN quantidade = 0 THEN 1 ELSE 0 END) AS sem_estoque
       FROM estoque_produtos
       WHERE empresa_id = ? AND ativo = 1`,
      [empresaId]
    );

    const [alertas] = await pool.query(
      `SELECT id, nome, quantidade, estoque_minimo, unidade_medida, localidade
         FROM estoque_produtos
        WHERE empresa_id = ?
          AND ativo = 1
          AND quantidade <= estoque_minimo
        ORDER BY quantidade ASC, nome ASC`,
      [empresaId]
    );

    res.json({ resumo, alertas });
  } catch (error) {
    console.error('Erro resumo estoque:', error);
    res.status(500).json({ erro: 'Erro ao carregar resumo do estoque.' });
  }
});

router.get('/produtos', somenteAdmin, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const termo = String(req.query.busca || '').trim();
    const localidade = String(req.query.localidade || '').trim();
    const somenteBaixo = String(req.query.estoque_baixo || '') === '1';

    const filtros = ['p.empresa_id = ?', 'p.ativo = 1'];
    const params = [empresaId];

    if (termo) {
      filtros.push('(p.nome LIKE ? OR p.codigo LIKE ? OR p.categoria LIKE ? OR p.localidade LIKE ?)');
      const like = `%${termo}%`;
      params.push(like, like, like, like);
    }
    if (localidade) {
      filtros.push('p.localidade = ?');
      params.push(localidade);
    }
    if (somenteBaixo) filtros.push('p.quantidade <= p.estoque_minimo');

    const [produtos] = await pool.query(
      `SELECT p.*,
              u.usuario AS cadastrado_por_nome,
              CASE
                WHEN p.quantidade = 0 THEN 'sem_estoque'
                WHEN p.quantidade <= p.estoque_minimo THEN 'baixo'
                ELSE 'normal'
              END AS nivel_estoque
         FROM estoque_produtos p
         LEFT JOIN usuarios u ON u.id = p.cadastrado_por
        WHERE ${filtros.join(' AND ')}
        ORDER BY p.nome ASC`,
      params
    );

    res.json(produtos);
  } catch (error) {
    console.error('Erro listar produtos:', error);
    res.status(500).json({ erro: 'Erro ao listar produtos.' });
  }
});

router.post('/produtos', somenteAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const empresaId = getEmpresaId(req);
    const usuarioId = getUsuarioId(req);
    const {
      nome, codigo, categoria, unidade_medida = 'unidade', localidade,
      quantidade_inicial = 0, estoque_minimo = 5, observacao = ''
    } = req.body || {};

    if (!String(nome || '').trim()) return res.status(400).json({ erro: 'Informe o nome do produto.' });
    if (!String(localidade || '').trim()) return res.status(400).json({ erro: 'Informe a localidade.' });

    const quantidade = Math.max(0, Number(quantidade_inicial) || 0);
    const minimo = Math.max(0, Number(estoque_minimo) || 0);

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO estoque_produtos
        (empresa_id, nome, codigo, categoria, unidade_medida, localidade, quantidade, estoque_minimo, observacao, cadastrado_por, ativo, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [empresaId, String(nome).trim(), String(codigo || '').trim() || null, String(categoria || '').trim() || null,
       String(unidade_medida || 'unidade').trim(), String(localidade).trim(), quantidade, minimo,
       String(observacao || '').trim() || null, usuarioId]
    );

    if (quantidade > 0) {
      await conn.query(
        `INSERT INTO estoque_movimentacoes
          (empresa_id, produto_id, tipo, quantidade, quantidade_anterior, quantidade_atual, motivo, usuario_id, usuario_nome, criado_em)
         VALUES (?, ?, 'entrada', ?, 0, ?, 'Estoque inicial', ?, ?, NOW())`,
        [empresaId, result.insertId, quantidade, quantidade, usuarioId, getUsuarioNome(req)]
      );
    }

    const produto = { id: result.insertId, nome: String(nome).trim(), quantidade, estoque_minimo: minimo };
    await criarLembretesEstoqueBaixo(conn, empresaId, produto);
    await conn.commit();
    res.status(201).json({ sucesso: true, id: result.insertId });
  } catch (error) {
    await conn.rollback();
    console.error('Erro cadastrar produto:', error);
    res.status(500).json({ erro: error.code === 'ER_DUP_ENTRY' ? 'Já existe produto com esse código.' : 'Erro ao cadastrar produto.' });
  } finally {
    conn.release();
  }
});

router.put('/produtos/:id', somenteAdmin, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const id = Number(req.params.id);
    const { nome, codigo, categoria, unidade_medida, localidade, estoque_minimo, observacao } = req.body || {};

    if (!String(nome || '').trim()) return res.status(400).json({ erro: 'Informe o nome do produto.' });
    if (!String(localidade || '').trim()) return res.status(400).json({ erro: 'Informe a localidade.' });

    const [result] = await pool.query(
      `UPDATE estoque_produtos
          SET nome = ?, codigo = ?, categoria = ?, unidade_medida = ?, localidade = ?, estoque_minimo = ?, observacao = ?, atualizado_em = NOW()
        WHERE id = ? AND empresa_id = ? AND ativo = 1`,
      [String(nome).trim(), String(codigo || '').trim() || null, String(categoria || '').trim() || null,
       String(unidade_medida || 'unidade').trim(), String(localidade).trim(), Math.max(0, Number(estoque_minimo) || 0),
       String(observacao || '').trim() || null, id, empresaId]
    );

    if (!result.affectedRows) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json({ sucesso: true });
  } catch (error) {
    console.error('Erro editar produto:', error);
    res.status(500).json({ erro: 'Erro ao editar produto.' });
  }
});

router.post('/movimentacoes', somenteAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const empresaId = getEmpresaId(req);
    const usuarioId = getUsuarioId(req);
    const { produto_id, tipo, quantidade, motivo, observacao, tecnicos_ids } = req.body || {};
    const produtoId = Number(produto_id);
    const qtd = Number(quantidade);
    const movimento = String(tipo || '').toLowerCase();
    const tecnicos = normalizarIds(tecnicos_ids);

    if (!['entrada', 'saida', 'ajuste'].includes(movimento)) return res.status(400).json({ erro: 'Tipo de movimentação inválido.' });
    if (!produtoId || !Number.isFinite(qtd) || qtd <= 0) return res.status(400).json({ erro: 'Informe uma quantidade válida.' });
    if (movimento === 'saida' && tecnicos.length === 0) return res.status(400).json({ erro: 'Selecione ao menos um técnico destinatário.' });

    await conn.beginTransaction();
    const [produtos] = await conn.query(
      `SELECT * FROM estoque_produtos WHERE id = ? AND empresa_id = ? AND ativo = 1 FOR UPDATE`,
      [produtoId, empresaId]
    );
    if (!produtos.length) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Produto não encontrado.' });
    }

    const produto = produtos[0];
    const anterior = Number(produto.quantidade);
    let atual;
    if (movimento === 'entrada') atual = anterior + qtd;
    else if (movimento === 'saida') atual = anterior - qtd;
    else atual = qtd;

    if (atual < 0) {
      await conn.rollback();
      return res.status(400).json({ erro: `Estoque insuficiente. Disponível: ${anterior}.` });
    }

    await conn.query(
      `UPDATE estoque_produtos SET quantidade = ?, atualizado_em = NOW() WHERE id = ? AND empresa_id = ?`,
      [atual, produtoId, empresaId]
    );

    const [mov] = await conn.query(
      `INSERT INTO estoque_movimentacoes
        (empresa_id, produto_id, tipo, quantidade, quantidade_anterior, quantidade_atual, motivo, observacao, usuario_id, usuario_nome, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [empresaId, produtoId, movimento, qtd, anterior, atual,
       String(motivo || '').trim() || (movimento === 'entrada' ? 'Entrada de produto' : movimento === 'saida' ? 'Saída de produto' : 'Ajuste de estoque'),
       String(observacao || '').trim() || null, usuarioId, getUsuarioNome(req)]
    );

    if (tecnicos.length) {
      const [tecnicosValidos] = await conn.query(
        `SELECT id, nome FROM tecnicos WHERE empresa_id = ? AND id IN (?)`,
        [empresaId, tecnicos]
      );
      for (const tecnico of tecnicosValidos) {
        await conn.query(
          `INSERT INTO estoque_movimentacao_tecnicos (movimentacao_id, tecnico_id, tecnico_nome)
           VALUES (?, ?, ?)`,
          [mov.insertId, tecnico.id, tecnico.nome]
        );
      }
    }

    await criarLembretesEstoqueBaixo(conn, empresaId, {
      id: produto.id,
      nome: produto.nome,
      quantidade: atual,
      estoque_minimo: produto.estoque_minimo
    });

    await conn.commit();
    res.json({ sucesso: true, quantidade_atual: atual });
  } catch (error) {
    await conn.rollback();
    console.error('Erro movimentar estoque:', error);
    res.status(500).json({ erro: 'Erro ao registrar movimentação.' });
  } finally {
    conn.release();
  }
});

router.get('/movimentacoes', somenteAdmin, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { tipo, produto_id, data_inicio, data_fim, usuario, tecnico_id } = req.query;
    const filtros = ['m.empresa_id = ?'];
    const params = [empresaId];

    if (tipo && ['entrada', 'saida', 'ajuste'].includes(tipo)) { filtros.push('m.tipo = ?'); params.push(tipo); }
    if (produto_id) { filtros.push('m.produto_id = ?'); params.push(Number(produto_id)); }
    if (data_inicio) { filtros.push('DATE(m.criado_em) >= ?'); params.push(data_inicio); }
    if (data_fim) { filtros.push('DATE(m.criado_em) <= ?'); params.push(data_fim); }
    if (usuario) { filtros.push('m.usuario_nome LIKE ?'); params.push(`%${usuario}%`); }
    if (tecnico_id) { filtros.push('EXISTS (SELECT 1 FROM estoque_movimentacao_tecnicos mt2 WHERE mt2.movimentacao_id = m.id AND mt2.tecnico_id = ?)'); params.push(Number(tecnico_id)); }

    const [movimentacoes] = await pool.query(
      `SELECT m.*, p.nome AS produto_nome, p.codigo AS produto_codigo, p.localidade,
              GROUP_CONCAT(mt.tecnico_nome ORDER BY mt.tecnico_nome SEPARATOR ', ') AS tecnicos_nomes
         FROM estoque_movimentacoes m
         JOIN estoque_produtos p ON p.id = m.produto_id
         LEFT JOIN estoque_movimentacao_tecnicos mt ON mt.movimentacao_id = m.id
        WHERE ${filtros.join(' AND ')}
        GROUP BY m.id
        ORDER BY m.criado_em DESC
        LIMIT 2000`,
      params
    );

    res.json(movimentacoes);
  } catch (error) {
    console.error('Erro histórico estoque:', error);
    res.status(500).json({ erro: 'Erro ao carregar histórico.' });
  }
});

router.delete('/produtos/:id', somenteAdmin, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const id = Number(req.params.id);
    const [result] = await pool.query(
      `UPDATE estoque_produtos SET ativo = 0, atualizado_em = NOW() WHERE id = ? AND empresa_id = ?`,
      [id, empresaId]
    );
    if (!result.affectedRows) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json({ sucesso: true });
  } catch (error) {
    console.error('Erro inativar produto:', error);
    res.status(500).json({ erro: 'Erro ao remover produto.' });
  }
});

module.exports = router;
