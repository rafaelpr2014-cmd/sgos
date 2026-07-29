/**
 * AUTENTICAÇÃO CENTRALIZADA
 *
 * As rotas /api/login, /api/logout, /api/ping, /api/me e /api/logs
 * são registradas diretamente no server.js.
 *
 * Não monte este arquivo em /api, pois isso criaria rotas duplicadas e
 * regras diferentes para a mesma tabela log_acessos.
 */
module.exports = () => {
    const express = require("express");
    return express.Router();
};
