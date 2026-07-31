const express = require('express');
const router = express.Router();
const pool = require('../database');

async function executar(sql, params = []) {
    const [resultado] = await pool.query(sql, params);
    return resultado;
}

function obterUsuarioId(req) {
    return Number(
        req.user?.id ||
        req.usuario?.id ||
        req.session?.usuario?.id ||
        req.session?.usuario_id ||
        req.headers['x-usuario-id'] ||
        req.body?.usuario_id
    );
}

async function obterUsuario(usuarioId) {
    if (!usuarioId) return null;
    const rows = await executar('SELECT * FROM usuarios WHERE id = ? LIMIT 1', [usuarioId]);
    return rows[0] || null;
}

let colunasUsuariosCache = null;
async function obterColunasUsuarios() {
    if (colunasUsuariosCache) return colunasUsuariosCache;
    const colunas = await executar('SHOW COLUMNS FROM usuarios');
    colunasUsuariosCache = new Set(colunas.map(c => c.Field));
    return colunasUsuariosCache;
}

function primeiraColunaExistente(colunas, candidatas, fallback = null) {
    return candidatas.find(nome => colunas.has(nome)) || fallback;
}

function normalizarDataMysql(valor) {
    if (!valor) return null;
    const texto = String(valor).trim().replace('T', ' ');
    const data = new Date(String(valor));
    if (Number.isNaN(data.getTime())) return null;
    return texto.length === 16 ? `${texto}:00` : texto.slice(0, 19);
}


function normalizarDestinatarios(body, usuarioId) {
    const recebidos = Array.isArray(body?.destinatarios_ids)
        ? body.destinatarios_ids
        : [body?.destinatario_id];

    return [...new Set(
        recebidos
            .map(Number)
            .filter(id => Number.isInteger(id) && id > 0 && id !== Number(usuarioId))
    )];
}

async function validarDestinatarios(usuario, destinatariosIds) {
    if (!destinatariosIds.length) return [];

    const colunas = await obterColunasUsuarios();
    const colunaCargo = primeiraColunaExistente(
        colunas,
        ['cargo', 'tipo', 'perfil', 'nivel', 'role', 'tipo_usuario']
    );

    if (!colunaCargo) {
        throw new Error('A coluna de cargo/perfil não foi encontrada na tabela usuarios.');
    }

    const placeholders = destinatariosIds.map(() => '?').join(',');
    const params = [...destinatariosIds];

    let filtroEmpresa = '';
    if (usuario.empresa_id != null) {
        filtroEmpresa = ' AND empresa_id = ?';
        params.push(usuario.empresa_id);
    }

    const rows = await executar(
        `SELECT *
           FROM usuarios
          WHERE id IN (${placeholders})
            ${filtroEmpresa}`,
        params
    );

    const permitidos = rows.filter(destinatario => {
        const perfil = String(destinatario[colunaCargo] || '').trim().toLowerCase();
        return ['admin', 'administrador', 'atendente'].includes(perfil);
    });

    return permitidos;
}

async function limparExpirados() {
    try {
        await executar(
            `DELETE FROM lembretes
              WHERE excluir_em IS NOT NULL
                AND excluir_em <= NOW()
              LIMIT 100`
        );
    } catch (erro) {
        console.error('Erro ao limpar lembretes expirados:', erro.message);
    }
}

router.get('/usuarios', async (req, res) => {
    try {
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);
        if (!usuario) return res.status(401).json({ erro: 'Usuário não autenticado.' });

        const colunas = await obterColunasUsuarios();
        const colunaNome = primeiraColunaExistente(colunas, ['nome', 'usuario', 'username'], 'id');
        // No SGOS o perfil está na coluna cargo. As demais opções são apenas fallback.
        const colunaCargo = primeiraColunaExistente(colunas, ['cargo', 'tipo', 'perfil', 'nivel', 'role', 'tipo_usuario']);
        const colunaEmpresa = colunas.has('empresa_id') ? 'empresa_id' : null;
        const colunaAtivo = primeiraColunaExistente(colunas, ['ativo', 'status']);

        if (!colunaCargo) {
            return res.status(500).json({ erro: 'A coluna de cargo/perfil não foi encontrada na tabela usuarios.' });
        }

        const filtros = [
            'id <> ?',
            `LOWER(TRIM(COALESCE(${colunaCargo}, ''))) IN ('admin','administrador','atendente')`
        ];
        const params = [usuario.id];

        if (colunaEmpresa && usuario.empresa_id != null) {
            filtros.push(`${colunaEmpresa} = ?`);
            params.push(usuario.empresa_id);
        }

        if (colunaAtivo === 'ativo') {
            filtros.push('(ativo = 1 OR ativo IS NULL)');
        } else if (colunaAtivo === 'status') {
            filtros.push(`LOWER(COALESCE(status, 'ativo')) NOT IN ('inativo','bloqueado','desativado')`);
        }

        const rows = await executar(
            `SELECT id,
                    ${colunaNome} AS nome,
                    ${colunaCargo} AS tipo_usuario
               FROM usuarios
              WHERE ${filtros.join(' AND ')}
              ORDER BY ${colunaNome} ASC`,
            params
        );

        return res.json({ usuarios: rows });
    } catch (erro) {
        console.error('Erro ao listar usuários para lembrete:', erro);
        return res.status(500).json({ erro: 'Erro ao carregar usuários.' });
    }
});

router.get('/painel', async (req, res) => {
    try {
        await limparExpirados();
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);
        if (!usuario) return res.status(401).json({ erro: 'Usuário não autenticado.' });

        const params = [usuario.id, usuario.id, usuario.id];
        let empresaFiltro = '';
        if (usuario.empresa_id != null) {
            empresaFiltro = 'AND l.empresa_id = ?';
            params.push(usuario.empresa_id);
        }
        params.push(usuario.id);

        const lembretes = await executar(
            `SELECT l.id,
                    l.mensagem,
                    l.tipo,
                    l.criado_por_id,
                    l.destinatario_id,
                    l.criado_em,
                    l.agendado_para,
                    l.lido_em,
                    l.visivel_ate,
                    l.removido_em,
                    COALESCE(uc.usuario, CONCAT('Usuário ', l.criado_por_id)) AS criado_por_nome,
                    COALESCE(ud.usuario, CONCAT('Usuário ', l.destinatario_id)) AS destinatario_nome
               FROM lembretes l
               LEFT JOIN usuarios uc ON uc.id = l.criado_por_id
               LEFT JOIN usuarios ud ON ud.id = l.destinatario_id
              WHERE l.removido_em IS NULL
                AND (l.agendado_para IS NULL OR l.agendado_para <= NOW())
                AND (
                    (l.tipo = 'salvo' AND l.destinatario_id = ?)
                    OR
                    (l.tipo = 'enviado'
                        AND (l.criado_por_id = ? OR l.destinatario_id = ?)
                        AND (l.lido_em IS NULL OR l.visivel_ate > NOW())
                    )
                )
                ${empresaFiltro}
              ORDER BY
                    CASE WHEN l.tipo = 'enviado' AND l.lido_em IS NULL AND l.destinatario_id = ? THEN 0 ELSE 1 END,
                    COALESCE(l.agendado_para, l.criado_em) DESC`,
            params
        );

        return res.json({ lembretes, usuario_id: usuario.id });
    } catch (erro) {
        console.error('Erro ao buscar lembretes do painel:', erro);
        return res.status(500).json({ erro: 'Erro ao carregar lembretes.' });
    }
});

router.get('/historico', async (req, res) => {
    try {
        await limparExpirados();
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);
        if (!usuario) return res.status(401).json({ erro: 'Usuário não autenticado.' });

        const categoria = String(req.query.categoria || 'todos').toLowerCase();
        const periodo = String(req.query.periodo || 'todos').toLowerCase();
        const leitura = String(req.query.leitura || 'todos').toLowerCase();
        const usuarioFiltro = Number(req.query.usuario_id || 0);
        const direcaoUsuario = String(req.query.direcao_usuario || 'todos').toLowerCase();

        const filtros = ['(l.criado_por_id = ? OR l.destinatario_id = ?)'];
        const params = [usuario.id, usuario.id];

        if (categoria === 'recebidos') {
            filtros.push("l.tipo = 'enviado' AND l.destinatario_id = ?");
            params.push(usuario.id);
        } else if (categoria === 'enviados') {
            filtros.push("l.tipo = 'enviado' AND l.criado_por_id = ?");
            params.push(usuario.id);
        } else if (categoria === 'salvos') {
            filtros.push("l.tipo = 'salvo' AND l.criado_por_id = ?");
            params.push(usuario.id);
        }

        if (periodo === 'hoje') {
            filtros.push('DATE(COALESCE(l.agendado_para, l.criado_em)) = CURDATE()');
        } else if (periodo === 'ontem') {
            filtros.push('DATE(COALESCE(l.agendado_para, l.criado_em)) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)');
        } else if (periodo === '7dias') {
            filtros.push('COALESCE(l.agendado_para, l.criado_em) >= DATE_SUB(NOW(), INTERVAL 7 DAY)');
        }

        if (leitura === 'lido') {
            filtros.push("l.tipo = 'enviado' AND l.lido_em IS NOT NULL");
        } else if (leitura === 'nao_lido') {
            filtros.push("l.tipo = 'enviado' AND l.lido_em IS NULL AND l.removido_em IS NULL");
        }

        if (usuarioFiltro > 0) {
            if (direcaoUsuario === 'recebido_de') {
                filtros.push('l.criado_por_id = ? AND l.destinatario_id = ?');
                params.push(usuarioFiltro, usuario.id);
            } else if (direcaoUsuario === 'enviado_para') {
                filtros.push('l.criado_por_id = ? AND l.destinatario_id = ?');
                params.push(usuario.id, usuarioFiltro);
            } else {
                filtros.push('(l.criado_por_id = ? OR l.destinatario_id = ?)');
                params.push(usuarioFiltro, usuarioFiltro);
            }
        }

        if (usuario.empresa_id != null) {
            filtros.push('l.empresa_id = ?');
            params.push(usuario.empresa_id);
        }

        const rows = await executar(
            `SELECT l.id,
                    l.mensagem,
                    l.tipo,
                    l.criado_por_id,
                    l.destinatario_id,
                    l.criado_em,
                    l.agendado_para,
                    l.lido_em,
                    l.visivel_ate,
                    l.removido_em,
                    l.excluir_em,
                    COALESCE(uc.usuario, CONCAT('Usuário ', l.criado_por_id)) AS criado_por_nome,
                    COALESCE(ud.usuario, CONCAT('Usuário ', l.destinatario_id)) AS destinatario_nome
               FROM lembretes l
               LEFT JOIN usuarios uc ON uc.id = l.criado_por_id
               LEFT JOIN usuarios ud ON ud.id = l.destinatario_id
              WHERE ${filtros.join(' AND ')}
              ORDER BY COALESCE(l.agendado_para, l.criado_em) DESC
              LIMIT 500`,
            params
        );

        return res.json({ lembretes: rows, usuario_id: usuario.id });
    } catch (erro) {
        console.error('Erro ao carregar histórico de lembretes:', erro);
        return res.status(500).json({ erro: 'Erro ao carregar histórico.' });
    }
});

router.post('/', async (req, res) => {
    const conexao = await pool.getConnection();

    try {
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);
        const mensagem = String(req.body?.mensagem || '').trim();
        const tipo = String(req.body?.tipo || 'salvo').trim().toLowerCase();
        const agendadoPara = normalizarDataMysql(req.body?.agendado_para);

        if (!usuario) {
            return res.status(401).json({ erro: 'Usuário não autenticado.' });
        }

        if (!mensagem) {
            return res.status(400).json({ erro: 'Digite o lembrete.' });
        }

        if (mensagem.length > 2000) {
            return res.status(400).json({
                erro: 'O lembrete deve ter no máximo 2.000 caracteres.'
            });
        }

        if (!['salvo', 'enviado'].includes(tipo)) {
            return res.status(400).json({ erro: 'Tipo de lembrete inválido.' });
        }

        if (req.body?.agendado_para && !agendadoPara) {
            return res.status(400).json({ erro: 'Data de agendamento inválida.' });
        }

        if (agendadoPara) {
            const dataAgendada = new Date(String(req.body.agendado_para));

            if (dataAgendada.getTime() <= Date.now()) {
                return res.status(400).json({
                    erro: 'Escolha uma data e hora futura para o agendamento.'
                });
            }
        }

        let destinatarios = [usuario];

        if (tipo === 'enviado') {
            const destinatariosIds = normalizarDestinatarios(req.body, usuario.id);

            if (!destinatariosIds.length) {
                return res.status(400).json({
                    erro: 'Selecione pelo menos um usuário destinatário.'
                });
            }

            destinatarios = await validarDestinatarios(usuario, destinatariosIds);

            const encontrados = new Set(destinatarios.map(item => Number(item.id)));
            const naoEncontrados = destinatariosIds.filter(id => !encontrados.has(Number(id)));

            if (naoEncontrados.length) {
                return res.status(400).json({
                    erro: 'Um ou mais destinatários não foram encontrados, estão inativos, pertencem a outra empresa ou não possuem cargo permitido.',
                    destinatarios_invalidos: naoEncontrados
                });
            }
        }

        await conexao.beginTransaction();

        const idsCriados = [];

        for (const destinatario of destinatarios) {
            const [resultado] = await conexao.query(
                `INSERT INTO lembretes
                    (
                        empresa_id,
                        criado_por_id,
                        destinatario_id,
                        mensagem,
                        tipo,
                        criado_em,
                        agendado_para,
                        excluir_em
                    )
                 VALUES (
                    ?, ?, ?, ?, ?, NOW(), ?,
                    CASE
                        WHEN ? = 'enviado'
                            THEN DATE_ADD(COALESCE(?, NOW()), INTERVAL 30 DAY)
                        ELSE NULL
                    END
                 )`,
                [
                    usuario.empresa_id ?? 0,
                    usuario.id,
                    destinatario.id,
                    mensagem,
                    tipo,
                    agendadoPara,
                    tipo,
                    agendadoPara
                ]
            );

            idsCriados.push(resultado.insertId);
        }

        await conexao.commit();

        const total = idsCriados.length;

        let textoAcao;

        if (tipo === 'salvo') {
            textoAcao = agendadoPara
                ? 'Lembrete pessoal agendado.'
                : 'Lembrete salvo no seu painel.';
        } else {
            textoAcao = agendadoPara
                ? `Lembrete agendado para ${total} usuário(s).`
                : `Lembrete enviado para ${total} usuário(s).`;
        }

        return res.status(201).json({
            ok: true,
            ids: idsCriados,
            total,
            mensagem: textoAcao
        });

    } catch (erro) {
        try {
            await conexao.rollback();
        } catch {}

        console.error('Erro ao criar lembrete:', erro);

        return res.status(500).json({
            erro: erro.message || 'Erro ao salvar lembrete.'
        });
    } finally {
        conexao.release();
    }
});


router.patch('/:id', async (req, res) => {
    try {
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);
        const lembreteId = Number(req.params.id);
        const mensagem = String(req.body?.mensagem || '').trim();
        const tipo = String(req.body?.tipo || 'salvo').trim().toLowerCase();
        const destinatarioId = tipo === 'enviado' ? Number(req.body?.destinatario_id) : usuarioId;
        const agendadoPara = normalizarDataMysql(req.body?.agendado_para);

        if (!usuario) return res.status(401).json({ erro: 'Usuário não autenticado.' });
        if (!mensagem) return res.status(400).json({ erro: 'Digite o lembrete.' });
        if (mensagem.length > 2000) return res.status(400).json({ erro: 'O lembrete deve ter no máximo 2.000 caracteres.' });
        if (!['salvo', 'enviado'].includes(tipo)) return res.status(400).json({ erro: 'Tipo de lembrete inválido.' });
        if (req.body?.agendado_para && !agendadoPara) return res.status(400).json({ erro: 'Data de agendamento inválida.' });

        const atual = (await executar('SELECT * FROM lembretes WHERE id = ? LIMIT 1', [lembreteId]))[0];
        if (!atual || Number(atual.criado_por_id) !== Number(usuario.id) || atual.removido_em) {
            return res.status(404).json({ erro: 'Lembrete não encontrado ou você não pode editá-lo.' });
        }
        if (atual.tipo === 'enviado' && atual.lido_em) {
            return res.status(409).json({ erro: 'Este lembrete já foi lido e não pode mais ser editado.' });
        }

        // Somente quem enviou/criou pode editar. Lembretes enviados ficam editáveis
        // até o primeiro registro de leitura pelo destinatário.
        if (Number(atual.criado_por_id) !== Number(usuario.id)) {
            return res.status(403).json({ erro: 'Somente o remetente pode editar este lembrete.' });
        }

        let destinatario = usuario;
        if (tipo === 'enviado') {
            if (!destinatarioId || destinatarioId === usuario.id) return res.status(400).json({ erro: 'Selecione outro usuário destinatário.' });
            destinatario = await obterUsuario(destinatarioId);
            if (!destinatario) return res.status(404).json({ erro: 'Usuário destinatário não encontrado.' });
            if (usuario.empresa_id != null && Number(destinatario.empresa_id) !== Number(usuario.empresa_id)) return res.status(403).json({ erro: 'Não é permitido enviar para outra empresa.' });
            const colunas = await obterColunasUsuarios();
            const colunaCargo = primeiraColunaExistente(colunas, ['cargo', 'tipo', 'perfil', 'nivel', 'role', 'tipo_usuario']);
            const perfil = colunaCargo ? String(destinatario[colunaCargo] || '').trim().toLowerCase() : '';
            if (!['admin', 'administrador', 'atendente'].includes(perfil)) return res.status(403).json({ erro: 'O destinatário precisa ser Atendente ou Administrador.' });
        }

        await executar(
            `UPDATE lembretes
                SET mensagem = ?, tipo = ?, destinatario_id = ?, agendado_para = ?,
                    lido_em = NULL, visivel_ate = NULL,
                    excluir_em = CASE WHEN ? = 'enviado' THEN DATE_ADD(COALESCE(?, NOW()), INTERVAL 30 DAY) ELSE NULL END
              WHERE id = ? AND criado_por_id = ? AND removido_em IS NULL`,
            [mensagem, tipo, destinatario.id, agendadoPara, tipo, agendadoPara, lembreteId, usuario.id]
        );
        return res.json({ ok: true, mensagem: 'Lembrete atualizado com sucesso.' });
    } catch (erro) {
        console.error('Erro ao editar lembrete:', erro);
        return res.status(500).json({ erro: 'Erro ao editar lembrete.' });
    }
});

router.patch('/:id/lido', async (req, res) => {
    try {
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);
        const lembreteId = Number(req.params.id);
        if (!usuario) return res.status(401).json({ erro: 'Usuário não autenticado.' });

        const resultado = await executar(
            `UPDATE lembretes
                SET lido_em = COALESCE(lido_em, NOW()),
                    visivel_ate = COALESCE(visivel_ate, DATE_ADD(NOW(), INTERVAL 2 HOUR))
              WHERE id = ?
                AND tipo = 'enviado'
                AND destinatario_id = ?
                AND (agendado_para IS NULL OR agendado_para <= NOW())
                AND removido_em IS NULL`,
            [lembreteId, usuario.id]
        );

        if (!resultado.affectedRows) {
            return res.status(404).json({ erro: 'Lembrete recebido não encontrado ou ainda não liberado.' });
        }
        return res.json({ ok: true, mensagem: 'Lembrete marcado como lido. Ele ficará visível no painel por mais 2 horas.' });
    } catch (erro) {
        console.error('Erro ao marcar lembrete como lido:', erro);
        return res.status(500).json({ erro: 'Erro ao atualizar lembrete.' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const usuarioId = obterUsuarioId(req);
        const usuario = await obterUsuario(usuarioId);
        const lembreteId = Number(req.params.id);
        if (!usuario) return res.status(401).json({ erro: 'Usuário não autenticado.' });

        const resultado = await executar(
            `UPDATE lembretes
                SET removido_em = NOW(),
                    excluir_em = COALESCE(excluir_em, DATE_ADD(NOW(), INTERVAL 30 DAY))
              WHERE id = ?
                AND criado_por_id = ?
                AND removido_em IS NULL`,
            [lembreteId, usuario.id]
        );

        if (!resultado.affectedRows) {
            return res.status(404).json({ erro: 'Lembrete não encontrado ou você não pode excluí-lo.' });
        }
        return res.json({ ok: true, mensagem: 'Lembrete excluído do painel e mantido no histórico por 30 dias.' });
    } catch (erro) {
        console.error('Erro ao remover lembrete:', erro);
        return res.status(500).json({ erro: 'Erro ao remover lembrete.' });
    }
});

module.exports = router;
