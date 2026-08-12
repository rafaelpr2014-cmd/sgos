module.exports = (db, verificarAutenticacao, io) => {

    const express = require("express");
    const router = express.Router();
    const logService = require("../services/log.service")(db);

    const osService =
        require("../services/os.service");

    // LOG SERVICE
    const {
        registrarLog
    } = require("../services/log.service")(db);

    const multer =
        require("multer");

    const path =
        require("path");

    const fs =
        require("fs");

    // ===============================
    // 📂 BASE UPLOAD (MULTI AMBIENTE)
    // ===============================
    const baseUpload = path.join(__dirname, "../uploads");

    // ===============================
    // 📎 UPLOAD INVIABILIDADES
    // ===============================
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {

            const pasta = path.join(baseUpload, "inviabilidades");

            fs.mkdirSync(pasta, { recursive: true });

            cb(null, pasta);
        },

        filename: (req, file, cb) => {

            const nome =
                Date.now() + path.extname(file.originalname);

            cb(null, nome);
        }
    });

    // ===============================
    // 📎 UPLOAD ORDENS DE SERVIÇO
    // ===============================
    const storageAnexos = multer.diskStorage({

        destination: (req, file, cb) => {

            const pasta = path.join(baseUpload, "ordens_servico");

            fs.mkdirSync(pasta, { recursive: true });

            cb(null, pasta);
        },

        filename: (req, file, cb) => {

            const unique =
                Date.now() +
                "-" +
                Math.round(Math.random() * 1E9);

            cb(
                null,
                unique + path.extname(file.originalname)
            );
        }
    });

    // ===============================
    // 📎 CONFIG MULTER ORDENS
    // ===============================
    const uploadAnexo = multer({

        storage: storageAnexos,

        limits: {
            fileSize: 30 * 1024 * 1024 // 30MB
        },

        fileFilter: (req, file, cb) => {

            const permitidos = [
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/heic",
                "image/heif",
                "video/mp4",
                "video/webm",
                "video/quicktime",
                "video/3gpp",
                "video/3gp",
                "application/octet-stream",
                "application/pdf"
            ];

            if (permitidos.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error("Formato inválido"));
            }
        }
    });

   
    const upload = multer({ storage });

// ===============================
// 📍 CHECK-IN DO ATENDIMENTO
// ===============================
async function garantirEstruturaCheckinOS(){
    const adicionar = async (coluna, sql) => {
        const [rows] = await db.query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'ordens_servico'
              AND COLUMN_NAME = ?
            LIMIT 1
        `, [coluna]);
        if(!rows.length) await db.query(sql);
    };

    await adicionar('checkin_inicio_em', `ALTER TABLE ordens_servico ADD COLUMN checkin_inicio_em DATETIME NULL AFTER iniciado_em`);
    await adicionar('checkin_inicio_latitude', `ALTER TABLE ordens_servico ADD COLUMN checkin_inicio_latitude DECIMAL(10,8) NULL AFTER checkin_inicio_em`);
    await adicionar('checkin_inicio_longitude', `ALTER TABLE ordens_servico ADD COLUMN checkin_inicio_longitude DECIMAL(11,8) NULL AFTER checkin_inicio_latitude`);
    await adicionar('checkin_inicio_precisao', `ALTER TABLE ordens_servico ADD COLUMN checkin_inicio_precisao DECIMAL(10,2) NULL AFTER checkin_inicio_longitude`);
    await adicionar('checkin_inicio_por', `ALTER TABLE ordens_servico ADD COLUMN checkin_inicio_por INT NULL AFTER checkin_inicio_precisao`);
    await adicionar('checkin_fim_em', `ALTER TABLE ordens_servico ADD COLUMN checkin_fim_em DATETIME NULL AFTER checkin_inicio_por`);
    await adicionar('checkin_fim_latitude', `ALTER TABLE ordens_servico ADD COLUMN checkin_fim_latitude DECIMAL(10,8) NULL AFTER checkin_fim_em`);
    await adicionar('checkin_fim_longitude', `ALTER TABLE ordens_servico ADD COLUMN checkin_fim_longitude DECIMAL(11,8) NULL AFTER checkin_fim_latitude`);
    await adicionar('checkin_fim_precisao', `ALTER TABLE ordens_servico ADD COLUMN checkin_fim_precisao DECIMAL(10,2) NULL AFTER checkin_fim_longitude`);
    await adicionar('checkin_fim_por', `ALTER TABLE ordens_servico ADD COLUMN checkin_fim_por INT NULL AFTER checkin_fim_precisao`);
    await adicionar('tempo_atendimento_segundos', `ALTER TABLE ordens_servico ADD COLUMN tempo_atendimento_segundos INT UNSIGNED NULL AFTER checkin_fim_por`);
}

function coordenadaValida(latitude, longitude){
    const lat = Number(latitude);
    const lng = Number(longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// ===============================
// 📦 INTEGRAÇÃO ESTOQUE x OS
// ===============================
async function garantirEstruturaMateriaisOS(){
    await db.query(`CREATE TABLE IF NOT EXISTS os_materiais (
      id INT NOT NULL AUTO_INCREMENT, empresa_id INT NOT NULL, os_id INT NOT NULL, produto_id INT NOT NULL,
      quantidade INT NOT NULL DEFAULT 1, valor_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
      desconto DECIMAL(12,2) NOT NULL DEFAULT 0, valor_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(id), UNIQUE KEY uk_os_produto (empresa_id,os_id,produto_id),
      KEY idx_os_materiais_os (empresa_id,os_id), KEY idx_os_materiais_produto (empresa_id,produto_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const alterar=async(tabela,coluna,sql)=>{const [r]=await db.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,[tabela,coluna]);if(!r.length)await db.query(sql);};
    await alterar('estoque_produtos','valor_unitario',`ALTER TABLE estoque_produtos ADD COLUMN valor_unitario DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER unidade_medida`);
    await alterar('ordens_servico','origem_equipamento',`ALTER TABLE ordens_servico ADD COLUMN origem_equipamento ENUM('proprio','empresa') NULL DEFAULT NULL AFTER descricao`);
    await db.query(`ALTER TABLE ordens_servico MODIFY COLUMN origem_equipamento ENUM('proprio','empresa') NULL DEFAULT NULL`).catch(()=>null);
    await alterar('ordens_servico','modalidade_equipamento',`ALTER TABLE ordens_servico ADD COLUMN modalidade_equipamento ENUM('vendido','comodato') NULL AFTER origem_equipamento`);
    await alterar('ordens_servico','forma_pagamento_equipamento',`ALTER TABLE ordens_servico ADD COLUMN forma_pagamento_equipamento VARCHAR(30) NULL AFTER modalidade_equipamento`);
    await alterar('ordens_servico','status_pagamento_equipamento',`ALTER TABLE ordens_servico ADD COLUMN status_pagamento_equipamento ENUM('pendente','pago') NULL AFTER forma_pagamento_equipamento`);
    await alterar('ordens_servico','anexo_pagamento_equipamento',`ALTER TABLE ordens_servico ADD COLUMN anexo_pagamento_equipamento VARCHAR(500) NULL AFTER status_pagamento_equipamento`);
    await alterar('ordens_servico','anexo_pagamento_nome',`ALTER TABLE ordens_servico ADD COLUMN anexo_pagamento_nome VARCHAR(255) NULL AFTER anexo_pagamento_equipamento`);
    await alterar('ordens_servico','anexo_pagamento_mime',`ALTER TABLE ordens_servico ADD COLUMN anexo_pagamento_mime VARCHAR(120) NULL AFTER anexo_pagamento_nome`);
    await alterar('ordens_servico','subtotal_equipamentos',`ALTER TABLE ordens_servico ADD COLUMN subtotal_equipamentos DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER forma_pagamento_equipamento`);
    await alterar('ordens_servico','desconto_equipamentos',`ALTER TABLE ordens_servico ADD COLUMN desconto_equipamentos DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER subtotal_equipamentos`);
    await alterar('ordens_servico','total_equipamentos',`ALTER TABLE ordens_servico ADD COLUMN total_equipamentos DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER desconto_equipamentos`);
    await alterar('os_materiais','valor_unitario',`ALTER TABLE os_materiais ADD COLUMN valor_unitario DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER quantidade`);
    await alterar('os_materiais','desconto',`ALTER TABLE os_materiais ADD COLUMN desconto DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER valor_unitario`);
    await alterar('os_materiais','valor_total',`ALTER TABLE os_materiais ADD COLUMN valor_total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER desconto`);
    await alterar('financeiro_movimentacoes','os_id',`ALTER TABLE financeiro_movimentacoes ADD COLUMN os_id INT NULL AFTER estoque_movimentacao_id`);
    await alterar('financeiro_movimentacoes','origem',`ALTER TABLE financeiro_movimentacoes ADD COLUMN origem VARCHAR(30) NULL AFTER os_id`);
    await alterar('financeiro_movimentacoes','anexos_comprovantes',`ALTER TABLE financeiro_movimentacoes ADD COLUMN anexos_comprovantes VARCHAR(500) NULL AFTER anexo_mime`);
    await alterar('estoque_movimentacoes','os_id',`ALTER TABLE estoque_movimentacoes ADD COLUMN os_id INT NULL AFTER produto_id`);
    await db.query(`ALTER TABLE estoque_movimentacoes MODIFY COLUMN origem VARCHAR(40) NULL`).catch(()=>null);
    await alterar('ordens_servico','equipamentos_utilizados',`ALTER TABLE ordens_servico ADD COLUMN equipamentos_utilizados ENUM('pendente','sim','nao') NOT NULL DEFAULT 'pendente' AFTER total_equipamentos`);
    await alterar('ordens_servico','equipamentos_confirmado_em',`ALTER TABLE ordens_servico ADD COLUMN equipamentos_confirmado_em DATETIME NULL AFTER equipamentos_utilizados`);
    await alterar('ordens_servico','equipamentos_confirmado_por',`ALTER TABLE ordens_servico ADD COLUMN equipamentos_confirmado_por INT NULL AFTER equipamentos_confirmado_em`);
    await alterar('ordens_servico','observacao_equipamento',`ALTER TABLE ordens_servico ADD COLUMN observacao_equipamento TEXT NULL AFTER equipamentos_confirmado_por`);
}
function normalizarMateriaisOS(materiais){
    const lista=Array.isArray(materiais)?materiais:[];const mapa=new Map();
    for(const item of lista){const id=Number(item?.produto_id),qtd=Math.floor(Number(item?.quantidade)),desc=Math.max(0,Number(item?.desconto)||0);if(id>0&&qtd>0)mapa.set(id,{produto_id:id,quantidade:qtd,desconto:desc});}
    return [...mapa.values()];
}

function validarSelecaoEquipamentosOS(dados){
    const origem=String(dados?.origem_equipamento||'').trim().toLowerCase();
    if(!['proprio','empresa'].includes(origem)){
        const erro=new Error('Selecione a origem dos equipamentos e materiais.');erro.statusCode=400;throw erro;
    }
    if(origem==='empresa'){
        const modalidade=String(dados?.modalidade_equipamento||'').trim().toLowerCase();
        if(!['comodato','vendido'].includes(modalidade)){
            const erro=new Error('Selecione a modalidade dos equipamentos e materiais.');erro.statusCode=400;throw erro;
        }
        if(!normalizarMateriaisOS(dados?.materiais).length){
            const erro=new Error('Adicione pelo menos um equipamento ou material da empresa.');erro.statusCode=400;throw erro;
        }
    }
}

function salvarComprovantePagamentoOS(osId,empresaId,dataUrl,nomeArquivo,mimeAtual,caminhoAtual){
    if(!dataUrl)return caminhoAtual||null;
    const m=String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if(!m)throw new Error('Comprovante de pagamento inválido.');
    const mime=String(mimeAtual||m[1]||'').toLowerCase();
    const permitidos={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf'};
    const ext=permitidos[mime];if(!ext)throw new Error('Formato do comprovante inválido. Use JPG, PNG, WEBP ou PDF.');
    const buffer=Buffer.from(m[2],'base64');if(buffer.length>8*1024*1024)throw new Error('O comprovante deve ter no máximo 8 MB.');
    const pasta=path.join(baseUpload,'pagamentos-os');fs.mkdirSync(pasta,{recursive:true});
    const arquivo=`empresa-${empresaId}-os-${osId}-${Date.now()}${ext}`;fs.writeFileSync(path.join(pasta,arquivo),buffer);
    return `/uploads/pagamentos-os/${arquivo}`;
}
async function sincronizarFinanceiroVendaOS(osId,empresaId,usuarioId,usuarioNome,forma,totalPorEscritorio){
    await db.query(`UPDATE financeiro_movimentacoes SET ativo=0,excluido_em=NOW(),motivo_exclusao='Venda da OS atualizada ou removida' WHERE empresa_id=? AND os_id=? AND origem='venda_os' AND ativo=1`,[empresaId,osId]);
    for(const [escritorioId,valor] of totalPorEscritorio.entries()){
        if(valor<=0)continue;
        await db.query(`INSERT INTO financeiro_movimentacoes
          (empresa_id,escritorio_id,tipo,valor,forma_pagamento,descricao,observacao,criado_por,criado_por_nome,criado_em,ativo,os_id,origem)
          VALUES (?,?, 'entrada', ?, ?, ?, ?, ?, ?, NOW(),1,?,'venda_os')`,
          [empresaId,escritorioId,valor,forma,`Venda de equipamentos da OS #${osId}`,`Lançamento automático vinculado à OS #${osId}.`,usuarioId,usuarioNome,osId]);
    }
}
async function salvarMateriaisOS(osId,empresaId,origem,modalidade,materiais,formaPagamento,usuario,statusPagamento="pendente",anexoBase64=null,anexoNome=null,anexoMime=null){
    await garantirEstruturaMateriaisOS();
    const origemFinal=String(origem||'').trim().toLowerCase();
    if(!['proprio','empresa'].includes(origemFinal)){const erro=new Error('Selecione a origem dos equipamentos e materiais.');erro.statusCode=400;throw erro;}
    const modalidadeFinal=origemFinal==='empresa'&&['vendido','comodato'].includes(String(modalidade||'').trim().toLowerCase())?String(modalidade).trim().toLowerCase():null;
    if(origemFinal==='empresa'&&!modalidadeFinal){const erro=new Error('Selecione a modalidade dos equipamentos e materiais.');erro.statusCode=400;throw erro;}
    const materiaisNormalizados=normalizarMateriaisOS(materiais);
    if(origemFinal==='empresa'&&!materiaisNormalizados.length){const erro=new Error('Adicione pelo menos um equipamento ou material da empresa.');erro.statusCode=400;throw erro;}
    const vendido=origemFinal==='empresa'&&modalidadeFinal==='vendido';
    const formas=['dinheiro','pix','cartao_credito','cartao_debito','cheque'];
    if(vendido&&!formas.includes(formaPagamento))throw new Error('Selecione um tipo de pagamento válido para a venda.');
    const statusPagamentoFinal=vendido&&['pendente','pago'].includes(statusPagamento)?statusPagamento:null;
    if(vendido&&!statusPagamentoFinal)throw new Error('Selecione o status do pagamento.');
    const [[osAtualPagamento]]=await db.query('SELECT anexo_pagamento_equipamento,anexo_pagamento_nome,anexo_pagamento_mime FROM ordens_servico WHERE id=? AND empresa_id=? LIMIT 1',[osId,empresaId]);
    const caminhoComprovante=vendido?salvarComprovantePagamentoOS(osId,empresaId,anexoBase64,anexoNome,anexoMime,osAtualPagamento?.anexo_pagamento_equipamento):null;
    await db.query(`DELETE FROM os_materiais WHERE os_id=? AND empresa_id=?`,[osId,empresaId]);
    let subtotal=0,descontoTotal=0,total=0;const porEscritorio=new Map();
    if(origemFinal==='empresa'){
      for(const item of materiaisNormalizados){
        const [rows]=await db.query(`SELECT id,nome,escritorio_id,valor_unitario FROM estoque_produtos WHERE id=? AND empresa_id=? AND ativo=1 LIMIT 1`,[item.produto_id,empresaId]);
        if(!rows.length)throw new Error(`Produto ${item.produto_id} não foi encontrado no estoque ativo da empresa.`);
        const produto=rows[0],unit=vendido?Number(produto.valor_unitario||0):0,bruto=unit*item.quantidade,desc=vendido?Math.min(item.desconto,bruto):0,liquido=Math.max(0,bruto-desc);
        subtotal+=bruto;descontoTotal+=desc;total+=liquido;
        await db.query(`INSERT INTO os_materiais (empresa_id,os_id,produto_id,quantidade,valor_unitario,desconto,valor_total) VALUES (?,?,?,?,?,?,?)`,[empresaId,osId,item.produto_id,item.quantidade,unit,desc,liquido]);
        if(vendido)porEscritorio.set(Number(produto.escritorio_id),(porEscritorio.get(Number(produto.escritorio_id))||0)+liquido);
      }
    }
    await db.query(`UPDATE ordens_servico SET origem_equipamento=?,modalidade_equipamento=?,forma_pagamento_equipamento=?,status_pagamento_equipamento=?,anexo_pagamento_equipamento=?,anexo_pagamento_nome=?,anexo_pagamento_mime=?,subtotal_equipamentos=?,desconto_equipamentos=?,total_equipamentos=? WHERE id=? AND empresa_id=?`,
      [origemFinal,modalidadeFinal,vendido?formaPagamento:null,statusPagamentoFinal,caminhoComprovante,vendido?(anexoNome||osAtualPagamento?.anexo_pagamento_nome||null):null,vendido?(anexoMime||osAtualPagamento?.anexo_pagamento_mime||null):null,subtotal,descontoTotal,total,osId,empresaId]);
    // O financeiro é contabilizado somente após o técnico confirmar uso e pagamento na conclusão.
    await db.query(`UPDATE financeiro_movimentacoes
        SET ativo=0,excluido_em=NOW(),motivo_exclusao='Aguardando conclusão e confirmação de pagamento da OS'
        WHERE empresa_id=? AND os_id=? AND origem='venda_os' AND ativo=1`,[empresaId,osId]);
}


async function processarConfirmacaoEquipamentosConclusao(conn, osId, empresaId, utilizado, observacaoEquipamento, statusPagamentoConfirmado, usuario, anexoPagamentoBase64=null, anexoPagamentoNome=null, anexoPagamentoMime=null){
    const resposta = String(utilizado ?? '').trim().toLowerCase();
    const respostaNormalizada = ['sim','1','true'].includes(resposta) ? 'sim' : ['nao','não','0','false'].includes(resposta) ? 'nao' : '';

    const [materiais] = await conn.query(`
        SELECT om.produto_id,om.quantidade,om.valor_unitario,om.desconto,om.valor_total,
               ep.nome,ep.escritorio_id
          FROM os_materiais om
          LEFT JOIN estoque_produtos ep
            ON ep.id=om.produto_id AND ep.empresa_id=om.empresa_id
         WHERE om.os_id=? AND om.empresa_id=?`, [osId,empresaId]);

    if(!materiais.length){
        return {possuiEquipamentos:false,utilizado:null,estoqueBaixado:0,estoqueDevolvido:0,valorFinanceiro:0,financeiroLancado:0,financeiroEstornado:0};
    }

    if(!respostaNormalizada){
        const erro=new Error('Confirme se o equipamento vinculado foi utilizado.');
        erro.statusCode=400;
        throw erro;
    }

    const observacaoFinal=respostaNormalizada==='nao' ? String(observacaoEquipamento||'').trim() : null;
    if(respostaNormalizada==='nao' && !observacaoFinal){
        const erro=new Error('Informe o motivo pelo qual o equipamento não foi utilizado.');
        erro.statusCode=400;
        throw erro;
    }

    // A coluna equipamentos_utilizados é ENUM('pendente','sim','nao').
    // Grava exatamente 'sim' ou 'nao' para evitar Data truncated no MariaDB.
    await conn.query(`
        UPDATE ordens_servico
           SET equipamentos_utilizados=?,
               equipamentos_confirmado_em=NOW(),
               equipamentos_confirmado_por=?,
               observacao_equipamento=?
         WHERE id=? AND empresa_id=?`,
        [respostaNormalizada,Number(usuario?.id||0)||null,observacaoFinal,osId,empresaId]);

    const [[dadosOS]] = await conn.query(`
        SELECT origem_equipamento,modalidade_equipamento,forma_pagamento_equipamento,
               status_pagamento_equipamento,total_equipamentos,
               anexo_pagamento_equipamento,anexo_pagamento_nome,anexo_pagamento_mime
          FROM ordens_servico
         WHERE id=? AND empresa_id=?
         LIMIT 1`, [osId,empresaId]);

    const origemEmpresa = String(dadosOS?.origem_equipamento||'').toLowerCase()==='empresa';
    const vendido = origemEmpresa && String(dadosOS?.modalidade_equipamento||'').toLowerCase()==='vendido';

    // Caso o técnico anexe o comprovante na conclusão, ele substitui/atualiza o comprovante da OS.
    if(vendido && anexoPagamentoBase64){
        const caminhoNovo=salvarComprovantePagamentoOS(
            osId,empresaId,anexoPagamentoBase64,anexoPagamentoNome,anexoPagamentoMime,
            dadosOS?.anexo_pagamento_equipamento
        );
        dadosOS.anexo_pagamento_equipamento=caminhoNovo;
        dadosOS.anexo_pagamento_nome=anexoPagamentoNome||dadosOS?.anexo_pagamento_nome||null;
        dadosOS.anexo_pagamento_mime=anexoPagamentoMime||dadosOS?.anexo_pagamento_mime||null;
        await conn.query(`UPDATE ordens_servico SET anexo_pagamento_equipamento=?,anexo_pagamento_nome=?,anexo_pagamento_mime=? WHERE id=? AND empresa_id=?`,[
            dadosOS.anexo_pagamento_equipamento,dadosOS.anexo_pagamento_nome,dadosOS.anexo_pagamento_mime,osId,empresaId
        ]);
    }
    let statusPagamentoFinal = vendido ? String(dadosOS?.status_pagamento_equipamento||'pendente').toLowerCase() : null;

    // Quando a venda ainda está pendente, o técnico confirma no momento da conclusão.
    if(respostaNormalizada==='sim' && vendido && statusPagamentoFinal==='pendente'){
        const confirmacaoPagamento=String(statusPagamentoConfirmado||'').trim().toLowerCase();
        if(!['pago','pendente'].includes(confirmacaoPagamento)){
            const erro=new Error('Confirme se o pagamento do equipamento foi realizado.');
            erro.statusCode=400;
            throw erro;
        }
        statusPagamentoFinal=confirmacaoPagamento;
        await conn.query(`UPDATE ordens_servico SET status_pagamento_equipamento=? WHERE id=? AND empresa_id=?`,
            [statusPagamentoFinal,osId,empresaId]);
    }

    if(respostaNormalizada==='sim'){
        let estoqueBaixado=0;

        // Faz a baixa somente uma vez e somente para equipamentos da empresa.
        if(origemEmpresa){
            for(const item of materiais){
                const qtdNecessaria=Math.max(0,Math.floor(Number(item.quantidade||0)));
                if(qtdNecessaria<=0) continue;

                const [[jaBaixadoRow]] = await conn.query(`
                    SELECT COALESCE(SUM(quantidade),0) quantidade
                      FROM estoque_movimentacoes
                     WHERE empresa_id=? AND produto_id=? AND os_id=?
                       AND tipo='saida' AND origem='ordem_servico'`,
                    [empresaId,item.produto_id,osId]);
                const jaBaixado=Math.max(0,Number(jaBaixadoRow?.quantidade||0));
                const qtdBaixar=Math.max(0,qtdNecessaria-jaBaixado);
                if(qtdBaixar<=0) continue;

                const [[produto]]=await conn.query(`
                    SELECT quantidade,escritorio_id,nome
                      FROM estoque_produtos
                     WHERE id=? AND empresa_id=? AND ativo=1
                     FOR UPDATE`, [item.produto_id,empresaId]);
                if(!produto){
                    const erro=new Error(`Produto ${item.nome||item.produto_id} não foi encontrado no estoque.`);
                    erro.statusCode=400;
                    throw erro;
                }

                const anterior=Math.max(0,Number(produto.quantidade||0));
                if(anterior<qtdBaixar){
                    const erro=new Error(`Estoque insuficiente para ${produto.nome}. Disponível: ${anterior}; necessário: ${qtdBaixar}.`);
                    erro.statusCode=400;
                    throw erro;
                }

                const atual=anterior-qtdBaixar;
                await conn.query(`UPDATE estoque_produtos SET quantidade=?,atualizado_em=NOW() WHERE id=? AND empresa_id=?`,[atual,item.produto_id,empresaId]);
                await conn.query(`
                    INSERT INTO estoque_movimentacoes
                    (empresa_id,escritorio_id,produto_id,os_id,tipo,quantidade,quantidade_anterior,quantidade_atual,motivo,observacao,usuario_id,usuario_nome,origem,criado_em)
                    VALUES (?,?,?,?, 'saida',?,?,?,?,?,?,?,'ordem_servico',NOW())`,
                    [empresaId,produto.escritorio_id,item.produto_id,osId,qtdBaixar,anterior,atual,
                     `Equipamento utilizado na OS #${osId}`,
                     `Baixa automática confirmada na conclusão da OS #${osId}.`,
                     Number(usuario?.id||0),String(usuario?.usuario||usuario?.nome||'Sistema')]);
                estoqueBaixado+=qtdBaixar;
            }
        }

        let financeiroLancado=0;
        let valorFinanceiro=0;

        // Somente pagamento confirmado como PAGO entra no fluxo financeiro.
        if(vendido && statusPagamentoFinal==='pago'){
            await conn.query(`
                UPDATE financeiro_movimentacoes
                   SET ativo=0,excluido_em=NOW(),motivo_exclusao='Lançamento da venda recalculado na conclusão da OS'
                 WHERE empresa_id=? AND os_id=? AND origem='venda_os' AND ativo=1`, [empresaId,osId]);

            const porEscritorio=new Map();
            for(const item of materiais){
                const escritorioId=Number(item.escritorio_id||0);
                const valor=Math.max(0,Number(item.valor_total||0));
                if(!escritorioId || valor<=0) continue;
                porEscritorio.set(escritorioId,(porEscritorio.get(escritorioId)||0)+valor);
            }

            if(!porEscritorio.size && Number(dadosOS?.total_equipamentos||0)>0){
                const escritorioFallback=Number(materiais.find(x=>Number(x.escritorio_id||0)>0)?.escritorio_id||0);
                if(escritorioFallback) porEscritorio.set(escritorioFallback,Number(dadosOS.total_equipamentos));
            }

            for(const [escritorioId,valor] of porEscritorio.entries()){
                await conn.query(`
                    INSERT INTO financeiro_movimentacoes
                    (empresa_id,escritorio_id,tipo,valor,forma_pagamento,descricao,observacao,anexo,anexo_nome,anexo_mime,anexos_comprovantes,criado_por,criado_por_nome,criado_em,ativo,os_id,origem)
                    VALUES (?,?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(),1,?,'venda_os')`,
                    [empresaId,escritorioId,valor,dadosOS?.forma_pagamento_equipamento||null,
                     `Venda de equipamentos utilizados na OS #${osId}`,
                     `Lançamento automático confirmado na conclusão da OS #${osId}.`,
                     dadosOS?.anexo_pagamento_equipamento||null,
                     dadosOS?.anexo_pagamento_nome||null,
                     dadosOS?.anexo_pagamento_mime||null,
                     dadosOS?.anexo_pagamento_equipamento||null,
                     Number(usuario?.id||0),String(usuario?.usuario||usuario?.nome||'Sistema'),osId]);
                financeiroLancado++;
                valorFinanceiro+=valor;
            }
        }

        if(vendido && statusPagamentoFinal==='pendente'){
            await conn.query(`UPDATE financeiro_movimentacoes
                 SET ativo=0,excluido_em=NOW(),motivo_exclusao='Pagamento pendente da venda na OS'
               WHERE empresa_id=? AND os_id=? AND origem='venda_os' AND ativo=1`,[empresaId,osId]);
        }
        if(vendido && statusPagamentoFinal==='pago' && financeiroLancado===0 && Number(dadosOS?.total_equipamentos||0)>0){
            const erro=new Error('Não foi possível identificar o escritório do produto para lançar o valor no financeiro.');
            erro.statusCode=400;
            throw erro;
        }
        return {possuiEquipamentos:true,utilizado:'sim',estoqueBaixado,estoqueDevolvido:0,valorFinanceiro,financeiroLancado,financeiroEstornado:0,statusPagamento:statusPagamentoFinal,pagamentoPendente:vendido&&statusPagamentoFinal==='pendente'};
    }

    // Resposta NÃO: estorna eventual venda e devolve apenas o que já tiver sido baixado para esta OS.
    const [financeiro]=await conn.query(`
        UPDATE financeiro_movimentacoes
           SET ativo=0,excluido_em=NOW(),motivo_exclusao='Equipamento não utilizado na conclusão da OS'
         WHERE empresa_id=? AND os_id=? AND origem='venda_os' AND ativo=1`,[empresaId,osId]);

    let devolvido=0;
    for(const item of materiais){
        const [[saidaRow]]=await conn.query(`
            SELECT COALESCE(SUM(quantidade),0) quantidade
              FROM estoque_movimentacoes
             WHERE empresa_id=? AND produto_id=? AND os_id=?
               AND tipo='saida' AND origem='ordem_servico'`, [empresaId,item.produto_id,osId]);
        const [[estornoRow]]=await conn.query(`
            SELECT COALESCE(SUM(quantidade),0) quantidade
              FROM estoque_movimentacoes
             WHERE empresa_id=? AND produto_id=? AND os_id=?
               AND tipo='entrada' AND origem='estorno_ordem_servico'`, [empresaId,item.produto_id,osId]);
        const qtd=Math.max(0,Number(saidaRow?.quantidade||0)-Number(estornoRow?.quantidade||0));
        if(qtd<=0) continue;

        const [[produto]]=await conn.query(`SELECT quantidade,escritorio_id,nome FROM estoque_produtos WHERE id=? AND empresa_id=? FOR UPDATE`,[item.produto_id,empresaId]);
        if(!produto) continue;
        const anterior=Number(produto.quantidade||0),atual=anterior+qtd;
        await conn.query(`UPDATE estoque_produtos SET quantidade=?,atualizado_em=NOW() WHERE id=? AND empresa_id=?`,[atual,item.produto_id,empresaId]);
        await conn.query(`
            INSERT INTO estoque_movimentacoes
            (empresa_id,escritorio_id,produto_id,os_id,tipo,quantidade,quantidade_anterior,quantidade_atual,motivo,observacao,usuario_id,usuario_nome,origem,criado_em)
            VALUES (?,?,?,?, 'entrada',?,?,?,?,?,?,?,'estorno_ordem_servico',NOW())`,
            [empresaId,produto.escritorio_id,item.produto_id,osId,qtd,anterior,atual,
             `Devolução de equipamento não utilizado na OS #${osId}`,
             `Estorno automático realizado na conclusão da OS #${osId}.`,
             Number(usuario?.id||0),String(usuario?.usuario||usuario?.nome||'Sistema')]);
        devolvido+=qtd;
    }

    return {possuiEquipamentos:true,utilizado:'nao',estoqueBaixado:0,estoqueDevolvido:devolvido,valorFinanceiro:0,financeiroLancado:0,financeiroEstornado:Number(financeiro?.affectedRows||0)};
}

function normalizarTecnicosObrigatorio(tecnicoRaw){
    try {
        if(Array.isArray(tecnicoRaw)){
            return tecnicoRaw
                .map(v => String(v ?? "").trim())
                .filter(v => v && v !== "0" && v !== "null" && v !== "undefined");
        }

        if(typeof tecnicoRaw === "string"){
            const texto = tecnicoRaw.trim();
            if(!texto || texto === "[]" || texto === "[null]") return [];

            if(texto.startsWith("[") && texto.endsWith("]")){
                const parsed = JSON.parse(texto);
                if(Array.isArray(parsed)){
                    return parsed
                        .map(v => String(v ?? "").trim())
                        .filter(v => v && v !== "0" && v !== "null" && v !== "undefined");
                }
            }

            return texto
                .split(",")
                .map(v => String(v ?? "").trim())
                .filter(v => v && v !== "0" && v !== "null" && v !== "undefined");
        }

        return tecnicoRaw ? [tecnicoRaw] : [];
    } catch {
        return [];
    }
}


function parseDataHoraLocal(valor){
    if(!valor) return null;

    const s = String(valor).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);

    if(m && !/[zZ]$/.test(s)){
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
    }

    return new Date(s);
}

function validarDataHoraAtualOuFutura(valor, nomeCampo){
    if(!valor) return;

    const s = String(valor).trim();
    const ano = Number(s.slice(0, 4));
    const anoAtual = new Date().getFullYear();

    if(!ano || ano < anoAtual){
        throw new Error(`${nomeCampo} inválido. Verifique o ano informado.`);
    }

    const d = parseDataHoraLocal(valor);

    if(!d || isNaN(d.getTime())){
        throw new Error(`${nomeCampo} inválido.`);
    }

    // Tolerância de 2 minutos para salvar no mesmo minuto.
    if(d.getTime() < Date.now() - 120000){
        throw new Error(`${nomeCampo} precisa ser uma data e hora atual ou futura.`);
    }
}

function possuiTecnicoObrigatorio(tecnicoRaw){
    return normalizarTecnicosObrigatorio(tecnicoRaw).length > 0;
}



    // ===============================
    // 🔔 PUSH FCM - SOMENTE OS EM ANDAMENTO
    // ===============================
    function normalizarTecnicos(tecnicoRaw){
        try {
            if(Array.isArray(tecnicoRaw)) return tecnicoRaw.map(Number).filter(Boolean);

            if(typeof tecnicoRaw === "string"){
                const texto = tecnicoRaw.trim();
                if(!texto) return [];

                if(texto.startsWith("[") && texto.endsWith("]")){
                    return JSON.parse(texto).map(Number).filter(Boolean);
                }

                return texto
                    .split(",")
                    .map(v => Number(String(v).trim()))
                    .filter(Boolean);
            }

            return [];
        } catch {
            return [];
        }
    }

    async function enviarPushOSAndamento(req, osId){
        try {
            const pushService = req.app.get("pushService");

            if(!pushService || !pushService.enviarPushOSAndamento){
                console.warn("PushService indisponível para OS em andamento");
                return;
            }

            const [rows] = await db.query(`
                SELECT
                    os.id,
                    os.nome,
                    os.tecnico,
                    os.empresa_id,
                    l.nome AS localidade_nome,
                    ts.nome AS tipo_servico_nome
                FROM ordens_servico os
                LEFT JOIN localidades l
                    ON l.id = os.localidade
                    AND l.empresa_id = os.empresa_id
                LEFT JOIN tipos_servico ts
                    ON ts.id = os.tipo_servico
                WHERE os.id = ?
                AND os.empresa_id = ?
                LIMIT 1
            `, [
                osId,
                req.usuario.empresa_id
            ]);

            if(!rows.length) return;

            const os = rows[0];
            const tecnicoIds = normalizarTecnicos(os.tecnico);

            if(!tecnicoIds.length){
                console.warn(`Push OS ${osId} não enviado: OS sem técnico vinculado.`);
                return;
            }

            const [usuariosPush] = await db.query(`
                SELECT DISTINCT usuario_id
                FROM usuario_tecnicos
                WHERE empresa_id = ?
                AND tecnico_id IN (?)
            `, [
                os.empresa_id,
                tecnicoIds
            ]);

            if(!usuariosPush.length){
                console.warn(`Push OS ${osId} não enviado: nenhum usuário vinculado aos técnicos.`);
                return;
            }

            for(const u of usuariosPush){
                const resultado = await pushService.enviarPushOSAndamento({
                    usuarioId: u.usuario_id,
                    empresaId: os.empresa_id,
                    osId: os.id,
                    cliente: os.nome,
                    localidade: os.localidade_nome,
                    tipoServico: os.tipo_servico_nome
                });

                console.log("🔔 Push OS em andamento:", {
                    os_id: os.id,
                    usuario_id: u.usuario_id,
                    resultado
                });
            }
        } catch(pushErr){
            console.error("Erro ao enviar push de OS em andamento:", pushErr);
        }
    }


function normalizarPrioridadeOS(valor){
    const texto = String(valor || "").trim().toLowerCase();

    if(texto === "alta") return "Alta";
    if(texto === "baixa") return "Baixa";
    if(texto === "media" || texto === "média") return "Média";

    return "Média";
}

  // ===============================
// 📋 LISTAR ORDENS
// ===============================
router.get("/", verificarAutenticacao, async (req, res) => {
    try {

        const { id: userId, cargo: rawCargo, empresa_id } = req.usuario;
        const periodo = req.query.periodo || "hoje";

        const cargo = String(rawCargo || "").trim().toLowerCase();

        let filtroPeriodo = "";

        switch (periodo) {

            // ===============================
            // HOJE
            // ===============================
            case "hoje":

                filtroPeriodo = `
                    AND (
                        -- ABERTAS / EM ANDAMENTO SEM AGENDAMENTO
                        (
                            os.agendamento IS NULL
                            AND os.status IN (
                                'aberto',
                                'cliente_ausente',
                                'em_andamento'
                            )
                        )

                        OR

                        -- AGENDADAS HOJE (CORRIGIDO)
                        (
                            os.status IN ('agendado', 'reagendado')
                            AND os.agendamento IS NOT NULL
                            AND os.agendamento >= CURDATE()
                            AND os.agendamento < CURDATE() + INTERVAL 1 DAY
                        )

                        OR

                        -- CONCLUÍDAS HOJE
                        (
                            os.status = 'concluido'
                            AND (
                                DATE(os.finalizado_em) = CURDATE()
                                OR (
                                    os.finalizado_em IS NULL
                                    AND DATE(os.criado_em) = CURDATE()
                                )
                            )
                        )

                        OR

                        -- CRIADAS HOJE
                        (
                            DATE(os.criado_em) = CURDATE()
                        )
                    )
                `;
                break;

            // ===============================
            // ONTEM
            // ===============================
            case "ontem":

                filtroPeriodo = `
                    AND (
                        (
                            os.status IN ('agendado', 'reagendado')
                            AND os.agendamento IS NOT NULL
                            AND os.agendamento >= CURDATE() - INTERVAL 1 DAY
                            AND os.agendamento < CURDATE()
                        )

                        OR

                        (
                            os.status = 'concluido'
                            AND DATE(os.finalizado_em) = CURDATE() - INTERVAL 1 DAY
                        )

                        OR

                        (
                            DATE(os.criado_em) = CURDATE() - INTERVAL 1 DAY
                        )
                    )
                `;
                break;

            // ===============================
            // 7 DIAS
            // ===============================
            case "7dias":

                filtroPeriodo = `
                    AND (
                        (
                            os.status IN ('agendado', 'reagendado')
                            AND os.agendamento IS NOT NULL
                            AND os.agendamento >= CURDATE() - INTERVAL 7 DAY
                        )

                        OR

                        (
                            os.status = 'concluido'
                            AND (
                                os.finalizado_em >= CURDATE() - INTERVAL 7 DAY
                                OR os.criado_em >= CURDATE() - INTERVAL 7 DAY
                            )
                        )

                        OR

                        (
                            os.criado_em >= CURDATE() - INTERVAL 7 DAY
                        )
                    )
                `;
                break;

            // ===============================
            // 30 DIAS
            // ===============================
            case "30dias":

                filtroPeriodo = `
                    AND (
                        -- AGENDAMENTO
                        (
                            os.status IN ('agendado', 'reagendado')
                            AND os.agendamento IS NOT NULL
                            AND os.agendamento >= CURDATE() - INTERVAL 30 DAY
                        )

                        OR

                        -- CONCLUÍDAS
                        (
                            os.status = 'concluido'
                            AND (
                                os.finalizado_em >= CURDATE() - INTERVAL 30 DAY
                                OR os.finalizado_em IS NULL
                            )
                        )

                        OR

                        -- CRIAÇÃO
                        (
                            os.criado_em >= CURDATE() - INTERVAL 30 DAY
                        )
                    )
                `;
                break;


            // ===============================
            // AGENDAMENTOS
            // ===============================
            case "agendamentos":

                filtroPeriodo = `
                    AND os.status IN ('agendado', 'reagendado')
                    AND os.agendamento IS NOT NULL
                `;
                break;

            // ===============================
            // DEFAULT
            // ===============================
            default:

                filtroPeriodo = `
                    AND (
                        (
                            os.agendamento IS NULL
                            AND os.status IN ('aberto', 'cliente_ausente')
                        )

                        OR

                        (
                            os.status IN ('agendado', 'reagendado')
                            AND os.agendamento IS NOT NULL
                            AND os.agendamento >= CURDATE()
                        )
                    )
                `;
        }

        let query = `
            SELECT 
                os.*,
                os.nome AS cliente_nome,

                u.usuario AS criado_por_nome,
                uf.usuario AS finalizado_por_nome,
                COALESCE(ue.usuario, 'SGOS Agendado') AS enviado_por_nome,

                l.nome AS localidade_nome,
                l.vlan AS localidade_vlan,  
                p.nome AS plano_nome,
                ts.nome AS tipo_servico_nome,

                (
                    SELECT GROUP_CONCAT(t.nome SEPARATOR ', ')
                    FROM tecnicos t
                    WHERE FIND_IN_SET(
                        t.id,
                        REPLACE(REPLACE(os.tecnico, '[', ''), ']', '')
                    )
                ) AS tecnicos_nomes,
                (SELECT u.usuario FROM usuarios u WHERE u.id=os.equipamentos_confirmado_por AND u.empresa_id=os.empresa_id LIMIT 1) AS equipamentos_confirmado_por_nome,
                (SELECT u.usuario FROM usuarios u WHERE u.id=os.checkin_inicio_por AND u.empresa_id=os.empresa_id LIMIT 1) AS checkin_inicio_por_nome,
                (SELECT u.usuario FROM usuarios u WHERE u.id=os.checkin_fim_por AND u.empresa_id=os.empresa_id LIMIT 1) AS checkin_fim_por_nome,

                (SELECT JSON_ARRAYAGG(JSON_OBJECT('produto_id',om.produto_id,'nome',ep.nome,'quantidade',om.quantidade,'valor_unitario',om.valor_unitario,'desconto',om.desconto,'valor_total',om.valor_total)) FROM os_materiais om LEFT JOIN estoque_produtos ep ON ep.id=om.produto_id AND ep.empresa_id=om.empresa_id WHERE om.os_id=os.id AND om.empresa_id=os.empresa_id) AS materiais_os

            FROM ordens_servico os

            LEFT JOIN usuarios u ON os.criado_por = u.id
            LEFT JOIN usuarios uf ON os.finalizado_por = uf.id
            LEFT JOIN usuarios ue ON os.enviado_por = ue.id

            LEFT JOIN localidades l 
                ON l.id = os.localidade
                AND l.empresa_id = os.empresa_id

            LEFT JOIN planos p ON os.plano = p.id
            LEFT JOIN tipos_servico ts ON os.tipo_servico = ts.id

            WHERE os.empresa_id = ?
            ${filtroPeriodo}
        `;

        let params = [empresa_id];

        // 🔒 FILTRO POR TÉCNICO
        if (cargo !== "administrador") {

            const [tecs] = await db.query(
                "SELECT tecnico_id FROM usuario_tecnicos WHERE usuario_id=?",
                [userId]
            );

            const tecIds = tecs.map(t => t.tecnico_id);

            if (!tecIds.length) {
                return res.json([]);
            }

            query += ` AND JSON_OVERLAPS(os.tecnico, ?) `;
            params.push(JSON.stringify(tecIds));
        }

        query += " ORDER BY os.data_abertura DESC";

        const [rows] = await db.query(query, params);

        res.json(rows);

    } catch (err) {
        console.error("ERRO LISTAR OS:", err);
        res.status(500).json({ erro: err.message });
    }
});


    // ===============================
    // 📦 MATERIAIS DE INSTALAÇÃO
    // ===============================
    router.get("/materiais-instalacao", verificarAutenticacao, async (req,res)=>{
        try{
            const [rows]=await db.query(`SELECT id, nome, categoria, quantidade, valor_unitario, escritorio_id FROM estoque_produtos WHERE empresa_id=? ORDER BY nome`,[req.usuario.empresa_id]);
            res.json(rows);
        }catch(err){ console.error('ERRO LISTAR MATERIAIS:',err); res.status(500).json({erro:err.message}); }
    });

    // ===============================
    // 🔹 LISTAR LOCALIDADES
    // ===============================
    router.get("/localidades", verificarAutenticacao, async (req, res) => {
        try {
            const [result] = await db.query(
                "SELECT id, nome, vlan FROM localidades WHERE empresa_id=?",
                [req.usuario.empresa_id]
            );
            res.json(result);
        } catch (err) {
            res.status(500).json({ erro: err.message });
        }
    });

    // ===============================
    // 🔹 LISTAR TÉCNICOS
    // ===============================
    router.get("/tecnicos", verificarAutenticacao, async (req, res) => {
        try {
            const [result] = await db.query(
                "SELECT id, nome FROM tecnicos WHERE empresa_id=?",
                [req.usuario.empresa_id]
            );
            res.json(result);
        } catch (err) {
            res.status(500).json({ erro: err.message });
        }
    });


 // ===============================
// 🆕 CRIAR OS
// ===============================
router.post(
    "/",
    verificarAutenticacao,
    async (req, res) => {

        try {

            console.log(req.body);

            // ===============================
            // DADOS
            // ===============================
            const dados = req.body;

            // ===============================
            // CRIA OS
            // ===============================
            validarSelecaoEquipamentosOS(dados);

            const resultado =
                await osService.criar(
                    dados,
                    req.usuario
                );

            // Garante a persistência da descrição inicial e da prioridade
            // mesmo que a versão atual do osService.criar ainda não inclua essas colunas.
            const descricaoInicial =
                typeof dados.descricao === "string"
                    ? dados.descricao.trim()
                    : "";

            const prioridadeFinal =
                normalizarPrioridadeOS(dados.prioridade);

            await db.query(`
                UPDATE ordens_servico
                SET
                    descricao = ?,
                    prioridade = ?
                WHERE id = ?
                  AND empresa_id = ?
            `, [
                descricaoInicial || null,
                prioridadeFinal,
                resultado.id,
                req.usuario.empresa_id
            ]);

            // ===============================
            // 🔁 VÍNCULO DA OS RECICLADA
            // A OS antiga é apenas a origem dos dados e permanece intacta.
            // ===============================
            if(dados.reciclar_de_id){
                const origemId = Number(dados.reciclar_de_id);

                const [origens] = await db.query(`
                    SELECT id, os_raiz_id, numero_reciclagem
                    FROM ordens_servico
                    WHERE id = ? AND empresa_id = ?
                    LIMIT 1
                `, [origemId, req.usuario.empresa_id]);

                if(!origens.length){
                    await db.query(`DELETE FROM ordens_servico WHERE id=? AND empresa_id=?`, [resultado.id, req.usuario.empresa_id]);
                    return res.status(404).json({ erro: "OS de origem não encontrada para reciclagem." });
                }

                const origem = origens[0];
                const raizId = Number(origem.os_raiz_id || origem.id);

                const [[contador]] = await db.query(`
                    SELECT COALESCE(MAX(numero_reciclagem),0) AS maior
                    FROM ordens_servico
                    WHERE empresa_id = ?
                      AND (id = ? OR os_raiz_id = ?)
                `, [req.usuario.empresa_id, raizId, raizId]);

                const numeroReciclagem = Number(contador?.maior || 0) + 1;

                await db.query(`
                    UPDATE ordens_servico
                    SET os_raiz_id = ?,
                        reciclada_de_id = ?,
                        numero_reciclagem = ?,
                        reciclada_em = NOW(),
                        reciclada_por = ?,
                        status = CASE WHEN status='em_andamento' THEN 'em_andamento' ELSE 'aberto' END,
                        iniciado_em = CASE WHEN status='em_andamento' THEN NOW() ELSE NULL END,
                        finalizado_em = NULL,
                        finalizado_por = NULL,
                        enviado_por = NULL,
                        observacao_finalizado = NULL,
                        anexo_finalizado = NULL,
                        observacao_ausente = NULL,
                        anexo_ausente = NULL,
                        equipamentos_utilizados = 'pendente',
                        equipamentos_confirmado_em = NULL,
                        equipamentos_confirmado_por = NULL,
                        observacao_equipamento = NULL,
                        checkin_inicio_em = NULL,
                        checkin_inicio_latitude = NULL,
                        checkin_inicio_longitude = NULL,
                        checkin_inicio_precisao = NULL,
                        checkin_inicio_por = NULL,
                        checkin_fim_em = NULL,
                        checkin_fim_latitude = NULL,
                        checkin_fim_longitude = NULL,
                        checkin_fim_precisao = NULL,
                        checkin_fim_por = NULL,
                        tempo_atendimento_segundos = NULL
                    WHERE id = ? AND empresa_id = ?
                `, [
                    raizId, origemId, numeroReciclagem, req.usuario.id,
                    resultado.id, req.usuario.empresa_id
                ]);
            }

            await salvarMateriaisOS(resultado.id, req.usuario.empresa_id, dados.origem_equipamento, dados.modalidade_equipamento, dados.materiais, dados.forma_pagamento_equipamento, req.usuario, dados.status_pagamento_equipamento, dados.anexo_pagamento_base64, dados.anexo_pagamento_nome, dados.anexo_pagamento_mime);

            // ===============================
            // BUSCAR NOMES
            // ===============================

            let nomeLocalidade = "-";
            let nomePlano = "-";
            let nomeServico = "-";
            let nomesTecnicos = "-";

            // ===============================
            // LOCALIDADE
            // ===============================
            const [localRows] = await db.query(

                `
                SELECT nome
                FROM localidades
                WHERE id = ?
                `,

                [dados.localidade]
            );

            if(localRows.length){

                nomeLocalidade =
                    localRows[0].nome;
            }

            // ===============================
            // PLANO
            // ===============================
            const [planoRows] = await db.query(

                `
                SELECT nome
                FROM planos
                WHERE id = ?
                `,

                [dados.plano]
            );

            if(planoRows.length){

                nomePlano =
                    planoRows[0].nome;
            }

            // ===============================
            // TIPO SERVIÇO
            // ===============================
            const [servicoRows] = await db.query(

                `
                SELECT nome
                FROM tipos_servico
                WHERE id = ?
                `,

                [dados.tipo_servico]
            );

            if(servicoRows.length){

                nomeServico =
                    servicoRows[0].nome;
            }

            // ===============================
            // TÉCNICOS
            // ===============================
            if(

                Array.isArray(dados.tecnico)
                &&
                dados.tecnico.length

            ){

                const [tecRows] =
                    await db.query(`

                        SELECT nome
                        FROM tecnicos
                        WHERE id IN (?)

                    `, [

                        dados.tecnico
                    ]);

                nomesTecnicos =
                    tecRows
                    .map(t => t.nome)
                    .join(", ");
            }

            // ===============================
            // 📝 LOG
            // ===============================
            await registrarLog(

                req,

                "CRIOU OS",

                "OS",

                resultado.id,

                {
                    Cliente:
                        dados.nome,

                    Telefone:
                        dados.telefone,

                    Login:
                        dados.login,

                    "ID Cliente":
                        dados.id_cliente,

                    Localidade:
                        nomeLocalidade,

                    Plano:
                        nomePlano,

                    "Tipo Serviço":
                        nomeServico,

                    Prioridade:
                        prioridadeFinal,

                    Técnicos:
                        nomesTecnicos,

                    VLAN:
                        dados.vlan,

                    Status:
                        dados.status
                }
            );

            // ===============================
            // SOCKET REALTIME
            // ===============================
            io.emit("os_update");

            // 🔔 Se a OS já foi criada diretamente em andamento, notifica.
            // OS aberta/agendada NÃO envia push externo.
            const statusCriacao = String(dados.status || "aberto")
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "_");

            if(statusCriacao === "em_andamento"){
                io.emit("os_andamento", {
                    os_id: resultado.id,
                    titulo: "🚀 OS em andamento",
                    mensagem: `A OS #${resultado.id} entrou em andamento${dados.nome ? " - " + dados.nome : ""}`,
                    cliente: dados.nome || ""
                });

                await enviarPushOSAndamento(req, resultado.id);
            }

            // ===============================
            // RESPOSTA
            // ===============================
            res.json({

                ok: true,

                id: resultado.id
            });

        } catch (err) {

            console.error(
                "ERRO CRIAR OS:",
                err
            );

            res.status(500).json({

                erro: err.message
            });
        }
    }
);

   // ===============================
// 🗑️ EXCLUIR OS
// ===============================
router.delete(
    "/:id",
    verificarAutenticacao,
    async (req, res) => {

        try {

            // ===============================
            // BUSCA OS
            // ===============================
            const [rows] = await db.query(`

                SELECT
                    nome,
                    telefone,
                    login,
                    tecnico
                FROM ordens_servico
                WHERE id = ?
                AND empresa_id = ?

            `, [

                req.params.id,
                req.usuario.empresa_id
            ]);

            const os =
                rows[0] || {};

            // ===============================
            // DELETE
            // ===============================
            await db.query(

                `
                DELETE FROM ordens_servico
                WHERE id = ?
                AND empresa_id = ?
                `,

                [
                    req.params.id,
                    req.usuario.empresa_id
                ]
            );

            // ===============================
            // LOG
            // ===============================
            await registrarLog(

                req,

                "EXCLUIU OS",

                "OS",

                req.params.id,

                {
                    Cliente:
                        os.nome,

                    Telefone:
                        os.telefone,

                    Login:
                        os.login
                }
            );

            io.emit("os_update");

            res.json({
                sucesso: true
            });

        } catch (err) {

            res.status(500).json({
                erro: err.message
            });
        }
    }
);


// ===============================
// 📅 REAGENDAR OS
// ===============================
async function garantirEstruturaReagendamentoOS(){
    const adicionar = async (coluna, sql) => {
        const [rows] = await db.query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'ordens_servico'
              AND COLUMN_NAME = ?
            LIMIT 1
        `, [coluna]);

        if(!rows.length){
            await db.query(sql);
        }
    };

    await adicionar(
        'reagendado_por',
        `ALTER TABLE ordens_servico ADD COLUMN reagendado_por INT NULL AFTER agendamento_envio`
    );

    await adicionar(
        'reagendado_em',
        `ALTER TABLE ordens_servico ADD COLUMN reagendado_em DATETIME NULL AFTER reagendado_por`
    );

    await adicionar(
        'observacao_reagendamento',
        `ALTER TABLE ordens_servico ADD COLUMN observacao_reagendamento TEXT NULL AFTER reagendado_em`
    );
}

// Inicializa a estrutura de reagendamento no carregamento do módulo.
garantirEstruturaReagendamentoOS().catch(err => {
    console.error("ERRO AO INICIALIZAR ESTRUTURA DE REAGENDAMENTO:", err);
});

function normalizarDataHoraReagendamento(valor){
    if(!valor) return null;

    const texto = String(valor).trim();
    const data = new Date(texto);

    if(Number.isNaN(data.getTime())) return null;

    // Grava no formato DATETIME usando o horário local do servidor.
    const pad = numero => String(numero).padStart(2, '0');

    return [
        data.getFullYear(),
        pad(data.getMonth() + 1),
        pad(data.getDate())
    ].join('-') + ' ' + [
        pad(data.getHours()),
        pad(data.getMinutes()),
        pad(data.getSeconds())
    ].join(':');
}

router.put(
    "/reagendar/:id",
    verificarAutenticacao,
    async (req, res) => {
        try {
            await garantirEstruturaReagendamentoOS();

            const osId = Number(req.params.id);
            const empresaId = Number(req.usuario.empresa_id);
            const usuarioId = Number(req.usuario.id);

            const novaDataRaw =
                req.body?.agendamento_envio ||
                req.body?.agendamento ||
                req.body?.agendado_para ||
                req.body?.data_agendamento;

            const novaData = normalizarDataHoraReagendamento(novaDataRaw);
            const motivo = String(
                req.body?.observacao_reagendamento ||
                req.body?.observacao ||
                ""
            ).trim();

            if(!osId){
                return res.status(400).json({ erro: "OS inválida." });
            }

            if(!novaData){
                return res.status(400).json({
                    erro: "Informe uma data e horário válidos para o reagendamento."
                });
            }

            const [ordens] = await db.query(`
                SELECT id, nome, telefone, login, status, agendamento, agendamento_envio
                FROM ordens_servico
                WHERE id = ? AND empresa_id = ?
                LIMIT 1
            `, [osId, empresaId]);

            if(!ordens.length){
                return res.status(404).json({ erro: "OS não encontrada." });
            }

            const dataNova = new Date(novaData.replace(" ", "T"));
            if(Number.isNaN(dataNova.getTime()) || dataNova.getTime() < Date.now() - 120000){
                return res.status(400).json({
                    erro: "O reagendamento precisa ser para uma data e hora atual ou futura."
                });
            }

            const osAnterior = ordens[0];

            await db.query(`
                UPDATE ordens_servico
                SET status = 'reagendado',
                    agendamento = ?,
                    agendamento_envio = ?,
                    reagendado_por = ?,
                    reagendado_em = NOW(),
                    observacao_reagendamento = ?,
                    iniciado_em = NULL,
                    finalizado_em = NULL,
                    finalizado_por = NULL
                WHERE id = ? AND empresa_id = ?
            `, [
                novaData,
                novaData,
                usuarioId,
                motivo || null,
                osId,
                empresaId
            ]);

            await registrarLog(
                req,
                "REAGENDOU OS",
                "OS",
                osId,
                {
                    Cliente: osAnterior.nome || "-",
                    Data_anterior:
                        osAnterior.agendamento_envio ||
                        osAnterior.agendamento ||
                        "-",
                    Nova_data: novaData,
                    Motivo: motivo || "-"
                }
            );

            io.emit("os_update");
            io.emit("os_reagendada", {
                os_id: osId,
                status: "reagendado",
                agendamento: novaData,
                reagendado_por: usuarioId
            });

            res.json({
                ok: true,
                sucesso: true,
                id: osId,
                status: "reagendado",
                agendamento: novaData,
                agendamento_envio: novaData
            });

        } catch (err) {
            console.error("ERRO REAGENDAR OS:", err);

            res.status(err.statusCode || 500).json({
                erro: err.message || "Erro ao reagendar a OS."
            });
        }
    }
);

// ===============================
// 🚀 INICIAR OS
// ===============================
router.post(
    "/iniciar/:id",
    verificarAutenticacao,
    async (req, res) => {

        try {

            // ===============================
            // BUSCA OS
            // ===============================
            const [rows] = await db.query(`

                SELECT
                    nome,
                    telefone,
                    login,
                    tecnico
                FROM ordens_servico
                WHERE id = ?
                AND empresa_id = ?

            `, [

                req.params.id,
                req.usuario.empresa_id
            ]);

            const os =
                rows[0] || {};

            if(!possuiTecnicoObrigatorio(os.tecnico)){
                return res.status(400).json({
                    erro: "Selecione pelo menos um técnico para poder lançar OS."
                });
            }

            // ===============================
            // UPDATE
            // ===============================
            await db.query(`

                UPDATE ordens_servico
                SET

                    status = 'os_lancada',
                    iniciado_em = NOW(),
                    enviado_por = ?

                WHERE id = ?
                AND empresa_id = ?

            `, [

                req.usuario.id,
                req.params.id,
                req.usuario.empresa_id
            ]);

            // ===============================
            // LOG
            // ===============================
            await registrarLog(

                req,

                "LANÇOU OS",

                "OS",

                req.params.id,

                {
                    Cliente:
                        os.nome,

                    Telefone:
                        os.telefone,

                    Login:
                        os.login,

                    Status:
                        "OS LANÇADA"
                }
            );

            io.emit("os_update");

            io.emit("os_lancada", {
                os_id: req.params.id,
                titulo: "🚀 NOVA OS LANÇADA!",
                mensagem: `A OS #${req.params.id} foi lançada para atendimento${os.nome ? " - " + os.nome : ""}`,
                cliente: os.nome || ""
            });

            await enviarPushOSAndamento(req, req.params.id);

            res.json({
                ok: true
            });

        } catch (err) {

            console.error(
                "ERRO INICIAR:",
                err
            );

            res.status(500).json({
                erro: err.message
            });
        }
    }
);

// ===============================
// 📍 CHECK-IN DE CHEGADA
// ===============================
router.post(
    "/checkin/:id",
    verificarAutenticacao,
    async (req, res) => {
        try {
            await garantirEstruturaCheckinOS();

            const latitude = Number(req.body?.latitude ?? req.body?.lat);
            const longitude = Number(req.body?.longitude ?? req.body?.lng);
            const precisao = Number(req.body?.precisao ?? req.body?.accuracy);

            if(!coordenadaValida(latitude, longitude)){
                return res.status(400).json({ erro: "Localização inválida. Ative o GPS e tente novamente." });
            }

            const [rows] = await db.query(`
                SELECT id, nome, status, checkin_inicio_em
                FROM ordens_servico
                WHERE id = ? AND empresa_id = ?
                LIMIT 1
            `, [req.params.id, req.usuario.empresa_id]);

            if(!rows.length){
                return res.status(404).json({ erro: "OS não encontrada." });
            }

            const os = rows[0];
            if(os.checkin_inicio_em){
                return res.status(409).json({
                    erro: "O check-in desta OS já foi registrado.",
                    checkin_inicio_em: os.checkin_inicio_em
                });
            }

            if(!['os_lancada','em_andamento','aberto','agendado'].includes(String(os.status || '').toLowerCase())){
                return res.status(400).json({ erro: "O check-in não pode ser registrado no status atual da OS." });
            }

            await db.query(`
                UPDATE ordens_servico
                SET checkin_inicio_em = NOW(),
                    checkin_inicio_latitude = ?,
                    checkin_inicio_longitude = ?,
                    checkin_inicio_precisao = ?,
                    checkin_inicio_por = ?,
                    latitude = ?,
                    longitude = ?,
                    data_localizacao = NOW(),
                    status = 'em_andamento' 
                WHERE id = ? AND empresa_id = ? AND checkin_inicio_em IS NULL
            `, [
                latitude,
                longitude,
                Number.isFinite(precisao) && precisao >= 0 ? precisao : null,
                req.usuario.id,
                latitude,
                longitude,
                req.params.id,
                req.usuario.empresa_id
            ]);

            const [[registro]] = await db.query(`
                SELECT checkin_inicio_em, checkin_inicio_latitude, checkin_inicio_longitude,
                       checkin_inicio_precisao, checkin_inicio_por
                FROM ordens_servico
                WHERE id = ? AND empresa_id = ?
                LIMIT 1
            `, [req.params.id, req.usuario.empresa_id]);

            await registrarLog(req, "CHECK-IN DE CHEGADA", "OS", req.params.id, {
                Cliente: os.nome,
                Horário: registro?.checkin_inicio_em,
                Latitude: latitude,
                Longitude: longitude,
                "Precisão GPS (m)": Number.isFinite(precisao) ? precisao : null
            });

            io.emit("os_update");
            return res.json({ ok: true, checkin: registro });
        } catch (err) {
            console.error("ERRO CHECK-IN:", err);
            return res.status(500).json({ erro: err.message });
        }
    }
);

// ===============================
// 🚫 CLIENTE AUSENTE
// ===============================
router.post(
    "/ausente/:id",
    verificarAutenticacao,
    uploadAnexo.single("foto"),
    async (req, res) => {

        try {

            // ===============================
            // BUSCA OS
            // ===============================
            const [rows] = await db.query(`

                SELECT
                    nome,
                    telefone,
                    login
                FROM ordens_servico
                WHERE id = ?
                AND empresa_id = ?

            `, [

                req.params.id,
                req.usuario.empresa_id
            ]);

            const os =
                rows[0] || {};

            // ===============================
            // AUSENTE — grava somente os campos próprios deste status
            // ===============================
            const observacaoAusente =
                req.body.observacao_ausente ?? req.body.observacao ?? null;

            const anexoAusente = req.file
                ? "/uploads/ordens_servico/" + req.file.filename
                : null;

            await db.query(`
                UPDATE ordens_servico
                SET
                    status = 'cliente_ausente',
                    observacao_ausente = ?,
                    anexo_ausente = ?
                WHERE id = ?
                AND empresa_id = ?
            `, [
                observacaoAusente || null,
                anexoAusente,
                req.params.id,
                req.usuario.empresa_id
            ]);

            // ===============================
            // LOG
            // ===============================
            await registrarLog(

                req,

                "CLIENTE AUSENTE",

                "OS",

                req.params.id,

                {
                    Cliente:
                        os.nome,

                    Telefone:
                        os.telefone,

                    Login:
                        os.login,

                    Observação:
                        observacaoAusente,

                    Evidência:
                        req.file
                        ? "SIM"
                        : "NÃO"
                }
            );

            io.emit("os_update");

            res.json({
                ok: true
            });

        } catch (err) {

            console.error(
                "ERRO AUSENTE:",
                err
            );

            res.status(500).json({
                erro: err.message
            });
        }
    }
);

// ===============================
// 🚫 INVIABILIDADE
// ===============================
router.post(
    "/inviabilidade/:id",
    verificarAutenticacao,
    uploadAnexo.single("foto"),
    async (req, res) => {

        try {

            // ===============================
            // BUSCA OS
            // ===============================
            const [rows] = await db.query(`

                SELECT
                    nome,
                    telefone,
                    login
                FROM ordens_servico
                WHERE id = ?
                AND empresa_id = ?

            `, [

                req.params.id,
                req.usuario.empresa_id
            ]);

            const os =
                rows[0] || {};

            // ===============================
            // INVIABILIDADE
            // ===============================
            await osService.inviabilidade(

                req.params.id,

                req.usuario,

                {
                    observacao:
                        req.body.observacao,

                    evidencia:
                        req.file
                        ? req.file.path
                        : null
                }
            );

            // ===============================
            // LOG
            // ===============================
            await registrarLog(

                req,

                "INVIABILIDADE",

                "OS",

                req.params.id,

                {
                    Cliente:
                        os.nome,

                    Telefone:
                        os.telefone,

                    Login:
                        os.login,

                    Observação:
                        req.body.observacao,

                    Evidência:
                        req.file
                        ? "SIM"
                        : "NÃO"
                }
            );

            io.emit("os_update");

            res.json({
                ok: true
            });

        } catch (err) {

            console.error(
                "ERRO INVIABILIDADE:",
                err
            );

            res.status(500).json({
                erro: err.message
            });
        }
    }
);

// ===============================
// ✅ CONCLUIR
// ===============================
router.post(
    "/concluir/:id",
    verificarAutenticacao,
    uploadAnexo.single("foto"),
    async (req, res) => {
        let conn;
        try {
            // DDL e verificação estrutural nunca devem ocorrer dentro da transação da conclusão.
            await garantirEstruturaMateriaisOS();
            await garantirEstruturaCheckinOS();
            conn = await db.getConnection();
            await conn.beginTransaction();
            const [rows] = await conn.query(`SELECT nome,telefone,login,origem_equipamento,checkin_inicio_em FROM ordens_servico WHERE id=? AND empresa_id=? FOR UPDATE`,[req.params.id,req.usuario.empresa_id]);
            if(!rows.length){ const erro=new Error('OS não encontrada.');erro.statusCode=404;throw erro; }
            const os=rows[0];
            const possuiCheckin=!!os.checkin_inicio_em;
            let latitudeFim=null;
            let longitudeFim=null;
            let precisaoFim=null;
            if(possuiCheckin){
                latitudeFim=Number(req.body.checkin_fim_latitude ?? req.body.latitude_final);
                longitudeFim=Number(req.body.checkin_fim_longitude ?? req.body.longitude_final);
                precisaoFim=Number(req.body.checkin_fim_precisao ?? req.body.precisao_final);
                if(!coordenadaValida(latitudeFim,longitudeFim)){
                    const erro=new Error('Não foi possível registrar a localização final. Ative o GPS e tente novamente.');
                    erro.statusCode=400;
                    throw erro;
                }
            }
            const observacaoFinalizado=req.body.observacao_finalizado ?? req.body.observacao ?? null;
            const anexoFinalizado=req.file ? "/uploads/ordens_servico/"+req.file.filename : null;
            const resultadoEquipamentos=await processarConfirmacaoEquipamentosConclusao(
                conn,
                Number(req.params.id),
                Number(req.usuario.empresa_id),
                req.body.equipamento_utilizado,
                req.body.observacao_equipamento,
                req.body.status_pagamento_confirmado,
                req.usuario,
                req.body.anexo_pagamento_base64 || req.body.anexos_comprovantes_base64 || null,
                req.body.anexo_pagamento_nome || req.body.anexos_comprovantes_nome || null,
                req.body.anexo_pagamento_mime || req.body.anexos_comprovantes_mime || null
            );
            await conn.query(`UPDATE ordens_servico SET
                status='concluido',
                finalizado_em=NOW(),
                finalizado_por=?,
                observacao_finalizado=?,
                anexo_finalizado=?,
                checkin_fim_em=CASE WHEN checkin_inicio_em IS NOT NULL THEN NOW() ELSE NULL END,
                checkin_fim_latitude=?,
                checkin_fim_longitude=?,
                checkin_fim_precisao=?,
                checkin_fim_por=CASE WHEN checkin_inicio_em IS NOT NULL THEN ? ELSE NULL END,
                tempo_atendimento_segundos=CASE
                    WHEN checkin_inicio_em IS NOT NULL
                    THEN GREATEST(0,TIMESTAMPDIFF(SECOND,checkin_inicio_em,NOW()))
                    ELSE NULL
                END
                WHERE id=? AND empresa_id=?`,[
                    req.usuario.id,
                    observacaoFinalizado||null,
                    anexoFinalizado,
                    latitudeFim,
                    longitudeFim,
                    Number.isFinite(precisaoFim)&&precisaoFim>=0?precisaoFim:null,
                    req.usuario.id,
                    req.params.id,
                    req.usuario.empresa_id
                ]);
            const [[checkinFinal]]=await conn.query(`SELECT checkin_inicio_em,checkin_fim_em,tempo_atendimento_segundos FROM ordens_servico WHERE id=? AND empresa_id=? LIMIT 1`,[req.params.id,req.usuario.empresa_id]);
            await conn.commit();
            await registrarLog(req,"CONCLUIU OS","OS",req.params.id,{Cliente:os.nome,Telefone:os.telefone,Login:os.login,Status:"CONCLUÍDO","Observação de conclusão":observacaoFinalizado,Anexo:req.file?"SIM":"NÃO","Check-in inicial":checkinFinal?.checkin_inicio_em,"Check-in final":checkinFinal?.checkin_fim_em,"Tempo de atendimento (segundos)":checkinFinal?.tempo_atendimento_segundos,"Latitude final":latitudeFim,"Longitude final":longitudeFim,"Equipamentos utilizados":resultadoEquipamentos.utilizado==='sim'?"SIM":resultadoEquipamentos.utilizado==='nao'?"NÃO":"SEM EQUIPAMENTO","Itens devolvidos ao estoque":resultadoEquipamentos.estoqueDevolvido,"Lançamentos financeiros estornados":resultadoEquipamentos.financeiroEstornado});
            io.emit("os_update");
            res.json({ok:true,equipamentos:resultadoEquipamentos,checkin:checkinFinal,anexo_finalizado:anexoFinalizado,anexo:anexoFinalizado});
        } catch (err) {
            if(conn){ try{ await conn.rollback(); }catch(_){ } }
            console.error("ERRO CONCLUIR:",err);
            res.status(err.statusCode||500).json({erro:err.message});
        } finally {
            if(conn) conn.release();
        }
    }
);

// ===============================
// 📍 LOCALIZAÇÃO
// ===============================
router.post(
    "/localizacao/:id",
    verificarAutenticacao,
    async (req, res) => {

        try {

            const {
                latitude,
                longitude
            } = req.body;

            // ===============================
            // BUSCA OS
            // ===============================
            const [rows] = await db.query(`

                SELECT
                    nome,
                    telefone,
                    login
                FROM ordens_servico
                WHERE id = ?
                AND empresa_id = ?

            `, [

                req.params.id,
                req.usuario.empresa_id
            ]);

            const os =
                rows[0] || {};

            // ===============================
            // UPDATE
            // ===============================
            await db.query(`

                UPDATE ordens_servico

                SET

                    latitude = ?,
                    longitude = ?,
                    data_localizacao = NOW()

                WHERE id = ?
                AND empresa_id = ?

            `, [

                latitude,
                longitude,
                req.params.id,
                req.usuario.empresa_id
            ]);

            // ===============================
            // LOG
            // ===============================
            await registrarLog(

                req,

                "ATUALIZOU LOCALIZAÇÃO",

                "OS",

                req.params.id,

                {
                    Cliente:
                        os.nome,

                    Latitude:
                        latitude,

                    Longitude:
                        longitude
                }
            );

            res.json({
                ok: true
            });

        } catch (err) {

            console.error(
                "ERRO LOCALIZAÇÃO:",
                err
            );

            res.status(500).json({
                erro: err.message
            });
        }
    }
);

// ===============================
// ♻️ HISTÓRICO DE RECORRÊNCIAS POR CLIENTE
// Retorna todos os status, inclusive OS já finalizadas.
// Esta rota deve permanecer antes de router.get("/:id").
// ===============================
router.get(
    "/recorrencias",
    verificarAutenticacao,
    async (req, res) => {
        try {
            const empresaId = req.usuario.empresa_id;
            const periodo = String(req.query.periodo || "todos").trim().toLowerCase();

            let filtroPeriodo = "";
            const params = [empresaId];

            // A data de atividade considera a finalização quando existir.
            // Assim, uma OS concluída continua aparecendo no período em que foi finalizada.
            if(periodo === "mes_atual"){
                filtroPeriodo = `
                    AND COALESCE(os.finalizado_em, os.iniciado_em, os.criado_em, os.data_abertura)
                        >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                    AND COALESCE(os.finalizado_em, os.iniciado_em, os.criado_em, os.data_abertura)
                        < DATE_FORMAT(CURDATE() + INTERVAL 1 MONTH, '%Y-%m-01')
                `;
            } else if(periodo === "30_dias"){
                filtroPeriodo = `
                    AND COALESCE(os.finalizado_em, os.iniciado_em, os.criado_em, os.data_abertura)
                        >= NOW() - INTERVAL 30 DAY
                `;
            } else if(periodo === "90_dias"){
                filtroPeriodo = `
                    AND COALESCE(os.finalizado_em, os.iniciado_em, os.criado_em, os.data_abertura)
                        >= NOW() - INTERVAL 90 DAY
                `;
            }

            const [rows] = await db.query(`
                SELECT
                    os.*,
                    l.nome AS localidade_nome,
                    p.nome AS plano_nome,
                    ts.nome AS tipo_servico_nome,
                    u.usuario AS criado_por_nome,
                    uf.usuario AS finalizado_por_nome,
                    ur.usuario AS reciclada_por_nome,
                    COALESCE(os.os_raiz_id, os.id) AS cadeia_os_id,
                    COALESCE(os.finalizado_em, os.iniciado_em, os.criado_em, os.data_abertura) AS ultima_atividade_em,
                    (
                        SELECT GROUP_CONCAT(t.nome SEPARATOR ', ')
                        FROM tecnicos t
                        WHERE FIND_IN_SET(
                            t.id,
                            REPLACE(REPLACE(os.tecnico, '[', ''), ']', '')
                        )
                    ) AS tecnicos_nomes
                FROM ordens_servico os
                LEFT JOIN localidades l
                    ON l.id = os.localidade
                   AND l.empresa_id = os.empresa_id
                LEFT JOIN planos p
                    ON p.id = os.plano
                LEFT JOIN tipos_servico ts
                    ON ts.id = os.tipo_servico
                LEFT JOIN usuarios u
                    ON u.id = os.criado_por
                LEFT JOIN usuarios uf
                    ON uf.id = os.finalizado_por
                LEFT JOIN usuarios ur
                    ON ur.id = os.reciclada_por
                WHERE os.empresa_id = ?
                ${filtroPeriodo}
                ORDER BY
                    COALESCE(os.os_raiz_id, os.id) ASC,
                    COALESCE(os.numero_reciclagem, 0) ASC,
                    os.id ASC
            `, params);

            res.json({
                ok: true,
                total: rows.length,
                ordens: rows
            });
        } catch (err) {
            console.error("ERRO HISTÓRICO DE RECORRÊNCIAS:", err);
            res.status(500).json({ erro: err.message });
        }
    }
);

// ===============================
// 📚 HISTÓRICO DE OS
// Administradores: visualizam todas as OS concluídas da empresa.
// Técnicos/atendentes: visualizam as OS concluídas vinculadas aos técnicos
// associados ao usuário em usuario_tecnicos.
// NÃO exige vínculo adicional em usuario_localidades.
// ===============================
router.get(
    "/historico",
    verificarAutenticacao,
    async (req, res) => {
        try {
            const pagina = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limite = 20;

            const cargo = String(req.usuario?.cargo || "").trim().toLowerCase();
            const administrador = cargo === "administrador";
            const empresaId = Number(req.usuario.empresa_id);
            const usuarioId = Number(req.usuario.id);

            let filtroEscopo = "";
            const parametrosBase = [empresaId];

            if (!administrador) {
                // Mesma origem de vínculo usada no restante do sistema:
                // usuario -> usuario_tecnicos -> tecnico_id -> os.tecnico
                //
                // os.tecnico pode estar salvo como JSON/texto, por exemplo:
                // [1,2], ["1","2"] ou 1,2.
                filtroEscopo = `
                    AND EXISTS (
                        SELECT 1
                        FROM usuario_tecnicos ut
                        WHERE ut.usuario_id = ?
                          AND ut.empresa_id = os.empresa_id
                          AND FIND_IN_SET(
                              CAST(ut.tecnico_id AS CHAR),
                              REPLACE(
                                  REPLACE(
                                      REPLACE(
                                          REPLACE(COALESCE(os.tecnico, ''), '[', ''),
                                      ']', ''),
                                  '"', ''),
                              ' ', '')
                          ) > 0
                    )
                `;
                parametrosBase.push(usuarioId);
            }

            const [totalRows] = await db.query(`
                SELECT COUNT(*) AS total
                FROM ordens_servico os
                WHERE os.empresa_id = ?
                  AND os.status = 'concluido'
                  ${filtroEscopo}
            `, parametrosBase);

            const total = Number(totalRows[0]?.total || 0);
            const totalPaginas = Math.max(1, Math.ceil(total / limite));
            const paginaValida = Math.min(pagina, totalPaginas);
            const offsetValido = (paginaValida - 1) * limite;

            const parametrosDados = [...parametrosBase, limite, offsetValido];

            const [dados] = await db.query(`
                SELECT
                    os.*,
                    l.nome AS localidade_nome,
                    ts.nome AS tipo_servico_nome,
                    uf.usuario AS finalizado_por_nome,
                    ue.usuario AS enviado_por_nome,
                    (
                        SELECT GROUP_CONCAT(t.nome ORDER BY t.nome SEPARATOR ', ')
                        FROM tecnicos t
                        WHERE t.empresa_id = os.empresa_id
                          AND FIND_IN_SET(
                              CAST(t.id AS CHAR),
                              REPLACE(
                                  REPLACE(
                                      REPLACE(
                                          REPLACE(COALESCE(os.tecnico, ''), '[', ''),
                                      ']', ''),
                                  '"', ''),
                              ' ', '')
                          ) > 0
                    ) AS tecnicos_nomes
                FROM ordens_servico os
                LEFT JOIN localidades l
                    ON l.id = os.localidade
                   AND l.empresa_id = os.empresa_id
                LEFT JOIN tipos_servico ts
                    ON ts.id = os.tipo_servico
                LEFT JOIN usuarios uf
                    ON uf.id = os.finalizado_por
                   AND uf.empresa_id = os.empresa_id
                LEFT JOIN usuarios ue
                    ON ue.id = os.enviado_por
                   AND ue.empresa_id = os.empresa_id
                WHERE os.empresa_id = ?
                  AND os.status = 'concluido'
                  ${filtroEscopo}
                ORDER BY os.finalizado_em DESC, os.id DESC
                LIMIT ? OFFSET ?
            `, parametrosDados);

            return res.json({
                pagina: paginaValida,
                totalPaginas,
                total,
                dados
            });

        } catch (err) {
            console.error("ERRO HISTÓRICO DE OS:", err);
            return res.status(500).json({ erro: err.message });
        }
    }
);


// ===============================
// 🔍 BUSCAR POR ID
// ===============================
router.get("/:id", verificarAutenticacao, async (req, res) => {

    try {

        // As colunas de auditoria precisam existir antes do SELECT abaixo.
        await garantirEstruturaReagendamentoOS();

        const [rows] = await db.query(`

            SELECT 
                os.*,
                DATE_FORMAT(os.agendamento, '%Y-%m-%d %H:%i:%s') AS agendamento,
                DATE_FORMAT(os.agendamento_envio, '%Y-%m-%d %H:%i:%s') AS agendamento_envio,
                DATE_FORMAT(os.criado_em, '%Y-%m-%d %H:%i:%s') AS criado_em,
                DATE_FORMAT(os.data_abertura, '%Y-%m-%d %H:%i:%s') AS data_abertura,
                DATE_FORMAT(os.iniciado_em, '%Y-%m-%d %H:%i:%s') AS iniciado_em,
                DATE_FORMAT(os.finalizado_em, '%Y-%m-%d %H:%i:%s') AS finalizado_em,
                DATE_FORMAT(os.atualizado_em, '%Y-%m-%d %H:%i:%s') AS atualizado_em,

                u.usuario AS criado_por_nome,

                COALESCE(ue.usuario, 'SGOS Agendado') AS enviado_por_nome,

                uf.usuario AS finalizado_por_nome,

                (SELECT urg.usuario
                   FROM usuarios urg
                  WHERE urg.id = os.reagendado_por
                    AND urg.empresa_id = os.empresa_id
                  LIMIT 1) AS reagendado_por_nome,

                DATE_FORMAT(os.reagendado_em, '%Y-%m-%d %H:%i:%s') AS reagendado_em,

                l.nome AS localidade_nome,
                l.vlan AS localidade_vlan,

                p.nome AS plano_nome,

                ts.nome AS tipo_servico_nome,

                (
                    SELECT GROUP_CONCAT(t.nome SEPARATOR ', ')
                    FROM tecnicos t
                    WHERE FIND_IN_SET(
                        t.id,
                        REPLACE(REPLACE(os.tecnico, '[', ''), ']', '')
                    )
                ) AS tecnicos_nomes,
                (SELECT u.usuario FROM usuarios u WHERE u.id=os.equipamentos_confirmado_por AND u.empresa_id=os.empresa_id LIMIT 1) AS equipamentos_confirmado_por_nome,
                (SELECT u.usuario FROM usuarios u WHERE u.id=os.checkin_inicio_por AND u.empresa_id=os.empresa_id LIMIT 1) AS checkin_inicio_por_nome,
                (SELECT u.usuario FROM usuarios u WHERE u.id=os.checkin_fim_por AND u.empresa_id=os.empresa_id LIMIT 1) AS checkin_fim_por_nome,

                (SELECT JSON_ARRAYAGG(JSON_OBJECT('produto_id',om.produto_id,'nome',ep.nome,'quantidade',om.quantidade,'valor_unitario',om.valor_unitario,'desconto',om.desconto,'valor_total',om.valor_total)) FROM os_materiais om LEFT JOIN estoque_produtos ep ON ep.id=om.produto_id AND ep.empresa_id=om.empresa_id WHERE om.os_id=os.id AND om.empresa_id=os.empresa_id) AS materiais_os

            FROM ordens_servico os

            LEFT JOIN usuarios u
                ON u.id = os.criado_por

            LEFT JOIN usuarios uf
                ON uf.id = os.finalizado_por

            LEFT JOIN usuarios ue
                ON ue.id = os.enviado_por

            LEFT JOIN localidades l
                ON l.id = os.localidade

            LEFT JOIN planos p
                ON p.id = os.plano

            LEFT JOIN tipos_servico ts
                ON ts.id = os.tipo_servico

            WHERE os.id = ?
            AND os.empresa_id = ?

            LIMIT 1

        `, [

            req.params.id,
            req.usuario.empresa_id

        ]);

        if (!rows.length) {

            return res.status(404).json({
                erro: "OS não encontrada"
            });
        }

        res.json(rows[0]);

    } catch (err) {

        console.error("ERRO BUSCAR OS:", err);

        res.status(500).json({
            erro: err.message
        });
    }
});


// ===============================
// ✏️ EDITAR OS
// ===============================
router.put(
    "/:id",
    verificarAutenticacao,
    async (req, res) => {

    try {

        const {

            nome,
            telefone,
            login,
            id_cliente,

            latitude,
            longitude,

            localidade,
            plano,
            tipo_servico,
            prioridade,

            tecnico,

            rua,
            n,
            bairro,
            referencia,

            descricao,
            observacao,
            origem_equipamento,
            modalidade_equipamento,
            forma_pagamento_equipamento,
            materiais,

            vlan,

            agendamento,
            agendamento_envio,

            status,
            aplicativo,
            url,
            usuario: usuarioTV,
            senha

        } = req.body;

        // ===============================
        // 🔥 NORMALIZA STATUS
        // ===============================
        let statusFinal =

            (status || "aberto")
            .toString()
            .trim()
            .toLowerCase();

        statusFinal =
            statusFinal.replace(
                /\s+/g,
                "_"
            );

        // ===============================
        // 🔁 ALIASES DE STATUS
        // ===============================
        if(statusFinal === "ausente"){
            statusFinal = "cliente_ausente";
        }

        if(
            statusFinal === "inviavel" ||
            statusFinal === "inviável" ||
            statusFinal === "inviabilizado"
        ){
            statusFinal = "inviabilidade";
        }

        // ===============================
        // 🗓️ VALIDA DATAS SOMENTE QUANDO A OS CONTINUA ATIVA/AGENDADA
        // Evita bloquear edição/status de OS antiga por causa de agendamento passado.
        // ===============================
        const statusFinalizaFluxo = [
            "cliente_ausente",
            "inviabilidade",
            "concluido"
        ].includes(statusFinal);

        if(!statusFinalizaFluxo){
            try{
                validarDataHoraAtualOuFutura(agendamento, "Agendamento de Realização");
                validarDataHoraAtualOuFutura(agendamento_envio, "Agendamento de Envio");
            }catch(dataErr){
                return res.status(400).json({ erro: dataErr.message });
            }
        }

        if(agendamento_envio && statusFinal !== "em_andamento" && statusFinal !== "concluido" && statusFinal !== "cliente_ausente" && statusFinal !== "inviabilidade"){
            statusFinal = "agendado";
        }

        // ===============================
        // 🔒 REGRA TÉCNICO OBRIGATÓRIO
        // ===============================
        if((statusFinal === "os_lancada" || statusFinal === "em_andamento") && !possuiTecnicoObrigatorio(tecnico)){
            return res.status(400).json({
                erro: "Selecione pelo menos um técnico para poder lançar OS."
            });
        }

        if(agendamento_envio && !possuiTecnicoObrigatorio(tecnico)){
            return res.status(400).json({
                erro: "Selecione pelo menos um técnico para criar OS com agendamento de envio."
            });
        }

        validarSelecaoEquipamentosOS(req.body);

        // ===============================
        // ✏️ UPDATE
        // ===============================
        await db.query(`

            UPDATE ordens_servico

            SET

                nome = ?,
                telefone = ?,
                login = ?,
                id_cliente = ?,

                localidade = ?,
                plano = ?,
                tipo_servico = ?,
                prioridade = ?,

                tecnico = ?,

                rua = ?,
                n = ?,
                bairro = ?,
                referencia = ?,

                descricao = ?,
                observacao = ?,

                vlan = ?,

                latitude = ?,
                longitude = ?,

                agendamento = ?,
                agendamento_envio = ?,

                status = ?,
                aplicativo = ?,
                url = ?,
                usuario = ?,
                senha = ?

            WHERE id = ?
            AND empresa_id = ?

        `,[

            nome || null,
            telefone || null,
            login || null,
            id_cliente || null,

            localidade || null,
            plano || null,
            tipo_servico || null,
            normalizarPrioridadeOS(prioridade),

            JSON.stringify(
                tecnico || []
            ),

            rua || null,
            n || null,
            bairro || null,
            referencia || null,

            (typeof descricao === "string" ? descricao.trim() : null),
            observacao || null,

            vlan || null,

            latitude || null,
            longitude || null,

            agendamento || null,
            agendamento_envio || null,

            statusFinal,
            aplicativo || null,
            url || null,
            usuarioTV || null,
            senha || null,

            req.params.id,
            req.usuario.empresa_id
        ]);

        await salvarMateriaisOS(req.params.id, req.usuario.empresa_id, origem_equipamento, modalidade_equipamento, materiais, forma_pagamento_equipamento, req.usuario, req.body.status_pagamento_equipamento, req.body.anexo_pagamento_base64, req.body.anexo_pagamento_nome, req.body.anexo_pagamento_mime);

        // ===============================
        // 📝 LOG
        // ===============================
        try {

            await logService.registrarLog(

                req,

                "EDITOU OS",

                "OS",

                req.params.id,

                `Cliente: ${nome || "-"}`

            );

        } catch(err){

            console.error(
                "Erro registrar log:",
                err
            );
        }

        // ===============================
        // 🔄 SOCKET
        // ===============================
        io.emit("os_update");

        // 🔔 NOTIFICA SOMENTE QUANDO A OS É LANÇADA PARA O TÉCNICO.
        // O check-in muda para em_andamento, mas não deve gerar um segundo push de nova OS.
        if (statusFinal === "os_lancada") {
            io.emit("os_lancada", {
                os_id: req.params.id,
                titulo: "🚀 NOVA OS LANÇADA!",
                mensagem: `A OS #${req.params.id} foi lançada para atendimento${nome ? " - " + nome : ""}`,
                cliente: nome || ""
            });

            await enviarPushOSAndamento(req, req.params.id);
        }

        // ===============================
        // ✅ RETORNO
        // ===============================
        res.json({
            ok:true
        });

    } catch(err){

        console.error(
            "ERRO UPDATE OS:",
            err
        );

        res.status(500).json({

            erro:
                err.message ||

                "Erro interno"
        });
    }
});

// ===============================
// 🚀 LANÇAR AGENDAMENTO
// ===============================
router.post(
    "/lancar_agora/:id",
    verificarAutenticacao,
    async (req, res) => {

        try {

            const [rows] = await db.query(`
                SELECT tecnico
                FROM ordens_servico
                WHERE id = ?
                AND empresa_id = ?
                LIMIT 1
            `, [
                req.params.id,
                req.usuario.empresa_id
            ]);

            const os = rows[0] || {};

            if(!possuiTecnicoObrigatorio(os.tecnico)){
                return res.status(400).json({
                    erro: "Selecione pelo menos um técnico para poder lançar OS."
                });
            }

            await db.query(`
                UPDATE ordens_servico
                SET

                    status = 'os_lancada',
                    agendamento = NULL,
                    iniciado_em = NOW()

                WHERE id = ?
                AND empresa_id = ?
            `, [

                req.params.id,
                req.usuario.empresa_id

            ]);

await logService.registrarLog(
    req,
    "LANÇOU AGENDAMENTO",
    "OS",
    req.params.id,
    "OS lançada para o técnico"
);

            io.emit("os_update");

            io.emit("os_lancada", {
                os_id: req.params.id,
                titulo: "🚀 NOVA OS LANÇADA!",
                mensagem: `A OS agendada #${req.params.id} foi lançada para atendimento`
            });

            await enviarPushOSAndamento(req, req.params.id);

            res.json({
                ok: true
            });

        } catch (err) {

            console.error("ERRO LANÇAR AGORA:", err);

            res.status(500).json({
                erro: err.message
            });
        }
    }
);

// ===============================
// 🖨️ IMPRIMIR OS
// ===============================
router.get(
    "/imprimir/:id",
    verificarAutenticacao,
    async (req, res) => {

        try {

            // A rota já foi autenticada pelo middleware do servidor.
            // Usa a sessão validada para limitar a OS à empresa correta.
            const usuario = {
                id: req.usuario.id,
                empresa_id: req.usuario.empresa_id
            };

            // ===============================
            // 🔥 EMPRESA
            // ===============================
            const [empresaRows] = await db.query(`
                SELECT
                    nome_provedor,
                    telefone,
                    email,
                    logo,
                    cpf,
                    cnpj
                FROM empresa
                WHERE id = ?
                LIMIT 1
            `, [usuario.empresa_id]);

            const empresa = empresaRows[0] || {};

            // 🔥 CPF/CNPJ dinâmico
            const documentoEmpresa =
                empresa.cnpj ||
                empresa.cpf ||
                "-";

            // ===============================
            // 🔥 BUSCA OS
            // ===============================
            const [rows] = await db.query(`
                SELECT 
                    os.*,
                    u.usuario AS criado_por_nome,
                    l.nome AS localidade_nome,
                    ts.nome AS tipo_servico_nome,
                    p.nome AS plano_nome
                FROM ordens_servico os
                LEFT JOIN usuarios u ON u.id = os.criado_por
                LEFT JOIN localidades l ON l.id = os.localidade
                LEFT JOIN tipos_servico ts ON ts.id = os.tipo_servico
                LEFT JOIN planos p ON p.id = os.plano
                WHERE os.id = ?
                AND os.empresa_id = ?
            `, [
                req.params.id,
                usuario.empresa_id
            ]);

            if (!rows.length) {
                return res.status(404).send("OS não encontrada");
            }

            const os = rows[0];

            // ===============================

// ===============================
// 🔥 TÉCNICOS
// ===============================
let tecnicosNomes = "-";

try {

    let tecnicosIds = JSON.parse(os.tecnico);

    tecnicosIds = tecnicosIds.map(id => Number(id));

    const placeholders = tecnicosIds
        .map(() => "?")
        .join(",");

    const [tecnicos] = await db.query(`
        SELECT nome
        FROM tecnicos
        WHERE id IN (${placeholders})
    `, tecnicosIds);

    if (tecnicos.length > 0) {

        tecnicosNomes = tecnicos
            .map(t => t.nome)
            .join(", ");
    }

} catch (err) {

    console.error("ERRO TECNICOS:", err);

}  


       // ===============================
            // 🔥 LOGO
            // ===============================
            let logoHtml = "";

            if (empresa.logo) {

                logoHtml = `
                    <img
                        src="/uploads/logos/${empresa.logo}"
                        style="
                            max-width:180px;
                            max-height:90px;
                            margin-bottom:15px;
                        "
                    >
                `;
            }

            // ===============================
            // 🔥 HTML
            // ===============================
            const html = `
            <html>

            <head>

                <meta charset="UTF-8">

                <title>OS ${os.id}</title>

                <style>

                    body{
                        font-family: Arial;
                        padding: 35px;
                        color:#222;
                    }

                    .topo{
                        text-align:center;
                        border-bottom:2px solid #333;
                        padding-bottom:20px;
                        margin-bottom:25px;
                    }

                    .empresa{
                        font-size:22px;
                        font-weight:bold;
                        margin-bottom:8px;
                    }

                    .sub{
                        font-size:13px;
                        margin-bottom:3px;
                    }

                    .titulo{
                        margin-top:20px;
                        font-size:24px;
                        font-weight:bold;
                    }

                    .bloco{
                        margin-top:25px;
                    }

                    .secao{
                        background:#000;
                        color:#fff;
                        padding:8px 12px;
                        font-size:15px;
                        font-weight:bold;
                        border-radius:5px;
                        margin-bottom:15px;
                    }

                    .linha{
                        margin-bottom:10px;
                        font-size:14px;
                    }

                    .label{
                        font-weight:bold;
                    }

                    .assinaturas{
                        margin-top:80px;
                        display:flex;
                        justify-content:space-between;
                    }

                    .assinatura{
                        width:40%;
                        text-align:center;
                    }

                    .linha-ass{
                        border-top:1px solid #000;
                        margin-bottom:8px;
                    }

                    .btn-print{
                        position:fixed;
                        top:20px;
                        right:20px;
                        padding:10px 15px;
                        border:none;
                        background:#000;
                        color:#fff;
                        border-radius:5px;
                        cursor:pointer;
                    }

                    @media print {

                        .btn-print{
                            display:none;
                        }

                        body{
                            padding:20px;
                        }

                    }

                </style>

            </head>

            <body>

                <button
                    class="btn-print"
                    onclick="window.print()"
                >
                    Imprimir
                </button>

                <!-- ===================== -->
                <!-- 🔥 TOPO -->
                <!-- ===================== -->
                <div class="topo">

                    ${logoHtml}

                    <div class="empresa">
                        ${empresa.nome_provedor || "EMPRESA"}
                    </div>

                    <div class="sub">
                        CPF/CNPJ:
                        ${documentoEmpresa}
                    </div>

                    <div class="sub">
                        Telefone:
                        ${empresa.telefone || "-"}
                    </div>

                    <div class="sub">
                        Email:
                        ${empresa.email || "-"}
                    </div>

                    <div class="sub">
                        Gerado em:
                        ${new Date().toLocaleString("pt-BR")}
                    </div>

                    <div class="sub">
                        Última atualização da OS:
                        ${os.atualizado_em ? new Date(os.atualizado_em).toLocaleString("pt-BR") : "-"}
                    </div>

                    <div class="titulo">
                        ORDEM DE SERVIÇO
                    </div>

                </div>

                <!-- ===================== -->
                <!-- 🔥 DADOS DA OS -->
                <!-- ===================== -->
                <div class="bloco">

                    <div class="linha">
                        <span class="label">CLIENTE:</span>
                        ${os.nome || "-"}
                    </div>

                    <div class="linha">
                        <span class="label">LOCALIDADE:</span>
                        ${os.localidade_nome || "-"}
                    </div>

                    <div class="linha">
                        <span class="label">ENDEREÇO:</span>
                        ${os.rua || "-"},
                        ${os.n || "-"},
                        ${os.bairro || "-"},
                        ${os.referencia || "-"}
                    </div>

                    <div class="linha">
                        <span class="label">TÉCNICOS:</span>
                        ${tecnicosNomes}
                    </div>

                    <div class="linha">
                        <span class="label">TIPO DE SERVIÇO:</span>
                        ${os.tipo_servico_nome || "-"}
                    </div>

                    <div class="linha">
                        <span class="label">PLANO:</span>
                        ${os.plano_nome || "-"}
                    </div>

                    <div class="linha">
                        <span class="label">ID CLIENTE:</span>
                        ${os.id_cliente}
                    </div>

                    <div class="linha">
                        <span class="label">LOGIN:</span>
                        ${os.login_pppoe || os.login || "-"}
                    </div>

                    <div class="linha">
                        <span class="label">VLAN:</span>
                        ${os.vlan || "-"}
                    </div>

                    <div class="linha">
                        <span class="label">TELEFONE:</span>
                        ${os.telefone || "-"}
                    </div>

                    <div class="linha">
                        <span class="label">CRIADO POR:</span>
                        ${os.criado_por_nome || "-"}
                    </div>

                    <div class="linha">
                        <span class="label">DATA DA OS:</span>
                        ${
                            os.criado_em
                                ? new Date(os.criado_em).toLocaleString("pt-BR")
                                : "-"
                        }
                    </div>

                    <div class="linha">
                        <span class="label">DESCRIÇÃO:</span>

                        <div style="
                            margin-top:10px;
                            min-height:90px;
                            border:1px solid #ccc;
                            border-radius:6px;
                            padding:10px;
                        ">
                            ${os.descricao || ""}
                        </div>
                    </div>

                </div>

                <!-- ===================== -->
                <!-- 🔥 ASSINATURAS -->
                <!-- ===================== -->
                <div class="assinaturas">

                    <div class="assinatura">
                        <div class="linha-ass"></div>
                        Assinatura da Empresa
                    </div>

                    <div class="assinatura">
                        <div class="linha-ass"></div>
                        Assinatura do Cliente
                    </div>

                </div>

                <script>

                    window.onload = () => {

                        setTimeout(() => {
                            window.print();
                        }, 400);

                    };

                </script>

            </body>
            </html>
            `;

            res.send(html);

        } catch (err) {

            console.error("ERRO IMPRIMIR:", err);

            res.status(500).send("Erro ao gerar impressão da OS");

        }
    }
);

// ===============================
// 📄 COMPROVAÇÃO DE OS
// ===============================
router.get(
    "/comprovacao/:id",
    verificarAutenticacao,
    async (req, res) => {

        try {

            // Usa a sessão já validada pelo middleware.
            // Não utiliza mais o token antigo enviado pela query string.
            const usuario = {
                id: req.usuario.id,
                empresa_id: req.usuario.empresa_id
            };

            // ===============================
            // 🔥 EMPRESA
            // ===============================
            const [empresaRows] = await db.query(`
                SELECT
                    nome_provedor,
                    telefone,
                    email,
                    logo,
                    cpf,
                    cnpj
                FROM empresa
                WHERE id = ?
                LIMIT 1
            `, [usuario.empresa_id]);

            const empresa = empresaRows[0] || {};

            const documentoEmpresa =
                empresa.cnpj ||
                empresa.cpf ||
                "-";

            // ===============================
            // 🔥 BUSCA OS
            // ===============================
            const [rows] = await db.query(`
                SELECT 
    os.*,

    u.usuario AS criado_por_nome,

    uf.usuario AS finalizado_por_nome,

    l.nome AS localidade_nome,

    ts.nome AS tipo_servico_nome,

    p.nome AS plano_nome

FROM ordens_servico os

LEFT JOIN usuarios u
    ON u.id = os.criado_por

LEFT JOIN usuarios uf
    ON uf.id = os.finalizado_por

LEFT JOIN localidades l
    ON l.id = os.localidade

LEFT JOIN tipos_servico ts
    ON ts.id = os.tipo_servico

LEFT JOIN planos p
    ON p.id = os.plano

WHERE os.id = ?
AND os.empresa_id = ?
            `, [
                req.params.id,
                usuario.empresa_id
            ]);

            if (!rows.length) {
                return res.status(404).send("OS não encontrada");
            }

            const os = rows[0];

            // ===============================
            // 🔥 TÉCNICOS
            // ===============================
            let tecnicosNomes = "-";

            try {

                let tecnicosIds = JSON.parse(os.tecnico);

                tecnicosIds =
                    tecnicosIds.map(id => Number(id));

                const placeholders =
                    tecnicosIds
                        .map(() => "?")
                        .join(",");

                const [tecnicos] = await db.query(`
                    SELECT nome
                    FROM tecnicos
                    WHERE id IN (${placeholders})
                `, tecnicosIds);

                if (tecnicos.length > 0) {

                    tecnicosNomes =
                        tecnicos
                            .map(t => t.nome)
                            .join(", ");
                }

            } catch (err) {

                console.error(
                    "ERRO TECNICOS:",
                    err
                );
            }

            // ===============================
            // 🔥 LOGO
            // ===============================
            let logoHtml = "";

            if (empresa.logo) {

                logoHtml = `
                    <img
                        src="/uploads/logos/${empresa.logo}"
                        style="
                            max-width:180px;
                            max-height:90px;
                            margin-bottom:15px;
                        "
                    >
                `;
            }

            // ===============================
            // 🔥 HTML
            // ===============================
            const html = `
            <html>

            <head>

                <meta charset="UTF-8">

                <title>Comprovação OS ${os.id}</title>

                <style>

                    body{
                        font-family: Arial;
                        padding: 35px;
                        color:#222;
                    }

                    .topo{
                        text-align:center;
                        border-bottom:2px solid #333;
                        padding-bottom:20px;
                        margin-bottom:25px;
                    }

                    .empresa{
                        font-size:22px;
                        font-weight:bold;
                        margin-bottom:8px;
                    }

                    .sub{
                        font-size:13px;
                        margin-bottom:3px;
                    }

                    .titulo{
                        margin-top:20px;
                        font-size:24px;
                        font-weight:bold;
                    }

                    .bloco{
                        margin-top:25px;
                    }

                    .linha{
                        margin-bottom:10px;
                        font-size:14px;
                    }

                    .label{
                        font-weight:bold;
                    }

                    .assinaturas{
                        margin-top:80px;
                        display:flex;
                        justify-content:space-between;
                    }

                    .assinatura{
                        width:40%;
                        text-align:center;
                    }

                    .linha-ass{
                        border-top:1px solid #000;
                        margin-bottom:8px;
                    }

                    .btn-print{
                        position:fixed;
                        top:20px;
                        right:20px;
                        padding:10px 15px;
                        border:none;
                        background:#000;
                        color:#fff;
                        border-radius:5px;
                        cursor:pointer;
                    }

                    @media print {

                        .btn-print{
                            display:none;
                        }

                        body{
                            padding:20px;
                        }

                    }

                </style>

            </head>

            <body>

                <button
                    class="btn-print"
                    onclick="window.print()"
                >
                    Imprimir
                </button>

                <div class="topo">

                    ${logoHtml}

                    <div class="empresa">
                        ${empresa.nome_provedor || "EMPRESA"}
                    </div>

                    <div class="sub">
                        CPF/CNPJ:
                        ${documentoEmpresa}
                    </div>

                    <div class="sub">
                        Telefone:
                        ${empresa.telefone || "-"}
                    </div>

                    <div class="sub">
                        Email:
                        ${empresa.email || "-"}
                    </div>

                    <div class="titulo">
                        COMPROVAÇÃO DE EXECUÇÃO
                    </div>

                </div>

                <div class="bloco">

    <div class="linha">
        <span class="label">CLIENTE:</span>
        ${os.nome || "-"}
    </div>

    <div class="linha">
        <span class="label">LOCALIDADE:</span>
        ${os.localidade_nome || "-"}
    </div>

    <div class="linha">
        <span class="label">ENDEREÇO:</span>
        ${os.rua || "-"},
        ${os.n || "-"},
        ${os.bairro || "-"},
        ${os.referencia || "-"}
    </div>

    <div class="linha">
        <span class="label">TÉCNICOS:</span>
        ${tecnicosNomes}
    </div>

    <div class="linha">
        <span class="label">TIPO DE SERVIÇO:</span>
        ${os.tipo_servico_nome || "-"}
    </div>

    <div class="linha">
        <span class="label">PLANO:</span>
        ${os.plano_nome || "-"}
    </div>

    <div class="linha">
        <span class="label">ID CLIENTE:</span>
        ${os.id_cliente}
    </div>

    <div class="linha">
        <span class="label">LOGIN:</span>
        ${os.login_pppoe || os.login || "-"}
    </div>

    <div class="linha">
        <span class="label">VLAN:</span>
        ${os.vlan || "-"}
    </div>

    <div class="linha">
        <span class="label">TELEFONE:</span>
        ${os.telefone || "-"}
    </div>

    <div class="linha">
        <span class="label">CRIADO POR:</span>
        ${os.criado_por_nome || "-"}
    </div>
  
<div class="linha">
        <span class="label">INICIADO EM:</span>
        ${
            os.iniciado_em
                ? new Date(os.iniciado_em)
                    .toLocaleString("pt-BR")
                : "-"
        }
    </div>

    <div class="linha">
        <span class="label">FINALIZADO EM:</span>
        ${
            os.finalizado_em
                ? new Date(os.finalizado_em)
                    .toLocaleString("pt-BR")
                : "-"
        }
    </div>

    <div class="linha">
        <span class="label">FINALIZADO POR:</span>
        ${os.finalizado_por_nome || "-"}
    </div>

    <div class="linha">
        <span class="label">OBSERVAÇÃO DE CONCLUSÃO:</span>

        <div style="
            margin-top:10px;
            min-height:90px;
            border:1px solid #ccc;
            border-radius:6px;
            padding:10px;
        ">
            ${os.observacao_finalizado || ""}
        </div>
    </div>

</div>

                <div class="assinaturas">

                    <div class="assinatura">
                        <div class="linha-ass"></div>
                        Assinatura da Empresa
                    </div>

                    <div class="assinatura">
                        <div class="linha-ass"></div>
                        Assinatura do Cliente
                    </div>

                </div>

                <script>

                    window.onload = () => {

                        setTimeout(() => {
                            window.print();
                        }, 400);

                    };

                </script>

            </body>
            </html>
            `;

            res.send(html);

        } catch (err) {

            console.error(
                "ERRO COMPROVAÇÃO:",
                err
            );

            res.status(500).send(
                "Erro ao gerar comprovação"
            );
        }
    }
);

// ===============================
// 📎 ANEXAR ARQUIVO NA OS
// ===============================
router.post(
    "/anexo/:id",
    verificarAutenticacao,
    uploadAnexo.single("anexo"),
    async (req, res) => {

        try {

            if (!req.file) {
                return res.status(400).json({
                    erro: "Arquivo não enviado"
                });
            }

            const caminho =
                "/uploads/ordens_servico/" +
                req.file.filename;

            await db.query(`
                UPDATE ordens_servico
                SET
                    anexo_nome = ?,
                    anexo_tipo = ?,
                    anexo_path = ?
                WHERE id = ?
                AND empresa_id = ?
            `, [
                req.file.filename,
                req.file.mimetype,
                caminho,
                req.params.id,
                req.usuario.empresa_id
            ]);

            registrarLog(
    req,
    "ADICIONOU ANEXO",
    "OS",
    req.params.id,
    req.file.filename
);

            io.emit("os_update");

            res.json({
                ok: true,
                arquivo: caminho
            });

        } catch (err) {

            console.error("ERRO ANEXO:", err);

            res.status(500).json({
                erro: err.message
            });
        }
    }
);


// ===============================
// 🗑 REMOVER ANEXO
// ===============================
router.delete(
    "/remover-anexo/:id",
    verificarAutenticacao,
    async (req, res) => {

        try {

            const [rows] = await db.query(`
                SELECT anexo_path
                FROM ordens_servico
                WHERE id = ?
                AND empresa_id = ?
            `, [
                req.params.id,
                req.usuario.empresa_id
            ]);

            if (!rows.length) {
                return res.status(404).json({
                    erro: "OS não encontrada"
                });
            }

            const os = rows[0];

            // remove arquivo físico
            if (os.anexo_path) {

                const caminho = path.join(
                    __dirname,
                    "..",
                    os.anexo_path
                );

                if (fs.existsSync(caminho)) {
                    fs.unlinkSync(caminho);
                }
            }

            await db.query(`
                UPDATE ordens_servico
                SET
                    anexo_nome = NULL,
                    anexo_tipo = NULL,
                    anexo_path = NULL
                WHERE id = ?
                AND empresa_id = ?
            `, [
                req.params.id,
                req.usuario.empresa_id
            ]);

            io.emit("os_update");

            // 🔥 LOG (CORRIGIDO — estava fora de lugar)
            if (logService?.registrarLog) {
                await logService.registrarLog(
                    req,
                    "REMOVEU ANEXO",
                    "OS",
                    req.params.id,
                    null
                );
            }

            res.json({
                ok: true
            });

        } catch (err) {

            console.error("ERRO REMOVER ANEXO:", err);

            res.status(500).json({
                erro: err.message
            });
        }
    }
);

// ===============================
// ERROS DE UPLOAD EM JSON
// Evita que Multer devolva uma página HTML dentro do aplicativo.
// ===============================
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const mensagens = {
            LIMIT_FILE_SIZE: "O anexo excede o limite de 30 MB.",
            LIMIT_UNEXPECTED_FILE: "Campo de anexo inválido. Envie o arquivo no campo 'foto'.",
            LIMIT_FILE_COUNT: "Envie apenas um anexo por ação."
        };

        return res.status(400).json({
            erro: mensagens[err.code] || err.message || "Erro ao enviar anexo.",
            codigo: err.code || "MULTER_ERROR"
        });
    }

    if (err) {
        console.error("ERRO DE UPLOAD/ROTA OS:", err);
        return res.status(err.statusCode || 400).json({
            erro: err.message || "Não foi possível processar a solicitação."
        });
    }

    next();
});

return router;

};