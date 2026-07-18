'use strict';
const express=require('express');
module.exports=function(pool,verificarAutenticacao){
  const router=express.Router(); const service=require('../services/escritorios.service')(pool);
  const normal=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const admin=req=>['administrador','admin'].includes(normal(req.usuario?.cargo));
  const ctx=req=>({empresaId:Number(req.usuario.empresa_id),usuarioId:Number(req.usuario.id),usuarioNome:req.usuario.usuario||String(req.usuario.id),admin:admin(req)});
  router.use(verificarAutenticacao);
  router.get('/',async(req,res)=>{try{const c=ctx(req);res.json(await service.listar(c.empresaId,c.usuarioId,c.admin));}catch(e){console.error(e);res.status(500).json({erro:'Erro ao listar escritórios.'});}});
  router.get('/usuarios',async(req,res)=>{try{if(!admin(req))return res.status(403).json({erro:'Apenas administradores.'});res.json(await service.usuariosDisponiveis(req.usuario.empresa_id));}catch(e){res.status(500).json({erro:'Erro ao listar usuários.'});}});
  router.get('/:id',async(req,res)=>{try{const c=ctx(req);const lista=await service.listar(c.empresaId,c.usuarioId,c.admin);if(!lista.some(x=>Number(x.id)===Number(req.params.id)))return res.status(403).json({erro:'Sem acesso.'});const r=await service.obter(c.empresaId,Number(req.params.id));if(!r)return res.status(404).json({erro:'Escritório não encontrado.'});res.json(r);}catch(e){res.status(500).json({erro:e.message});}});
  router.post('/',async(req,res)=>{try{if(!admin(req))return res.status(403).json({erro:'Apenas administradores.'});const c=ctx(req);res.status(201).json(await service.salvar({...c,...req.body,id:null}));}catch(e){console.error(e);res.status(e.statusCode||500).json({erro:e.message});}});
  router.put('/:id',async(req,res)=>{try{if(!admin(req))return res.status(403).json({erro:'Apenas administradores.'});const c=ctx(req);res.json(await service.salvar({...c,...req.body,id:Number(req.params.id)}));}catch(e){console.error(e);res.status(e.statusCode||500).json({erro:e.message});}});
  router.delete('/:id',async(req,res)=>{try{if(!admin(req))return res.status(403).json({erro:'Apenas administradores.'});res.json(await service.excluir(req.usuario.empresa_id,Number(req.params.id)));}catch(e){res.status(e.statusCode||500).json({erro:e.message});}});
  return router;
};
