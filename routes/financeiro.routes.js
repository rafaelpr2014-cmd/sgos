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
  router.get('/resumo', async (req, res) => { try { res.json(await service.resumo(ctx(req), req.query)); } catch (e) { fail(res, e, 'Erro ao carregar resumo.'); } });
  router.get('/movimentacoes', async (req, res) => { try { res.json(await service.listar(ctx(req), req.query)); } catch (e) { fail(res, e, 'Erro ao listar movimentações.'); } });
  router.get('/movimentacoes/:id', async (req, res) => { try { res.json(await service.obter(ctx(req), Number(req.params.id))); } catch (e) { fail(res, e, 'Erro ao carregar lançamento.'); } });
  router.get('/fluxo', async (req, res) => { try { res.json(await service.fluxo(ctx(req), req.query)); } catch (e) { fail(res, e, 'Erro ao carregar fluxo.'); } });
  router.get('/auxiliares', async (req, res) => { try { res.json(await service.auxiliares(ctx(req))); } catch (e) { fail(res, e, 'Erro ao carregar auxiliares.'); } });
  router.get('/logs', async (req, res) => { try { res.json(await service.logs(ctx(req), req.query)); } catch (e) { fail(res, e, 'Erro ao carregar auditoria.'); } });
  router.post('/movimentacoes', upload.single('anexo'), async (req, res) => { try { res.status(201).json(await service.salvar(ctx(req), req, null)); } catch (e) { fail(res, e, 'Erro ao salvar.'); } });
  router.put('/movimentacoes/:id', upload.single('anexo'), async (req, res) => { try { res.json(await service.salvar(ctx(req), req, Number(req.params.id))); } catch (e) { fail(res, e, 'Erro ao atualizar.'); } });
  router.delete('/movimentacoes/:id', async (req, res) => { try { res.json(await service.excluir(ctx(req), req, Number(req.params.id))); } catch (e) { fail(res, e, 'Erro ao excluir.'); } });
  return router;
};
