const db = require("../database");
const {
    enviarMensagem,
    enviarMidia
} = require("../whatsapp/whatsappService");

// ===============================
// 🔧 MAPA DE TÉCNICOS
// ===============================
async function getMapaTecnicos(empresa_id) {

    const [tecnicosDb] = await db.query(
        "SELECT id, nome FROM tecnicos WHERE empresa_id=?",
        [empresa_id]
    );

    const mapa = {};

    tecnicosDb.forEach(t => {
        mapa[t.id] = t.nome;
    });

    return mapa;
}

// ===============================
// 🆕 CRIAR OS (COM AGENDAMENTO CORRETO)
// ===============================
exports.criar = async (dados, usuario) => {

    if (!usuario || !usuario.empresa_id) {
        throw new Error("Usuário inválido");
    }

    const {
        nome,
        telefone,
        rua,
        n,
        bairro,
        referencia,
        tipo_servico,
        tecnico,
        agendamento,
        agendamento_envio, // 🔥 IMPORTANTE (NOVO)
        localidade,
        plano,
        id_cliente,
        login,
        vlan,
        latitude,
        longitude,
        status
    } = dados;

    let statusFinal = status || "aberto";

    statusFinal = statusFinal
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");

    // ===============================
    // 🔥 REGRA AGENDAMENTO REAL
    // ===============================
    let agendamentoEnvioFinal = null;

    if (agendamento) {

        // Segurança:
        // - sem data/horário no front, agendamento vem null e status fica aberto
        // - com data/horário e status "agendado", salva como agendado
        // - agendamento_envio nunca é preenchido automaticamente
        agendamentoEnvioFinal = agendamento_envio || null;

        if (statusFinal !== "agendado" && statusFinal !== "em_andamento") {
            statusFinal = "aberto";
        }
    }

    // ===============================
    // 🔥 VLAN
    // ===============================
    let vlanLocalidade = null;

    if (localidade) {
        const [rows] = await db.query(`
            SELECT vlan
            FROM localidades
            WHERE id = ?
            AND empresa_id = ?
        `, [localidade, usuario.empresa_id]);

        vlanLocalidade = rows?.[0]?.vlan || null;
    }

    const vlanFinal = vlan || vlanLocalidade || null;

    // ===============================
    // 🔥 INÍCIO
    // ===============================
    const iniciadoEm =
        statusFinal === "em_andamento"
            ? new Date()
            : null;

    // ===============================
    // 💾 INSERT
    // ===============================
    const [result] = await db.query(`
INSERT INTO ordens_servico (
    nome,
    telefone,
    rua,
    n,
    bairro,
    referencia,
    tipo_servico,
    tecnico,
    agendamento,
    agendamento_envio,
    empresa_id,
    status,
    localidade,
    plano,
    id_cliente,
    login,
    vlan,
    latitude,
    longitude,
    criado_por,
    iniciado_em,
    data_abertura
)
VALUES (
    ?, ?, ?, ?, ?,?,
    ?, ?,
    ?, ?,
    ?, ?,
    ?, ?,
    ?, ?,
    ?, ?,
    ?, ?,
    ?,
    NOW()
)
`, [
    nome || null,
    telefone || null,
    rua || null,
    n || null,
    bairro || null,
    referencia || null,
    tipo_servico || null,
    JSON.stringify(tecnico || []),
    agendamento || null,
    agendamentoEnvioFinal || null,
    usuario.empresa_id,
    statusFinal,
    localidade || null,
    plano || null,
    id_cliente || null,
    login || null,
    vlanFinal,
    latitude || null,
    longitude || null,
    usuario.id,
    iniciadoEm
]);

    return {
        sucesso: true,
        id: result.insertId
    };
};

// ===============================
// 📡 NOTIFICAÇÕES WHATSAPP
// ===============================
async function enviarNotificacao({
    tipo,
    os,
    tecnicos,
    usuario
}) {

    try {

        const listaTecnicos =
            tecnicos.length ? tecnicos.join(", ") : "-";

        if (!os.telefone) return;

        let msg = "";

        if (tipo === "iniciar") {
            msg = `🚀 Olá ${os.nome},

Seu atendimento foi iniciado!

👨‍🔧 Técnico(s): ${listaTecnicos}`;
        }

        if (tipo === "ausente") {
            msg = `🚫 Olá ${os.nome},

Tentamos realizar o atendimento.

📝 Observação:
${os.observacao || "-"}`;
        }

        if (tipo === "inviabilidade") {
            msg = `⚠️ Olá ${os.nome},

Não foi possível concluir o atendimento.

📝 Motivo:
${os.observacao || "-"}`;
        }

        if (tipo === "concluir") {
            msg = `✅ Olá ${os.nome},

Seu atendimento foi finalizado com sucesso!

👨‍🔧 Técnico(s): ${listaTecnicos}`;
        }

        await enviarMensagem(
            usuario.empresa_id,
            os.telefone,
            msg
        );

        if (os.evidencia) {

            const url =
                `http://SEU_DOMINIO/uploads/inviabilidades/${os.evidencia}`;

            await enviarMidia(
                usuario.empresa_id,
                os.telefone,
                url,
                "📷 Evidência do atendimento"
            );
        }

    } catch (err) {
        console.error("Erro notificação:", err);
    }
}

// ===============================
// 🚀 INICIAR OS
// ===============================
exports.iniciarOS = async (id, usuario) => {

    await db.query(`
        UPDATE ordens_servico
        SET status='em_andamento',
            iniciado_em=NOW(),
            enviado_por=?
        WHERE id=?
        AND empresa_id=?
    `, [usuario.id, id, usuario.empresa_id]);

    const [rows] = await db.query(
        "SELECT * FROM ordens_servico WHERE id=?",
        [id]
    );

    const os = rows[0];

    const mapa = await getMapaTecnicos(usuario.empresa_id);

    let tecnicos = [];

    try {
        tecnicos = JSON.parse(os.tecnico || "[]")
            .map(id => mapa[id]);
    } catch {}

    await enviarNotificacao({
        tipo: "iniciar",
        os,
        tecnicos,
        usuario
    });

    return { ok: true };
};

// ===============================
// 🚫 AUSENTE
// ===============================
exports.clienteAusente = async (id, usuario, dados) => {

    await db.query(`
        UPDATE ordens_servico
        SET status='cliente_ausente',
            observacao=?,
            evidencia=?,
            finalizado_em=NOW(),
            finalizado_por=?
        WHERE id=?
        AND empresa_id=?
    `, [
        dados.observacao || null,
        dados.evidencia || null,
        usuario.id,
        id,
        usuario.empresa_id
    ]);

    const [rows] = await db.query(
        "SELECT * FROM ordens_servico WHERE id=?",
        [id]
    );

    const os = rows[0];

    const mapa = await getMapaTecnicos(usuario.empresa_id);

    let tecnicos = [];

    try {
        tecnicos = JSON.parse(os.tecnico || "[]")
            .map(id => mapa[id]);
    } catch {}

    await enviarNotificacao({
        tipo: "ausente",
        os,
        tecnicos,
        usuario
    });

    return { ok: true };
};

// ===============================
// ⚠️ INVIABILIDADE
// ===============================
exports.inviabilidade = async (id, usuario, dados) => {

    await db.query(`
        UPDATE ordens_servico
        SET status='inviabilidade',
            observacao=?,
            evidencia=?,
            finalizado_em=NOW(),
            finalizado_por=?
        WHERE id=?
        AND empresa_id=?
    `, [
        dados.observacao || null,
        dados.evidencia || null,
        usuario.id,
        id,
        usuario.empresa_id
    ]);

    const [rows] = await db.query(
        "SELECT * FROM ordens_servico WHERE id=?",
        [id]
    );

    const os = rows[0];

    const mapa = await getMapaTecnicos(usuario.empresa_id);

    let tecnicos = [];

    try {
        tecnicos = JSON.parse(os.tecnico || "[]")
            .map(id => mapa[id]);
    } catch {}

    await enviarNotificacao({
        tipo: "inviabilidade",
        os,
        tecnicos,
        usuario
    });

    return { ok: true };
};

// ===============================
// ✅ CONCLUIR
// ===============================
exports.concluirOS = async (id, usuario) => {

    await db.query(`
        UPDATE ordens_servico
        SET status='concluido',
            finalizado_em=NOW(),
            finalizado_por=?
        WHERE id=?
        AND empresa_id=?
    `, [usuario.id, id, usuario.empresa_id]);

    const [rows] = await db.query(
        "SELECT * FROM ordens_servico WHERE id=?",
        [id]
    );

    const os = rows[0];

    const mapa = await getMapaTecnicos(usuario.empresa_id);

    let tecnicos = [];

    try {
        tecnicos = JSON.parse(os.tecnico || "[]")
            .map(id => mapa[id]);
    } catch {}

    await enviarNotificacao({
        tipo: "concluir",
        os,
        tecnicos,
        usuario
    });

    return { ok: true };
};