const express = require("express");
const router = express.Router();
const pool = require("../database");
const providers = require("../services/integracoes/erp.provider");

function getEmpresaId(req){ return req.usuario?.empresa_id || req.headers["x-empresa-id"]; }
function normalizarTipoERP(tipo){ return String(tipo || "mikweb").trim().toLowerCase(); }
function getProvider(tipo){
    const provider = providers[normalizarTipoERP(tipo)];
    if(!provider){ const err = new Error(`ERP não suportado: ${tipo}`); err.status = 400; throw err; }
    return provider;
}
async function getPorTipo(empresaId, tipo){
    const [rows] = await pool.query(`SELECT * FROM integracoes_erp WHERE empresa_id=? AND tipo_erp=? LIMIT 1`, [empresaId, normalizarTipoERP(tipo)]);
    return rows[0] || null;
}
async function getAtiva(empresaId, tipo=null){
    let q = `SELECT * FROM integracoes_erp WHERE empresa_id=? AND ativo=1`;
    const p = [empresaId];
    if(tipo){ q += ` AND tipo_erp=?`; p.push(normalizarTipoERP(tipo)); }
    q += ` ORDER BY id DESC LIMIT 1`;
    const [rows] = await pool.query(q, p);
    return rows[0] || null;
}
async function consultasHoje(empresaId, tipo=null){
    let q = `SELECT COUNT(*) total FROM integracoes_logs WHERE empresa_id=? AND DATE(criado_em)=CURDATE()`;
    const p = [empresaId];
    if(tipo){ q += ` AND tipo_erp=?`; p.push(normalizarTipoERP(tipo)); }
    const [rows] = await pool.query(q, p);
    return rows[0]?.total || 0;
}

router.get("/status", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const [rows] = await pool.query(`
            SELECT *
            FROM integracoes_erp
            WHERE empresa_id=?
            ORDER BY tipo_erp ASC, id DESC
        `,[empresaId]);
        const ativa = rows.find(r => Number(r.ativo) === 1) || null;
        res.json({
            configurado: rows.length > 0,
            integracoes: rows.length,
            ativas: rows.filter(r => Number(r.ativo) === 1).length,
            consultas_hoje: await consultasHoje(empresaId),
            atual: ativa ? {
                id: ativa.id,
                tipo_erp: ativa.tipo_erp,
                nome: ativa.nome,
                base_url: ativa.base_url,
                app: ativa.app || "",
                modo: ativa.modo || "somente_leitura",
                ativo: Number(ativa.ativo) === 1,
                status: ativa.ultimo_status === "conectado" ? "Conectado" : "Configurado",
                ultimo_teste_em: ativa.ultimo_teste_em,
                ultimo_tempo_ms: ativa.ultimo_tempo_ms,
                token_status: "Protegido / Não exibido",
                hubsoft_oauth_configurado: !!(ativa.client_id && ativa.client_secret && ativa.username && ativa.password),
                hubsoft_token_configurado: !!(ativa.token || ativa.access_token)
            } : null,
            lista: rows.map(r => ({
                id: r.id,
                tipo_erp: r.tipo_erp,
                nome: r.nome,
                base_url: r.base_url,
                app: r.app || "",
                modo: r.modo || "somente_leitura",
                ativo: Number(r.ativo) === 1,
                status: r.ultimo_status === "conectado" ? "Conectado" : "Configurado",
                ultimo_teste_em: r.ultimo_teste_em,
                ultimo_tempo_ms: r.ultimo_tempo_ms,
                hubsoft_oauth_configurado: !!(r.client_id && r.client_secret && r.username && r.password),
                hubsoft_token_configurado: !!(r.token || r.access_token)
            }))
        });
    }catch(err){ console.error(err); res.status(500).json({erro:"Erro ao carregar status das integrações."}); }
});

router.get("/:tipo_erp/configuracao", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const config = await getPorTipo(empresaId, tipo);
        if(!config){
            return res.json({configurado:false, ativo:false, status:"Não configurado", integracoes:0, ativas:0, consultas_hoje:0, tipo_erp:tipo, nome:"", base_url:"", app:"", ultimo_teste_em:null, ultimo_tempo_ms:null});
        }
        res.json({
            configurado:true,
            ativo:Number(config.ativo) === 1,
            status:config.ultimo_status === "conectado" ? "Conectado" : "Configurado",
            integracoes:1,
            ativas:Number(config.ativo) === 1 ? 1 : 0,
            consultas_hoje:await consultasHoje(empresaId, tipo),
            id:config.id,
            empresa_id:config.empresa_id,
            tipo_erp:config.tipo_erp,
            nome:config.nome,
            base_url:config.base_url,
            app:config.app || "",
            modo:config.modo || "somente_leitura",
            token_status:"Protegido / Não exibido",
            client_id_status: config.client_id ? "Cadastrado" : "Não informado",
            client_secret_status: config.client_secret ? "Cadastrado" : "Não informado",
            username: config.username || "",
            password_status: config.password ? "Cadastrado" : "Não informado",
            access_token_status: config.access_token ? "Gerado" : "Não gerado",
            refresh_token_status: config.refresh_token ? "Gerado" : "Não gerado",
            token_expira_em: config.token_expira_em || null,
            hubsoft_oauth_configurado: !!(config.client_id && config.client_secret && config.username && config.password),
            hubsoft_token_configurado: !!(config.token || config.access_token),
            ultimo_teste_em:config.ultimo_teste_em,
            ultimo_tempo_ms:config.ultimo_tempo_ms,
            criado_em:config.criado_em,
            atualizado_em:config.atualizado_em
        });
    }catch(err){ console.error(err); res.status(500).json({erro:"Erro ao carregar configuração."}); }
});

router.post("/:tipo_erp/configurar", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const { nome, base_url, token, app, ativo, client_id, client_secret, username, password } = req.body;
        if(!empresaId) return res.status(401).json({erro:"Empresa não identificada."});
        if(!base_url) return res.status(400).json({erro:"URL Base é obrigatória."});
        if(tipo === "sgp" && !app) return res.status(400).json({erro:"APP é obrigatório para integração SGP."});
        getProvider(tipo);

        const atual = await getPorTipo(empresaId, tipo);
        const ehHubSoft = tipo === "hubsoft";

        const tokenFinal = token || atual?.token || null;
        const clientIdFinal = client_id || atual?.client_id || null;
        const clientSecretFinal = client_secret || atual?.client_secret || null;
        const usernameFinal = username || atual?.username || null;
        const passwordFinal = password || password || atual?.password || null;

        if(ehHubSoft){
            const temToken = !!String(tokenFinal || "").trim();
            const temOAuth = !!(
                String(clientIdFinal || "").trim() &&
                String(clientSecretFinal || "").trim() &&
                String(usernameFinal || "").trim() &&
                String(passwordFinal || "").trim()
            );
            if(!temToken && !temOAuth){
                return res.status(400).json({erro:"Para HubSoft, informe um Token Bearer ou Client ID, Client Secret, Username e Password."});
            }
        }else if(!tokenFinal){
            return res.status(400).json({erro:"Token é obrigatório."});
        }

        const ativar = ativo === true || ativo === "1" || ativo === 1;
        if(ativar){ await pool.query(`UPDATE integracoes_erp SET ativo=0 WHERE empresa_id=?`, [empresaId]); }

        if(atual){
            await pool.query(`
                UPDATE integracoes_erp
                SET nome=?, base_url=?, app=?, token=?, client_id=?, client_secret=?, username=?, password=?, modo='somente_leitura', ativo=?, atualizado_em=NOW()
                WHERE id=? AND empresa_id=?
            `, [
                nome || tipo.toUpperCase(),
                String(base_url).replace(/\/+$/, ""),
                app || null,
                tokenFinal,
                ehHubSoft ? clientIdFinal : null,
                ehHubSoft ? clientSecretFinal : null,
                ehHubSoft ? usernameFinal : null,
                ehHubSoft ? passwordFinal : null,
                ativar ? 1 : Number(atual.ativo || 0),
                atual.id,
                empresaId
            ]);
        }else{
            await pool.query(`
                INSERT INTO integracoes_erp (empresa_id, tipo_erp, nome, base_url, app, token, client_id, client_secret, username, password, modo, ativo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'somente_leitura', ?)
            `, [
                empresaId,
                tipo,
                nome || tipo.toUpperCase(),
                String(base_url).replace(/\/+$/, ""),
                app || null,
                tokenFinal,
                ehHubSoft ? clientIdFinal : null,
                ehHubSoft ? clientSecretFinal : null,
                ehHubSoft ? usernameFinal : null,
                ehHubSoft ? passwordFinal : null,
                ativar ? 1 : 0
            ]);
        }
        res.json({sucesso:true, mensagem:`Integração ${tipo.toUpperCase()} salva com sucesso.`});
    }catch(err){ console.error(err); res.status(err.status || 500).json({erro:err.message || "Erro ao salvar integração."}); }
});

router.post("/:tipo_erp/ativar", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const config = await getPorTipo(empresaId, tipo);
        if(!config) return res.status(404).json({erro:`Integração ${tipo.toUpperCase()} não encontrada.`});
        await pool.query(`UPDATE integracoes_erp SET ativo=0 WHERE empresa_id=?`, [empresaId]);
        await pool.query(`UPDATE integracoes_erp SET ativo=1, atualizado_em=NOW() WHERE empresa_id=? AND tipo_erp=?`, [empresaId, tipo]);
        res.json({sucesso:true, mensagem:`Integração ${tipo.toUpperCase()} habilitada.`});
    }catch(err){ console.error(err); res.status(500).json({erro:"Erro ao ativar integração."}); }
});

router.post("/:tipo_erp/desativar", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        await pool.query(`UPDATE integracoes_erp SET ativo=0, atualizado_em=NOW() WHERE empresa_id=? AND tipo_erp=?`, [empresaId, tipo]);
        res.json({sucesso:true, mensagem:`Integração ${tipo.toUpperCase()} desabilitada.`});
    }catch(err){ console.error(err); res.status(500).json({erro:"Erro ao desativar integração."}); }
});

router.get("/:tipo_erp/testar", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const config = await getPorTipo(empresaId, tipo);
        if(!config) return res.status(404).json({erro:`Integração ${tipo.toUpperCase()} não configurada.`});
        const provider = getProvider(config.tipo_erp);
        const inicio = Date.now();
        const retorno = await provider.testarConexao(config);
        const tempoMs = Date.now() - inicio;
        await pool.query(`UPDATE integracoes_erp SET ultimo_teste_em=NOW(), ultimo_status='conectado', ultimo_tempo_ms=?, atualizado_em=NOW() WHERE id=? AND empresa_id=?`, [tempoMs, config.id, empresaId]);
        await pool.query(`INSERT INTO integracoes_logs (empresa_id, integracao_id, tipo_erp, acao, endpoint, status, mensagem) VALUES (?, ?, ?, 'testar_conexao', ?, 'sucesso', ?)`, [empresaId, config.id, config.tipo_erp, provider.endpointTeste || "-", `Conexão ${config.tipo_erp.toUpperCase()} testada com sucesso.`]);
        res.json({sucesso:true, status:"Conectado", mensagem:`Conexão com ${config.tipo_erp.toUpperCase()} realizada com sucesso.`, tempo_ms:tempoMs, retorno});
    }catch(err){
        const detalhe = err.response?.data || err.message;
        console.error("[INTEGRACOES][TESTE]", {
            tipo: req.params.tipo_erp,
            url: err.url || err.config?.url || null,
            endpoint: err.endpoint || null,
            status: err.status || err.response?.status || null,
            detalhe
        });
        res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500).json({
            erro: "Falha ao conectar com o ERP.",
            detalhe,
            endpoint: err.endpoint || null,
            url: err.url || err.config?.url || null,
            status_http: err.status || err.response?.status || 500
        });
    }
});

router.get("/:tipo_erp/clientes", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const termo = req.query.termo || "";
        const config = await getAtiva(empresaId, tipo);
        if(!config) return res.status(404).json({erro:`Integração ${tipo.toUpperCase()} não está habilitada.`});
        const provider = getProvider(config.tipo_erp);
        const dados = await provider.buscarClientes(config, termo);
        await pool.query(`INSERT INTO integracoes_logs (empresa_id, integracao_id, tipo_erp, acao, endpoint, status, mensagem) VALUES (?, ?, ?, 'buscar_clientes', ?, 'sucesso', ?)`, [empresaId, config.id, config.tipo_erp, provider.endpointClientes || "-", `Busca: ${termo}`]);
        res.json(dados);
    }catch(err){ console.error(err.response?.data || err.message); res.status(500).json({erro:"Erro ao buscar cliente no ERP.", detalhe:err.response?.data || err.message}); }
});

router.get("/pesquisar", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const termo = req.query.termo || "";
        const config = await getAtiva(empresaId);
        if(!config) return res.status(404).json({erro:"Nenhuma integração ERP habilitada."});
        const provider = getProvider(config.tipo_erp);
        const dados = await provider.buscarClientes(config, termo);
        await pool.query(`INSERT INTO integracoes_logs (empresa_id, integracao_id, tipo_erp, acao, endpoint, status, mensagem) VALUES (?, ?, ?, 'pesquisar_cliente_os', ?, 'sucesso', ?)`, [empresaId, config.id, config.tipo_erp, provider.endpointClientes || "-", `Busca OS: ${termo}`]);
        res.json({...dados, erp:config.tipo_erp});
    }catch(err){ console.error(err.response?.data || err.message); res.status(500).json({erro:"Erro ao pesquisar cliente no ERP.", detalhe:err.response?.data || err.message}); }
});

router.get("/:tipo_erp/pesquisar", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const termo = req.query.termo || "";
        const config = await getAtiva(empresaId, tipo);
        if(!config) return res.status(404).json({erro:`Integração ${tipo.toUpperCase()} não está habilitada.`});
        const provider = getProvider(config.tipo_erp);
        const dados = await provider.buscarClientes(config, termo);
        await pool.query(`INSERT INTO integracoes_logs (empresa_id, integracao_id, tipo_erp, acao, endpoint, status, mensagem) VALUES (?, ?, ?, 'pesquisar_cliente_os', ?, 'sucesso', ?)`, [empresaId, config.id, config.tipo_erp, provider.endpointClientes || "-", `Busca OS: ${termo}`]);
        res.json({...dados, erp:config.tipo_erp});
    }catch(err){ console.error(err.response?.data || err.message); res.status(500).json({erro:"Erro ao pesquisar cliente no ERP.", detalhe:err.response?.data || err.message}); }
});

router.get("/:tipo_erp/cliente-completo", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const termo = req.query.termo || req.query.id || "";
        const config = await getAtiva(empresaId, tipo);
        if(!config) return res.status(404).json({erro:`Integração ${tipo.toUpperCase()} não está habilitada.`});
        const provider = getProvider(config.tipo_erp);
        const cliente = await provider.buscarClienteCompleto(config, termo);
        await pool.query(`INSERT INTO integracoes_logs (empresa_id, integracao_id, tipo_erp, acao, endpoint, status, mensagem) VALUES (?, ?, ?, 'buscar_cliente_completo', ?, 'sucesso', ?)`, [empresaId, config.id, config.tipo_erp, provider.endpointClientes || "-", `Busca completa: ${termo}`]);
        res.json(cliente || {});
    }catch(err){ console.error(err.response?.data || err.message); res.status(500).json({erro:"Erro ao buscar cliente completo no ERP.", detalhe:err.response?.data || err.message}); }
});

router.get("/:tipo_erp/contrato", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const termo = req.query.termo || req.query.id || "";
        const config = await getAtiva(empresaId, tipo);
        if(!config) return res.status(404).json({erro:`Integração ${tipo.toUpperCase()} não está habilitada.`});
        const provider = getProvider(config.tipo_erp);
        const dados = await provider.buscarContrato(config, termo);
        res.json(dados || {});
    }catch(err){ console.error(err.response?.data || err.message); res.status(500).json({erro:"Erro ao buscar contrato no ERP.", detalhe:err.response?.data || err.message}); }
});

router.get("/:tipo_erp/login", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const termo = req.query.termo || req.query.id || "";
        const config = await getAtiva(empresaId, tipo);
        if(!config) return res.status(404).json({erro:`Integração ${tipo.toUpperCase()} não está habilitada.`});
        const provider = getProvider(config.tipo_erp);
        const dados = await provider.buscarLogin(config, termo);
        res.json(dados || {});
    }catch(err){ console.error(err.response?.data || err.message); res.status(500).json({erro:"Erro ao buscar login no ERP.", detalhe:err.response?.data || err.message}); }
});

router.get("/:tipo_erp/plano", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const termo = req.query.termo || req.query.id || "";
        const config = await getAtiva(empresaId, tipo);
        if(!config) return res.status(404).json({erro:`Integração ${tipo.toUpperCase()} não está habilitada.`});
        const provider = getProvider(config.tipo_erp);
        const dados = await provider.buscarPlano(config, termo);
        res.json(dados || {});
    }catch(err){ console.error(err.response?.data || err.message); res.status(500).json({erro:"Erro ao buscar plano no ERP.", detalhe:err.response?.data || err.message}); }
});

router.get("/:tipo_erp/os-cliente/:id", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const tipo = normalizarTipoERP(req.params.tipo_erp);
        const config = await getAtiva(empresaId, tipo);
        if(!config) return res.status(404).json({erro:`Integração ${tipo.toUpperCase()} não está habilitada.`});
        const provider = getProvider(config.tipo_erp);
        const cliente = await provider.buscarClientePorId(config, req.params.id);
        res.json(cliente);
    }catch(err){ console.error(err.response?.data || err.message); res.status(500).json({erro:"Erro ao buscar cliente no ERP.", detalhe:err.response?.data || err.message}); }
});

router.get("/logs", async (req,res)=>{
    try{
        const empresaId = getEmpresaId(req);
        const [rows] = await pool.query(`SELECT * FROM integracoes_logs WHERE empresa_id=? ORDER BY id DESC LIMIT 80`, [empresaId]);
        res.json(rows);
    }catch(err){ console.error(err); res.status(500).json({erro:"Erro ao carregar logs."}); }
});

module.exports = router;
