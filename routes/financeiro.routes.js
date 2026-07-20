'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

module.exports = function financeiroRoutes(pool, verificarAutenticacao) {
  const router = express.Router();
  const service = require('../services/financeiro.service')(pool);
  const uploadDir = path.join(__dirname, '..', 'uploads', 'financeiro');
  fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!String(file.mimetype || '').startsWith('image/')) return cb(new Error('Envie somente imagem.'));
      cb(null, true);
    }
  });

  const normal = v => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const ctx = req => ({
    empresaId: Number(req.usuario.empresa_id),
    usuarioId: Number(req.usuario.id),
    usuarioNome: req.usuario.usuario || String(req.usuario.id),
    admin: ['administrador', 'admin'].includes(normal(req.usuario.cargo))
  });
  const fail = (res, e, fallback) => {
    console.error(e);
    res.status(e.statusCode || 500).json({ erro: e.message || fallback });
  };

  router.use(verificarAutenticacao);

  async function listarEquipamentosPendentes(ctxAtual) {
    const [rows] = await pool.query(`
      SELECT os.id os_id,os.nome cliente,os.telefone,os.id_cliente,os.status os_status,
             os.forma_pagamento_equipamento,os.total_equipamentos,os.finalizado_em,
             om.produto_id,ep.nome produto_nome,om.quantidade,om.valor_unitario,om.desconto,om.valor_total,
             ep.escritorio_id,e.nome escritorio_nome
        FROM ordens_servico os
        JOIN os_materiais om ON om.os_id=os.id AND om.empresa_id=os.empresa_id
        JOIN estoque_produtos ep ON ep.id=om.produto_id AND ep.empresa_id=om.empresa_id
        LEFT JOIN escritorios e ON e.id=ep.escritorio_id AND e.empresa_id=ep.empresa_id
       WHERE os.empresa_id=?
         AND os.origem_equipamento='empresa'
         AND os.modalidade_equipamento='vendido'
         AND os.status_pagamento_equipamento='pendente'
         AND os.equipamentos_utilizados=1
       ORDER BY COALESCE(os.finalizado_em,os.criado_em) DESC,os.id DESC,ep.nome`,[ctxAtual.empresaId]);
    const mapa=new Map();
    for(const r of rows){
      if(!mapa.has(r.os_id)) mapa.set(r.os_id,{os_id:r.os_id,cliente:r.cliente,telefone:r.telefone,id_cliente:r.id_cliente,status:r.os_status,forma_pagamento:r.forma_pagamento_equipamento,total:Number(r.total_equipamentos||0),finalizado_em:r.finalizado_em,produtos:[]});
      mapa.get(r.os_id).produtos.push({produto_id:r.produto_id,nome:r.produto_nome,quantidade:Number(r.quantidade||0),valor_unitario:Number(r.valor_unitario||0),desconto:Number(r.desconto||0),valor_total:Number(r.valor_total||0),escritorio_id:r.escritorio_id,escritorio_nome:r.escritorio_nome});
    }
    return {total:mapa.size,itens:[...mapa.values()]};
  }

  router.get('/equipamentos-pendentes', async (req,res)=>{
    try{res.json(await listarEquipamentosPendentes(ctx(req)));}
    catch(e){fail(res,e,'Erro ao listar equipamentos com pagamento pendente.');}
  });

  router.put('/equipamentos-pendentes/:osId/pagar', async (req,res)=>{
    const c=ctx(req); if(!c.admin) return res.status(403).json({erro:'Apenas administradores podem confirmar o pagamento.'});
    const conn=await pool.getConnection();
    try{
      await conn.beginTransaction();
      const [[os]]=await conn.query(`SELECT id,forma_pagamento_equipamento,status_pagamento_equipamento FROM ordens_servico WHERE id=? AND empresa_id=? FOR UPDATE`,[Number(req.params.osId),c.empresaId]);
      if(!os) {const e=new Error('OS não encontrada.');e.statusCode=404;throw e;}
      if(String(os.status_pagamento_equipamento)!=='pendente'){const e=new Error('O pagamento desta OS não está pendente.');e.statusCode=400;throw e;}
      const [itens]=await conn.query(`SELECT om.valor_total,ep.escritorio_id FROM os_materiais om JOIN estoque_produtos ep ON ep.id=om.produto_id AND ep.empresa_id=om.empresa_id WHERE om.os_id=? AND om.empresa_id=?`,[os.id,c.empresaId]);
      const por=new Map(); for(const i of itens){const eid=Number(i.escritorio_id||0),v=Number(i.valor_total||0);if(eid&&v>0)por.set(eid,(por.get(eid)||0)+v);}
      if(!por.size){const e=new Error('Não foi possível identificar o escritório e o valor dos produtos.');e.statusCode=400;throw e;}
      await conn.query(`UPDATE financeiro_movimentacoes SET ativo=0,excluido_em=NOW(),motivo_exclusao='Pagamento pendente confirmado novamente' WHERE empresa_id=? AND os_id=? AND origem='venda_os' AND ativo=1`,[c.empresaId,os.id]);
      for(const [escritorioId,valor] of por){await conn.query(`INSERT INTO financeiro_movimentacoes (empresa_id,escritorio_id,tipo,valor,forma_pagamento,descricao,observacao,criado_por,criado_por_nome,criado_em,ativo,os_id,origem) VALUES (?,?, 'entrada', ?, ?, ?, ?, ?, ?, NOW(),1,?,'venda_os')`,[c.empresaId,escritorioId,valor,os.forma_pagamento_equipamento,`Pagamento de equipamentos da OS #${os.id}`,`Pagamento pendente confirmado pelo financeiro.`,c.usuarioId,c.usuarioNome,os.id]);}
      await conn.query(`UPDATE ordens_servico SET status_pagamento_equipamento='pago' WHERE id=? AND empresa_id=?`,[os.id,c.empresaId]);
      await conn.commit(); res.json({ok:true,os_id:os.id,status_pagamento:'pago'});
    }catch(e){try{await conn.rollback()}catch(_){ } fail(res,e,'Erro ao confirmar pagamento.');}
    finally{conn.release();}
  });
  router.get('/resumo', async (req, res) => { try { res.json(await service.resumo(ctx(req), req.query)); } catch (e) { fail(res, e, 'Erro ao carregar resumo.'); } });
  router.get('/movimentacoes', async (req, res) => { try { res.json(await service.listar(ctx(req), req.query)); } catch (e) { fail(res, e, 'Erro ao listar movimentações.'); } });
  router.get('/movimentacoes/:id', async (req, res) => { try { res.json(await service.obter(ctx(req), Number(req.params.id))); } catch (e) { fail(res, e, 'Erro ao carregar lançamento.'); } });
  router.get('/fluxo', async (req, res) => { try { res.json(await service.fluxo(ctx(req), req.query)); } catch (e) { fail(res, e, 'Erro ao carregar fluxo.'); } });
  router.get('/auxiliares', async (req, res) => { try { res.json(await service.auxiliares(ctx(req), req.query)); } catch (e) { fail(res, e, 'Erro ao carregar auxiliares.'); } });
  router.get('/logs', async (req, res) => { try { res.json(await service.logs(ctx(req), req.query)); } catch (e) { fail(res, e, 'Erro ao carregar auditoria.'); } });
  router.post('/movimentacoes', upload.single('anexo'), async (req, res) => { try { res.status(201).json(await service.salvar(ctx(req), req, null)); } catch (e) { fail(res, e, 'Erro ao salvar.'); } });
  router.put('/movimentacoes/:id', upload.single('anexo'), async (req, res) => { try { res.json(await service.salvar(ctx(req), req, Number(req.params.id))); } catch (e) { fail(res, e, 'Erro ao atualizar.'); } });
  router.delete('/movimentacoes/:id', async (req, res) => { try { res.json(await service.excluir(ctx(req), req, Number(req.params.id))); } catch (e) { fail(res, e, 'Erro ao excluir.'); } });
  return router;
};
