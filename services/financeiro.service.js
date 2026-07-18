'use strict';
module.exports = function criarFinanceiroService(pool) {
  const txt = (v, max = 1000) => String(v ?? '').trim().slice(0, max);
  const ip = req => txt(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '', 64).split(',')[0].trim() || null;
  const formas = ['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'cheque'];

  async function permitido(ctx, escritorioId) {
    if (ctx.admin) {
      const [[r]] = await pool.query('SELECT id,nome FROM escritorios WHERE id=? AND empresa_id=? AND ativo=1', [escritorioId, ctx.empresaId]);
      return r || null;
    }
    const [[r]] = await pool.query(`SELECT e.id,e.nome FROM escritorios e
      JOIN escritorio_usuarios eu ON eu.escritorio_id=e.id AND eu.empresa_id=e.empresa_id
      WHERE e.id=? AND e.empresa_id=? AND e.ativo=1 AND eu.usuario_id=? LIMIT 1`, [escritorioId, ctx.empresaId, ctx.usuarioId]);
    return r || null;
  }

  function filtros(ctx, q = {}, alias = 'm', incluirCancelados = false) {
    const f = [`${alias}.empresa_id=?`];
    const p = [ctx.empresaId];
    if (!incluirCancelados) f.push(`${alias}.ativo=1`);
    if (!ctx.admin) {
      f.push(`EXISTS (SELECT 1 FROM escritorio_usuarios eu WHERE eu.empresa_id=${alias}.empresa_id AND eu.escritorio_id=${alias}.escritorio_id AND eu.usuario_id=?)`);
      p.push(ctx.usuarioId);
    }
    if (q.escritorio_id) { f.push(`${alias}.escritorio_id=?`); p.push(Number(q.escritorio_id)); }
    const tipos = txt(q.tipos || q.tipo, 30).split(',').filter(x => ['entrada', 'saida'].includes(x));
    if (tipos.length === 1) { f.push(`${alias}.tipo=?`); p.push(tipos[0]); }
    if (q.forma_pagamento && formas.includes(q.forma_pagamento)) { f.push(`${alias}.forma_pagamento=?`); p.push(q.forma_pagamento); }
    const campoData = q.data_referencia === 'atualizado_em' ? `${alias}.atualizado_em` : `${alias}.criado_em`;
    if (q.data_inicio) { f.push(`DATE(${campoData})>=?`); p.push(q.data_inicio); }
    if (q.data_fim) { f.push(`DATE(${campoData})<=?`); p.push(q.data_fim); }
    if (q.busca) {
      const l = `%${txt(q.busca, 100)}%`;
      f.push(`(${alias}.descricao LIKE ? OR ${alias}.observacao LIKE ? OR ${alias}.destinatario_nome LIKE ? OR ${alias}.criado_por_nome LIKE ?)`);
      p.push(l, l, l, l);
    }
    return { where: f.join(' AND '), params: p };
  }

  async function resumo(ctx, q) {
    const { where, params } = filtros(ctx, q, 'm');
    const [[r]] = await pool.query(`SELECT COUNT(*) total_lancamentos,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) entradas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) saidas,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) saldo_atual
      FROM financeiro_movimentacoes m WHERE ${where}`, params);
    return r;
  }

  async function listar(ctx, q) {
    const incluir = String(q.incluir_cancelados || '') === '1';
    const { where, params } = filtros(ctx, q, 'm', incluir);
    const [rows] = await pool.query(`SELECT m.*,e.nome escritorio_nome
      FROM financeiro_movimentacoes m
      JOIN escritorios e ON e.id=m.escritorio_id AND e.empresa_id=m.empresa_id
      WHERE ${where} ORDER BY m.criado_em DESC,m.id DESC LIMIT 5000`, params);
    return rows;
  }

  async function obter(ctx, id) {
    const [rows] = await pool.query('SELECT * FROM financeiro_movimentacoes WHERE id=? AND empresa_id=? LIMIT 1', [id, ctx.empresaId]);
    if (!rows.length) throw Object.assign(new Error('Lançamento não encontrado.'), { statusCode: 404 });
    if (!await permitido(ctx, rows[0].escritorio_id)) throw Object.assign(new Error('Sem acesso ao lançamento.'), { statusCode: 403 });
    return rows[0];
  }

  async function fluxo(ctx, q) {
    const agrup = ['diario', 'semanal', 'mensal'].includes(q.agrupamento) ? q.agrupamento : 'diario';
    const { where, params } = filtros(ctx, q, 'm');
    const chave = agrup === 'mensal' ? "DATE_FORMAT(m.criado_em,'%Y-%m')" : agrup === 'semanal' ? "DATE_FORMAT(DATE_SUB(DATE(m.criado_em),INTERVAL WEEKDAY(m.criado_em) DAY),'%Y-%m-%d')" : "DATE_FORMAT(m.criado_em,'%Y-%m-%d')";
    const [rows] = await pool.query(`SELECT ${chave} periodo,
      SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) entradas,
      SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END) saidas,
      SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END) saldo
      FROM financeiro_movimentacoes m WHERE ${where} GROUP BY periodo ORDER BY periodo`, params);
    return rows;
  }

  async function auxiliares(ctx) {
    const [usuarios] = await pool.query('SELECT id,usuario,cargo FROM usuarios WHERE empresa_id=? AND ativo=1 ORDER BY usuario', [ctx.empresaId]);
    const [produtos] = await pool.query('SELECT id,nome,codigo,localidade,quantidade,unidade_medida FROM estoque_produtos WHERE empresa_id=? AND ativo=1 ORDER BY nome', [ctx.empresaId]).catch(() => [[]]);
    return { usuarios, produtos, formas_pagamento: formas };
  }

  async function salvar(ctx, req, id) {
    const b = req.body || {};
    const escritorioId = Number(b.escritorio_id);
    const tipo = txt(b.tipo, 10);
    const valor = Number(b.valor);
    const forma = txt(b.forma_pagamento, 30);
    const descricao = txt(b.descricao, 255);
    const observacao = txt(b.observacao, 5000) || null;
    if (!escritorioId || !['entrada', 'saida'].includes(tipo) || !Number.isFinite(valor) || valor <= 0 || !descricao || !formas.includes(forma)) {
      throw Object.assign(new Error('Preencha escritório, tipo, valor, forma de pagamento e descrição.'), { statusCode: 400 });
    }
    if (!await permitido(ctx, escritorioId)) throw Object.assign(new Error('Sem acesso ao escritório.'), { statusCode: 403 });

    const destinatarioId = b.destinatario_usuario_id ? Number(b.destinatario_usuario_id) : null;
    let destinatarioNome = null;
    if (destinatarioId) {
      const [[u]] = await pool.query('SELECT usuario FROM usuarios WHERE id=? AND empresa_id=? AND ativo=1', [destinatarioId, ctx.empresaId]);
      if (!u) throw Object.assign(new Error('Destinatário inválido.'), { statusCode: 400 });
      destinatarioNome = u.usuario;
    }
    const produtoId = b.estoque_produto_id ? Number(b.estoque_produto_id) : null;
    let produtoNome = null;
    if (produtoId) {
      const [[p]] = await pool.query('SELECT nome FROM estoque_produtos WHERE id=? AND empresa_id=? AND ativo=1', [produtoId, ctx.empresaId]);
      if (!p) throw Object.assign(new Error('Item do estoque inválido.'), { statusCode: 400 });
      produtoNome = p.nome;
    }
    if (tipo === 'entrada' && produtoId) throw Object.assign(new Error('Estoque só pode ser vinculado a saídas.'), { statusCode: 400 });
    const qtd = b.estoque_quantidade ? Number(b.estoque_quantidade) : null;
    if (qtd != null && (!Number.isFinite(qtd) || qtd <= 0)) throw Object.assign(new Error('Quantidade inválida.'), { statusCode: 400 });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let movId = Number(id) || 0;
      let anterior = null;
      let anexo = req.file ? `/uploads/financeiro/${req.file.filename}` : null;
      let anexoNome = req.file?.originalname || null;
      let anexoMime = req.file?.mimetype || null;
      if (movId) {
        const [rows] = await conn.query('SELECT * FROM financeiro_movimentacoes WHERE id=? AND empresa_id=? FOR UPDATE', [movId, ctx.empresaId]);
        if (!rows.length) throw Object.assign(new Error('Lançamento não encontrado.'), { statusCode: 404 });
        anterior = rows[0];
        if (!await permitido(ctx, anterior.escritorio_id)) throw Object.assign(new Error('Sem acesso ao lançamento.'), { statusCode: 403 });
        if (!anexo) { anexo = anterior.anexo; anexoNome = anterior.anexo_nome; anexoMime = anterior.anexo_mime; }
        await conn.query(`UPDATE financeiro_movimentacoes SET escritorio_id=?,tipo=?,valor=?,forma_pagamento=?,descricao=?,observacao=?,anexo=?,anexo_nome=?,anexo_mime=?,destinatario_usuario_id=?,destinatario_nome=?,estoque_produto_id=?,estoque_produto_nome=?,estoque_quantidade=?,atualizado_por=?,atualizado_por_nome=?,atualizado_em=NOW() WHERE id=? AND empresa_id=?`,
          [escritorioId, tipo, valor, forma, descricao, observacao, anexo, anexoNome, anexoMime, destinatarioId, destinatarioNome, produtoId, produtoNome, qtd, ctx.usuarioId, ctx.usuarioNome, movId, ctx.empresaId]);
      } else {
        const [r] = await conn.query(`INSERT INTO financeiro_movimentacoes (empresa_id,escritorio_id,tipo,valor,forma_pagamento,descricao,observacao,anexo,anexo_nome,anexo_mime,destinatario_usuario_id,destinatario_nome,estoque_produto_id,estoque_produto_nome,estoque_quantidade,criado_por,criado_por_nome,criado_em,ativo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),1)`,
          [ctx.empresaId, escritorioId, tipo, valor, forma, descricao, observacao, anexo, anexoNome, anexoMime, destinatarioId, destinatarioNome, produtoId, produtoNome, qtd, ctx.usuarioId, ctx.usuarioNome]);
        movId = r.insertId;
      }
      const [[novo]] = await conn.query('SELECT * FROM financeiro_movimentacoes WHERE id=?', [movId]);
      await conn.query(`INSERT INTO financeiro_logs (empresa_id,escritorio_id,movimentacao_id,acao,usuario_id,usuario_nome,descricao,dados_anteriores,dados_novos,ip_origem,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
        [ctx.empresaId, escritorioId, movId, anterior ? 'editado' : 'criado', ctx.usuarioId, ctx.usuarioNome, `${anterior ? 'Editou' : 'Criou'} ${tipo} de R$ ${valor.toFixed(2)} - ${descricao}`, anterior ? JSON.stringify(anterior) : null, JSON.stringify(novo), ip(req)]);
      await conn.commit();
      return { sucesso: true, id: movId };
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async function excluir(ctx, req, id) {
    const motivo = txt(req.body?.motivo_exclusao, 500);
    if (!motivo) throw Object.assign(new Error('Informe o motivo.'), { statusCode: 400 });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT * FROM financeiro_movimentacoes WHERE id=? AND empresa_id=? AND ativo=1 FOR UPDATE', [id, ctx.empresaId]);
      if (!rows.length) throw Object.assign(new Error('Lançamento não encontrado.'), { statusCode: 404 });
      const mov = rows[0];
      if (!await permitido(ctx, mov.escritorio_id)) throw Object.assign(new Error('Sem acesso.'), { statusCode: 403 });
      await conn.query('UPDATE financeiro_movimentacoes SET ativo=0,excluido_por=?,excluido_por_nome=?,excluido_em=NOW(),motivo_exclusao=? WHERE id=? AND empresa_id=?', [ctx.usuarioId, ctx.usuarioNome, motivo, id, ctx.empresaId]);
      await conn.query(`INSERT INTO financeiro_logs (empresa_id,escritorio_id,movimentacao_id,acao,usuario_id,usuario_nome,descricao,dados_anteriores,ip_origem,criado_em) VALUES (?,?,?,?,?,?,?,?,?,NOW())`, [ctx.empresaId, mov.escritorio_id, id, 'excluido', ctx.usuarioId, ctx.usuarioNome, `Excluiu lançamento: ${motivo}`, JSON.stringify(mov), ip(req)]);
      await conn.commit();
      return { sucesso: true };
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async function logs(ctx, q) {
    const f = ['l.empresa_id=?']; const p = [ctx.empresaId];
    if (!ctx.admin) { f.push('EXISTS (SELECT 1 FROM escritorio_usuarios eu WHERE eu.empresa_id=l.empresa_id AND eu.escritorio_id=l.escritorio_id AND eu.usuario_id=?)'); p.push(ctx.usuarioId); }
    if (q.escritorio_id) { f.push('l.escritorio_id=?'); p.push(Number(q.escritorio_id)); }
    if (q.data_inicio) { f.push('DATE(l.criado_em)>=?'); p.push(q.data_inicio); }
    if (q.data_fim) { f.push('DATE(l.criado_em)<=?'); p.push(q.data_fim); }
    const [rows] = await pool.query(`SELECT l.*,e.nome escritorio_nome FROM financeiro_logs l LEFT JOIN escritorios e ON e.id=l.escritorio_id WHERE ${f.join(' AND ')} ORDER BY l.id DESC LIMIT 5000`, p);
    return rows;
  }

  return { resumo, listar, obter, fluxo, auxiliares, salvar, excluir, logs };
};
