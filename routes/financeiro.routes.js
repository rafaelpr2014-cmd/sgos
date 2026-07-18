'use strict';
const express=require('express');
module.exports=function(pool,verificarAutenticacao){
  const router=express.Router(); const service=require('../services/financeiro.service')(pool);
  const normal=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const ctx=req=>({empresaId:Number(req.usuario.empresa_id),usuarioId:Number(req.usuario.id),usuarioNome:req.usuario.usuario||String(req.usuario.id),admin:['administrador','admin'].includes(normal(req.usuario.cargo))});
  router.use(verificarAutenticacao);
  router.get('/resumo',async(req,res)=>{try{res.json(await service.resumo(ctx(req),req.query));}catch(e){console.error(e);res.status(500).json({erro:'Erro ao carregar resumo do caixa.'});}});
  router.get('/movimentacoes',async(req,res)=>{try{res.json(await service.listar(ctx(req),req.query));}catch(e){console.error(e);res.status(500).json({erro:'Erro ao listar movimentações.'});}});
  router.get('/fluxo',async(req,res)=>{try{res.json(await service.fluxo(ctx(req),req.query));}catch(e){console.error(e);res.status(500).json({erro:'Erro ao carregar fluxo de caixa.'});}});
  router.get('/auxiliares',async(req,res)=>{try{res.json(await service.auxiliares(ctx(req)));}catch(e){console.error(e);res.status(500).json({erro:'Erro ao carregar usuários e estoque.'});}});
  router.get('/logs',async(req,res)=>{try{res.json(await service.logs(ctx(req),req.query));}catch(e){console.error(e);res.status(500).json({erro:'Erro ao carregar auditoria.'});}});
  router.post('/movimentacoes',async(req,res)=>{try{res.status(201).json(await service.salvar(ctx(req),req,null));}catch(e){console.error(e);res.status(e.statusCode||500).json({erro:e.message});}});
  router.put('/movimentacoes/:id',async(req,res)=>{try{res.json(await service.salvar(ctx(req),req,Number(req.params.id)));}catch(e){console.error(e);res.status(e.statusCode||500).json({erro:e.message});}});
  router.delete('/movimentacoes/:id',async(req,res)=>{try{res.json(await service.excluir(ctx(req),req,Number(req.params.id)));}catch(e){console.error(e);res.status(e.statusCode||500).json({erro:e.message});}});
  return router;
};
