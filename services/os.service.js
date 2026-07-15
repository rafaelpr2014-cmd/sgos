const db = require("../database");
const {
    enviarMensagem,
    enviarMidia
} = require("./whatsappService");

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
        status,
        aplicativo,
        url,
        usuario: usuarioTV,
        senha
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

    validarDataHoraAtualOuFutura(agendamento, "Agendamento de Realização");
    validarDataHoraAtualOuFutura(agendamento_envio, "Agendamento de Envio");

    if (agendamento_envio && statusFinal !== "em_andamento" && statusFinal !== "concluido") {
        statusFinal = "agendado";
    }

    // ===============================
    // 🔒 REGRA TÉCNICO OBRIGATÓRIO
    // ===============================
    if (statusFinal === "em_andamento" && !possuiTecnicoObrigatorio(tecnico)) {
        throw new Error("Selecione pelo menos um técnico para poder lançar OS.");
    }

    if (agendamento_envio && !possuiTecnicoObrigatorio(tecnico)) {
        throw new Error("Selecione pelo menos um técnico para criar OS com agendamento de envio.");
    }

    let agendamentoEnvioFinal = agendamento_envio || null;

    if (agendamento || agendamento_envio) {

        if (agendamento_envio && statusFinal !== "em_andamento" && statusFinal !== "concluido") {
            statusFinal = "agendado";
        }

        if (!agendamento_envio && agendamento && statusFinal !== "agendado" && statusFinal !== "em_andamento") {
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
    aplicativo,
    url,
    usuario,
    senha,
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
    ?, ?, ?, ?,
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
    aplicativo || null,
    url || null,
    usuarioTV || null,
    senha || null,
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