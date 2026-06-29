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
            fileSize: 5 * 1024 * 1024 // 5MB
        },

        fileFilter: (req, file, cb) => {

            const permitidos = [
                "image/jpeg",
                "image/png",
                "image/webp",
                "video/mp4",
                "video/webm",
                "video/quicktime"
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
                            os.status = 'agendado'
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
                            os.status = 'agendado'
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
                            os.status = 'agendado'
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
                            os.status = 'agendado'
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
                    AND os.status = 'agendado'
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
                            os.status = 'agendado'
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
                ) AS tecnicos_nomes

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
            const resultado =
                await osService.criar(
                    dados,
                    req.usuario
                );

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

            // ===============================
            // 🔔 PUSH MOBILE - NOVA OS
            // Envia para todos os usuários vinculados aos técnicos selecionados.
            // Não bloqueia a criação da OS caso o Firebase falhe.
            // ===============================
            try {

                const pushService = req.app.get("pushService");

                if (pushService && Array.isArray(dados.tecnico) && dados.tecnico.length) {

                    const tecnicoIds = dados.tecnico
                        .map(id => Number(id))
                        .filter(id => !Number.isNaN(id));

                    if (tecnicoIds.length) {

                        const [usuariosPush] = await db.query(`
                            SELECT DISTINCT usuario_id
                            FROM usuario_tecnicos
                            WHERE empresa_id = ?
                            AND tecnico_id IN (?)
                        `, [
                            req.usuario.empresa_id,
                            tecnicoIds
                        ]);

                        for (const u of usuariosPush) {

                            await pushService.enviarPushNovaOS({
                                usuarioId: u.usuario_id,
                                empresaId: req.usuario.empresa_id,
                                osId: resultado.id,
                                cliente: dados.nome
                            });
                        }
                    }
                }

            } catch (pushErr) {

                console.error(
                    "Erro ao enviar push da nova OS:",
                    pushErr
                );
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

                    status = 'em_andamento',
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

                "INICIOU OS",

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
                        "EM ANDAMENTO"
                }
            );

            io.emit("os_update");

            io.emit("os_andamento", {
                os_id: req.params.id,
                titulo: "🚀 OS em andamento",
                mensagem: `A OS #${req.params.id} entrou em andamento${os.nome ? " - " + os.nome : ""}`,
                cliente: os.nome || ""
            });

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
// 🚫 CLIENTE AUSENTE
// ===============================
router.post(
    "/ausente/:id",
    verificarAutenticacao,
    upload.single("foto"),
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
            // AUSENTE
            // ===============================
            await osService.clienteAusente(

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
    upload.single("foto"),
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
            // CONCLUIR
            // ===============================
            await osService.concluirOS(

                req.params.id,
                req.usuario
            );

            // ===============================
            // LOG
            // ===============================
            await registrarLog(

                req,

                "CONCLUIU OS",

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
                        "CONCLUÍDO"
                }
            );

            io.emit("os_update");

            res.json({
                ok: true
            });

        } catch (err) {

            console.error(
                "ERRO CONCLUIR:",
                err
            );

            res.status(500).json({
                erro: err.message
            });
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
// 📚 HISTÓRICO DE OS
// ===============================
router.get(
    "/historico",
    verificarAutenticacao,
    async (req, res) => {

        try {

            const pagina =
                parseInt(req.query.page) || 1;

            const limite = 20;

            const offset =
                (pagina - 1) * limite;

            const [totalRows] =
                await db.query(`
                    SELECT COUNT(*) total
                    FROM ordens_servico
                    WHERE empresa_id = ?
                    AND status = 'concluido'
                `,
                [req.usuario.empresa_id]);

            const total =
                totalRows[0].total;

            const totalPaginas =
                Math.ceil(total / limite);

            const [dados] =
                await db.query(`

                    SELECT
                        os.*,

                        l.nome AS localidade_nome,
                        ts.nome AS tipo_servico_nome,

                        uf.usuario AS finalizado_por_nome,
                        ue.usuario AS enviado_por_nome,

                        (
                            SELECT GROUP_CONCAT(t.nome SEPARATOR ', ')
                            FROM tecnicos t
                            WHERE FIND_IN_SET(
                                t.id,
                                REPLACE(REPLACE(os.tecnico,'[',''),']','')
                            )
                        ) AS tecnicos_nomes

                    FROM ordens_servico os

                    LEFT JOIN localidades l
                        ON l.id = os.localidade

                    LEFT JOIN tipos_servico ts
                        ON ts.id = os.tipo_servico

                    LEFT JOIN usuarios uf
                        ON uf.id = os.finalizado_por

                    LEFT JOIN usuarios ue
                        ON ue.id = os.enviado_por

                    WHERE os.empresa_id = ?
                    AND os.status = 'concluido'

                    ORDER BY os.finalizado_em DESC

                    LIMIT ?
                    OFFSET ?

                `,[

                    req.usuario.empresa_id,
                    limite,
                    offset

                ]);

            res.json({

                pagina,
                totalPaginas,
                dados

            });

        } catch(err){

            console.error(err);

            res.status(500).json({
                erro: err.message
            });
        }
    }
);


// ===============================
// 🔍 BUSCAR POR ID
// ===============================
router.get("/:id", verificarAutenticacao, async (req, res) => {

    try {

        const [rows] = await db.query(`

            SELECT 
                os.*,

                u.usuario AS criado_por_nome,

                COALESCE(ue.usuario, 'SGOS Agendado') AS enviado_por_nome,

                uf.usuario AS finalizado_por_nome,

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
                ) AS tecnicos_nomes

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

            tecnico,

            rua,
            n,
            bairro,
            referencia,

            observacao,

            vlan,

            agendamento,
            agendamento_envio,

            status

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

                tecnico = ?,

                rua = ?,
                n = ?,
                bairro = ?,
                referencia = ?,

                observacao = ?,

                vlan = ?,

                latitude = ?,
                longitude = ?,

                agendamento = ?,
                agendamento_envio = ?,

                status = ?

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

            JSON.stringify(
                tecnico || []
            ),

            rua || null,
            n || null,
            bairro || null,
            referencia || null,

            observacao || null,

            vlan || null,

            latitude || null,
            longitude || null,

            agendamento || null,
            agendamento_envio || null,

            statusFinal,

            req.params.id,
            req.usuario.empresa_id
        ]);

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

            await db.query(`
                UPDATE ordens_servico
                SET

                    status = 'em_andamento',
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
    "OS enviada para andamento"
);

            io.emit("os_update");

            io.emit("os_andamento", {
                os_id: req.params.id,
                titulo: "🚀 Agendamento em andamento",
                mensagem: `A OS agendada #${req.params.id} entrou em andamento`
            });

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
    async (req, res) => {

        try {

            // ===============================
            // 🔐 TOKEN
            // ===============================
            const token = req.query.token;

            if (!token) {
                return res.status(401).send("Não autenticado");
            }

            let usuarioId;

            try {

                const decoded = Buffer
                    .from(token, "base64")
                    .toString("utf-8");

                usuarioId = decoded.replace("_SGOS", "");

            } catch {
                return res.status(401).send("Token inválido");
            }

            if (!usuarioId) {
                return res.status(401).send("Não autenticado");
            }

            // ===============================
            // 🔐 USUÁRIO
            // ===============================
            const [usuarios] = await db.query(`
                SELECT 
                    id,
                    empresa_id
                FROM usuarios
                WHERE id = ?
                LIMIT 1
            `, [usuarioId]);

            if (!usuarios.length) {
                return res.status(401).send("Usuário inválido");
            }

            const usuario = usuarios[0];

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
                        <span class="label">OBSERVAÇÕES:</span>

                        <div style="
                            margin-top:10px;
                            min-height:90px;
                            border:1px solid #ccc;
                            border-radius:6px;
                            padding:10px;
                        ">
                            ${os.observacoes || ""}
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
    async (req, res) => {

        try {

            // ===============================
            // 🔐 TOKEN
            // ===============================
            const token = req.query.token;

            if (!token) {
                return res.status(401).send("Não autenticado");
            }

            let usuarioId;

            try {

                const decoded = Buffer
                    .from(token, "base64")
                    .toString("utf-8");

                usuarioId = decoded.replace("_SGOS", "");

            } catch {

                return res.status(401).send("Token inválido");
            }

            if (!usuarioId) {
                return res.status(401).send("Não autenticado");
            }

            // ===============================
            // 🔐 USUÁRIO
            // ===============================
            const [usuarios] = await db.query(`
                SELECT 
                    id,
                    empresa_id
                FROM usuarios
                WHERE id = ?
                LIMIT 1
            `, [usuarioId]);

            if (!usuarios.length) {
                return res.status(401).send("Usuário inválido");
            }

            const usuario = usuarios[0];

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
        <span class="label">OBSERVAÇÕES:</span>

        <div style="
            margin-top:10px;
            min-height:90px;
            border:1px solid #ccc;
            border-radius:6px;
            padding:10px;
        ">
            ${os.observacoes || ""}
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

return router;

};