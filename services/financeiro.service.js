'use strict';

module.exports = function criarFinanceiroService(pool) {
  const permitido = async (empresaId, usuarioId, admin, escritorioId) => {
    if (admin) {
      const [[r]] = await pool.query(`SELECT id,nome FROM escritorios WHERE id=? AND empresa_id=? AND ativo=1`, [escritorioId, empresaId]);
      return r || null;
    }
    const [[r]] = await pool.query(
      `SELECT e.id,e.nome FROM escritorios e JOIN escritorio_usuarios eu ON eu.escritorio_id=e.id AND eu.empresa_id=e.empresa_id
       WHERE e.id=? AND e.empresa_id=? AND e.ativo=1 AND eu.usuario_id=? LIMIT 1`, [escritorioId, empresaId, usuarioId]);
    return r || null;
  };
  const txt = (v, max=1000) => String(v ?? '').trim().slice(0,max);
  const ip = req => txt(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '', 64).split(',')[0].trim() || null;

  function filtrosConsulta({ empresaId, usuarioId, admin, q={}, alias='m', incluirCancelados=false }) {
    const f = [`${alias}.empresa_id=?`]; const p=[empresaId];
    if (!incluirCancelados) f.push(`${alias}.ativo=1`);
    if (!admin) {
      f.push(`EXISTS (SELECT 1 FROM escritorio_usuarios eu WHERE eu.empresa_id=${alias}.empresa_id AND eu.escritorio_id=${alias}.escritorio_id AND eu.usuario_id=?)`);
      p.push(usuarioId);
    }
    if (q.escritorio_id) { f.push(`${alias}.escritorio_id=?`); p.push(Number(q.escritorio_id)); }
    if (['entrada','saida'].includes(q.tipo)) { f.push(`${alias}.tipo=?`); p.push(q.tipo); }
    if (q.data_inicio) { f.push(`${alias}.data_movimentacao>=?`); p.push(q.data_inicio); }
    if (q.data_fim) { f.push(`${alias}.data_movimentacao<=?`); p.push(q.data_fim); }
    if (q.usuario_id) { f.push(`(${alias}.criado_por=? OR ${alias}.destinatario_usuario_id=?)`); p.push(Number(q.usuario_id),Number(q.usuario_id)); }
    if (q.produto_id) { f.push(`${alias}.estoque_produto_id=?`); p.push(Number(q.produto_id)); }
    if (q.busca) { f.push(`(${alias}.descricao LIKE ? OR ${alias}.observacao LIKE ? OR ${alias}.destinatario_nome LIKE ?)`); const l=`%${txt(q.busca,100)}%`; p.push(l,l,l); }
    return { where:f.join(' AND '), params:p };
  }

  async function resumo(ctx,q) {
    const { where,params }=filtrosConsulta({...ctx,q,alias:'m'});
    const [[r]]=await pool.query(
      `SELECT COUNT(*) total_lancamentos,
              COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) entradas,
              COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) saidas,
              COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) saldo_periodo
         FROM financeiro_movimentacoes m WHERE ${where}`, params);
    const { where:ws,params:ps }=filtrosConsulta({...ctx,q:{escritorio_id:q.escritorio_id,data_fim:q.data_fim},alias:'m'});
    const [[s]]=await pool.query(`SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) saldo_atual FROM financeiro_movimentacoes m WHERE ${ws}`, ps);
    return {...r,saldo_atual:s.saldo_atual};
  }

  async function listar(ctx,q) {
    const incluir=String(q.incluir_cancelados||'')==='1';
    const {where,params}=filtrosConsulta({...ctx,q,alias:'m',incluirCancelados:incluir});
    const [rows]=await pool.query(
      `SELECT m.*,e.nome escritorio_nome
         FROM financeiro_movimentacoes m
         JOIN escritorios e ON e.id=m.escritorio_id AND e.empresa_id=m.empresa_id
        WHERE ${where}
        ORDER BY m.data_movimentacao DESC,m.id DESC LIMIT 5000`,params);
    return rows;
  }

  async function fluxo(ctx,q) {
    const agrupamento=['diario','semanal','mensal'].includes(q.agrupamento)?q.agrupamento:'diario';
    const {where,params}=filtrosConsulta({...ctx,q,alias:'m'});
    const chave=agrupamento==='mensal'?"DATE_FORMAT(m.data_movimentacao,'%Y-%m')":agrupamento==='semanal'?"DATE_FORMAT(DATE_SUB(m.data_movimentacao, INTERVAL WEEKDAY(m.data_movimentacao) DAY),'%Y-%m-%d')":"DATE_FORMAT(m.data_movimentacao,'%Y-%m-%d')";
    const [rows]=await pool.query(
      `SELECT ${chave} periodo,
              SUM(CASE WHEN m.tipo='entrada' THEN m.valor ELSE 0 END) entradas,
              SUM(CASE WHEN m.tipo='saida' THEN m.valor ELSE 0 END) saidas,
              SUM(CASE WHEN m.tipo='entrada' THEN m.valor ELSE -m.valor END) saldo
         FROM financeiro_movimentacoes m WHERE ${where}
        GROUP BY periodo ORDER BY periodo ASC`,params);
    return rows;
  }

  async function auxiliares(ctx) {
    const [usuarios]=await pool.query(`SELECT id,usuario,cargo FROM usuarios WHERE empresa_id=? AND ativo=1 ORDER BY usuario`,[ctx.empresaId]);
    const [produtos]=await pool.query(`SELECT id,nome,codigo,localidade,quantidade,unidade_medida FROM estoque_produtos WHERE empresa_id=? AND ativo=1 ORDER BY nome`,[ctx.empresaId]).catch(()=>[[]]);
    return {usuarios,produtos};
  }

  async function salvar(ctx,req,id) {
    const b=req.body||{}; const escritorioId=Number(b.escritorio_id); const tipo=txt(b.tipo,10); const valor=Number(b.valor);
    const descricao=txt(b.descricao,255); const observacao=txt(b.observacao,5000)||null; const data=txt(b.data_movimentacao,10);
    if (!escritorioId || !['entrada','saida'].includes(tipo) || !Number.isFinite(valor) || valor<=0 || !descricao || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      throw Object.assign(new Error('Preencha escritório, tipo, valor, descrição e data corretamente.'),{statusCode:400});
    }
    const esc=await permitido(ctx.empresaId,ctx.usuarioId,ctx.admin,escritorioId); if(!esc) throw Object.assign(new Error('Você não possui acesso a este escritório.'),{statusCode:403});
    const destinatarioId=b.destinatario_usuario_id?Number(b.destinatario_usuario_id):null;
    let destinatarioNome=null;
    if(destinatarioId){ const [[u]]=await pool.query(`SELECT usuario FROM usuarios WHERE id=? AND empresa_id=? AND ativo=1`,[destinatarioId,ctx.empresaId]); if(!u) throw Object.assign(new Error('Destinatário inválido.'),{statusCode:400}); destinatarioNome=u.usuario; }
    const produtoId=b.estoque_produto_id?Number(b.estoque_produto_id):null; let produtoNome=null;
    if(produtoId){ const [[p]]=await pool.query(`SELECT nome FROM estoque_produtos WHERE id=? AND empresa_id=? AND ativo=1`,[produtoId,ctx.empresaId]).catch(()=>[[]]); if(!p) throw Object.assign(new Error('Item do estoque inválido.'),{statusCode:400}); produtoNome=p.nome; }
    if(tipo==='entrada' && produtoId) throw Object.assign(new Error('O vínculo com estoque é permitido somente em saídas.'),{statusCode:400});
    const qtd=b.estoque_quantidade===''||b.estoque_quantidade==null?null:Number(b.estoque_quantidade); if(qtd!=null&&(!Number.isFinite(qtd)||qtd<=0)) throw Object.assign(new Error('Quantidade do item inválida.'),{statusCode:400});
    const conn=await pool.getConnection();
    try{
      await conn.beginTransaction(); let movId=Number(id)||0; let anterior=null;
      if(movId){
        const [rows]=await conn.query(`SELECT * FROM financeiro_movimentacoes WHERE id=? AND empresa_id=? FOR UPDATE`,[movId,ctx.empresaId]);
        if(!rows.length) throw Object.assign(new Error('Lançamento não encontrado.'),{statusCode:404}); anterior=rows[0];
        const tem=await permitido(ctx.empresaId,ctx.usuarioId,ctx.admin,anterior.escritorio_id); if(!tem) throw Object.assign(new Error('Sem acesso ao lançamento.'),{statusCode:403});
        await conn.query(`UPDATE financeiro_movimentacoes SET escritorio_id=?,tipo=?,valor=?,descricao=?,observacao=?,data_movimentacao=?,destinatario_usuario_id=?,destinatario_nome=?,estoque_produto_id=?,estoque_produto_nome=?,estoque_quantidade=?,atualizado_por=?,atualizado_por_nome=?,atualizado_em=NOW() WHERE id=? AND empresa_id=?`,
          [escritorioId,tipo,valor,descricao,observacao,data,destinatarioId,destinatarioNome,produtoId,produtoNome,qtd,ctx.usuarioId,ctx.usuarioNome,movId,ctx.empresaId]);
      }else{
        const [r]=await conn.query(`INSERT INTO financeiro_movimentacoes (empresa_id,escritorio_id,tipo,valor,descricao,observacao,data_movimentacao,destinatario_usuario_id,destinatario_nome,estoque_produto_id,estoque_produto_nome,estoque_quantidade,criado_por,criado_por_nome,criado_em,ativo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),1)`,
          [ctx.empresaId,escritorioId,tipo,valor,descricao,observacao,data,destinatarioId,destinatarioNome,produtoId,produtoNome,qtd,ctx.usuarioId,ctx.usuarioNome]); movId=r.insertId;
      }
      const [[novo]]=await conn.query(`SELECT * FROM financeiro_movimentacoes WHERE id=?`,[movId]);
      await conn.query(`INSERT INTO financeiro_logs (empresa_id,escritorio_id,movimentacao_id,acao,usuario_id,usuario_nome,descricao,dados_anteriores,dados_novos,ip_origem,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
        [ctx.empresaId,escritorioId,movId,anterior?'editado':'criado',ctx.usuarioId,ctx.usuarioNome,`${anterior?'Editou':'Criou'} ${tipo} de R$ ${valor.toFixed(2)} - ${descricao}`,anterior?JSON.stringify(anterior):null,JSON.stringify(novo),ip(req)]);
      await conn.commit(); return {sucesso:true,id:movId};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  async function excluir(ctx,req,id) {
    const motivo=txt(req.body?.motivo_exclusao,500); if(!motivo) throw Object.assign(new Error('Informe o motivo da exclusão.'),{statusCode:400});
    const conn=await pool.getConnection();
    try{await conn.beginTransaction(); const [rows]=await conn.query(`SELECT * FROM financeiro_movimentacoes WHERE id=? AND empresa_id=? AND ativo=1 FOR UPDATE`,[id,ctx.empresaId]); if(!rows.length) throw Object.assign(new Error('Lançamento não encontrado ou já excluído.'),{statusCode:404}); const mov=rows[0];
      if(!await permitido(ctx.empresaId,ctx.usuarioId,ctx.admin,mov.escritorio_id)) throw Object.assign(new Error('Sem acesso ao lançamento.'),{statusCode:403});
      await conn.query(`UPDATE financeiro_movimentacoes SET ativo=0,excluido_por=?,excluido_por_nome=?,excluido_em=NOW(),motivo_exclusao=? WHERE id=? AND empresa_id=?`,[ctx.usuarioId,ctx.usuarioNome,motivo,id,ctx.empresaId]);
      await conn.query(`INSERT INTO financeiro_logs (empresa_id,escritorio_id,movimentacao_id,acao,usuario_id,usuario_nome,descricao,dados_anteriores,ip_origem,criado_em) VALUES (?,?,?,?,?,?,?,?,?,NOW())`,[ctx.empresaId,mov.escritorio_id,id,'excluido',ctx.usuarioId,ctx.usuarioNome,`Excluiu lançamento: ${motivo}`,JSON.stringify(mov),ip(req)]);
      await conn.commit(); return {sucesso:true};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  async function logs(ctx,q){
    const f=['l.empresa_id=?'];const p=[ctx.empresaId]; if(!ctx.admin){f.push('EXISTS (SELECT 1 FROM escritorio_usuarios eu WHERE eu.empresa_id=l.empresa_id AND eu.escritorio_id=l.escritorio_id AND eu.usuario_id=?)');p.push(ctx.usuarioId);} if(q.escritorio_id){f.push('l.escritorio_id=?');p.push(Number(q.escritorio_id));} if(q.data_inicio){f.push('DATE(l.criado_em)>=?');p.push(q.data_inicio);} if(q.data_fim){f.push('DATE(l.criado_em)<=?');p.push(q.data_fim);}
    const [rows]=await pool.query(`SELECT l.*,e.nome escritorio_nome FROM financeiro_logs l LEFT JOIN escritorios e ON e.id=l.escritorio_id WHERE ${f.join(' AND ')} ORDER BY l.id DESC LIMIT 5000`,p);return rows;
  }

  return {resumo,listar,fluxo,auxiliares,salvar,excluir,logs};
};
