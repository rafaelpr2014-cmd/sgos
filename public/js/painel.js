// ===============================
// VARIÁVEIS GLOBAIS
// ===============================
let ordens = [];
let osAvulsas = [];
let osAvulsasConcluidas = [];
let tecnicosMap = {};

// ===============================
// API FETCH
// ===============================
async function apiFetch(url, options = {}) {
    const usuario = JSON.parse(localStorage.getItem("usuario"));

    if (!usuario || !usuario.id) {
        alert("Sessão expirada.");
        window.location.href = "/login.html";
        return;
    }

    const res = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "x-usuario-id": usuario.id,
            ...(options.headers || {})
        }
    });

    if (!res.ok) {
        const text = await res.text();
        console.error("Erro API:", text);
        throw new Error("Erro API");
    }

    return res.json();
}

// ===============================
// CARREGAR MAPA DE TÉCNICOS
// ===============================
async function carregarTecnicosMap() {
    try {
        const lista = await apiFetch("/api/ordens_servico/tecnicos");

        tecnicosMap = {}; // garante reset limpo

        lista.forEach(t => {
            tecnicosMap[String(t.id)] = t.nome;
        });

    } catch (err) {
        console.error("Erro ao carregar técnicos:", err);
    }
}

// ===============================
// HELPERS
// ===============================
function normalizarTecnicos(valor) {
    if (!valor) return [];

    if (Array.isArray(valor)) return valor;

    if (typeof valor === "string") {
        try {
            const parsed = JSON.parse(valor);
            if (Array.isArray(parsed)) return parsed;
            return String(parsed).split(",").map(t => t.trim()).filter(Boolean);
        } catch {
            return valor.split(",").map(t => t.trim()).filter(Boolean);
        }
    }

    return [valor];
}

// ===============================
// RESUMO
// ===============================
function gerarResumoTopo(lista){

    const emAndamento = lista.filter(o => o.status === "em_andamento");

    const tecnicos = {};
    const localidades = {};
    const tipos = {};

    emAndamento.forEach(o => {

        // 👨‍🔧 técnicos (CORRIGIDO)
        const listaTec = normalizarTecnicos(o.tecnicos_nomes);

        listaTec.forEach(t => {
            const nome = tecnicosMap[String(t)] || t;
            if (!nome) return;

            tecnicos[nome] = (tecnicos[nome] || 0) + 1;
        });

        // 📍 localidades
        if (o.localidade_nome) {
            localidades[o.localidade_nome] =
                (localidades[o.localidade_nome] || 0) + 1;
        }

        // 🛠️ serviços
        if (o.tipo_servico_nome) {
            tipos[o.tipo_servico_nome] =
                (tipos[o.tipo_servico_nome] || 0) + 1;
        }
    });

    renderResumoTopo(tecnicos, localidades, tipos);
}


function montarLista(obj, limite = 7) {

    const lista = Object.entries(obj)
        .sort((a,b)=>b[1]-a[1])
        .map(([nome, total]) =>
            `<div class="item">${nome} <span>(${total})</span></div>`
        );

    if (!lista.length) {
        return `<div class="vazio">Nenhum dado</div>`;
    }

    const colunas = [];
    for (let i = 0; i < lista.length; i += limite) {
        colunas.push(lista.slice(i, i + limite));
    }

    return `
        <div class="colunas-internas">
            ${colunas.map(col => `
                <div class="coluna">
                    ${col.join("")}
                </div>
            `).join("")}
        </div>
    `;
}

function renderResumoTopo(tecnicos, localidades, tipos){

    const el = document.getElementById("resumo-topo");
    if(!el) return;

    const abertas = ordens.filter(o => o.status === "aberto").length;
    const andamento = ordens.filter(o => o.status === "em_andamento").length;
    const ausentes = ordens.filter(o => o.status === "cliente_ausente").length;
    const concluidas = ordens.filter(o => o.status === "concluido").length;
    const avulsas = osAvulsas.length + osAvulsasConcluidas.length;

    el.innerHTML = `
        <div style="flex:1;">
            <div class="resumo-grid">

                <div class="bloco">
                    <div class="titulo">👨‍🔧 Técnicos</div>
                    ${montarLista(tecnicos)}
                </div>

                <div class="bloco">
                    <div class="titulo">📍 Localidades</div>
                    ${montarLista(localidades)}
                </div>

                <div class="bloco">
                    <div class="titulo">🛠️ Serviços</div>
                    ${montarLista(tipos)}
                </div>

            </div>
        </div>

        <div class="contadores">
            <div class="titulo">📊 Estatísticas</div>

            <div class="contador-item"><div>Avulsas</div><span>${avulsas}</span></div>
            <div class="contador-item"><div>Abertas</div><span>${abertas}</span></div>
            <div class="contador-item"><div>Em andamento</div><span>${andamento}</span></div>
            <div class="contador-item"><div>Ausentes</div><span>${ausentes}</span></div>
            <div class="contador-item"><div>Concluídas</div><span>${concluidas}</span></div>
        </div>
    `;
}

// ===============================
// STATUS
// ===============================
const STATUS_MAP = {
    "aberto": ["status-aberto","Aberto"],
    "em_andamento": ["status-andamento","Em execução"],
    "cliente_ausente": ["status-ausente","Cliente Ausente"],
    "concluido": ["status-finalizado","Finalizado"],
    "agendado": ["status-agendado","Agendado"]
};

function normalizarStatus(status) {
    if (!status) return "aberto";

    const s = status.toLowerCase().trim();

    if (s.includes("andamento")) return "em_andamento";
    if (s.includes("ausente")) return "cliente_ausente";
    if (s.includes("concl")) return "concluido";
    if (s.includes("abert")) return "aberto";

    return s.replace(/\s+/g, "_");
}

// ===============================
// FORMATOS
// ===============================
function formatarData(data) {
    if (!data) return "-";
    const d = new Date(data);
    return isNaN(d) ? "-" : d.toLocaleString("pt-BR");
}

function formatarEndereco(os) {
    const rua = os.rua || os.endereco || "-";
    const numero = os.n ? `, ${os.n}` : "";
    const bairro = os.bairro || "";
    const referencia = os.referencia || "";

    return `${rua}${numero}<br><small>${bairro}${referencia ? " - " + referencia : ""}</small>`;
}

function osTemTecnicoSelecionado(os){
    const base = os?.tecnico || os?.tecnicos || os?.tecnicos_nomes;
    const lista = normalizarTecnicos(base);
    return lista.filter(Boolean).length > 0;
}

function formatarTecnicos(tecnicos) {
    if (!tecnicos) return "-";

    let lista = [];

    try {
        if (Array.isArray(tecnicos)) {
            lista = tecnicos;
        } else if (typeof tecnicos === "string") {

            // tenta JSON primeiro
            try {
                const parsed = JSON.parse(tecnicos);
                lista = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
                // fallback: separa por vírgula
                lista = tecnicos.split(",").map(t => t.trim());
            }

        } else {
            lista = [tecnicos];
        }
    } catch {
        lista = [tecnicos];
    }

    return lista
        .map(t => tecnicosMap[String(t)] || t)
        .filter(Boolean)
        .map(t => `<span class="badge-tecnico">${t}</span>`)
        .join("");
}


// ===============================
// OS AVULSAS
// ===============================
let osAvulsasCache = [];

function injetarEstiloOSAvulsas() {
    if (document.getElementById("style-os-avulsas")) return;

    const style = document.createElement("style");
    style.id = "style-os-avulsas";

    style.innerHTML = `
        #cardOSAvulsas,
        #cardOSAvulsasConcluidas{
            display:none;
            margin-bottom:22px;
        }

        #cardOSAvulsas table,
        #cardOSAvulsasConcluidas table{
            min-width:1200px;
        }

        #cardOSAvulsas td,
        #cardOSAvulsasConcluidas td{
            vertical-align:middle;
        }

        .descricao-avulsa{
            width:320px;
            max-width:320px;
            white-space:normal !important;
            vertical-align:middle;
            line-height:18px;
        }

        .descricao-avulsa .texto-descricao{
            display:block;
            width:320px;
            max-width:320px;
            white-space:normal !important;
            word-break:normal;
            overflow-wrap:break-word;
            line-height:18px;
            max-height:36px;
            overflow:hidden;
            margin:0;
            padding:0;
        }

        .btn-acao-avulsa{
            border:none;
            background:#f8fafc;
            border-radius:8px;
            padding:6px 8px;
            cursor:pointer;
            font-size:15px;
            color:#0f172a;
        }

        .btn-acao-avulsa:hover{
            background:#e2e8f0;
        }

        .status-avulsa-aberto{
            background:#dbeafe;
            color:#2563eb;
        }

        .status-avulsa-andamento{
            background:#ffedd5;
            color:#f59e0b;
        }

        .status-avulsa-concluido{
            background:#dcfce7;
            color:#15803d;
        }
    `;

    document.head.appendChild(style);
}

function criarCardTabelaOSAvulsa(idCard, idTbody, titulo) {
    const card = document.createElement("div");
    card.id = idCard;
    card.className = "card-tabela";
    card.style.display = "none";

    const cabecalho = `
        <th>Localidade</th>
        <th>Técnicos</th>
        <th>Tipo de Serviço</th>
        <th>Endereço</th>
        <th>Descrição</th>
        <th>Criada em</th>
        <th>Iniciada em</th>
        <th>Status</th>
        <th>Ações</th>
    `;

    card.innerHTML = `
        <div class="titulo-card">${titulo}</div>

        <div class="table-wrap">
            <table>
                <thead>
                    <tr>${cabecalho}</tr>
                </thead>
                <tbody id="${idTbody}"></tbody>
            </table>
        </div>
    `;

    return card;
}

function garantirTabelaOSAvulsas() {
    injetarEstiloOSAvulsas();

    let card = document.getElementById("cardOSAvulsas");
    let tbody = document.getElementById("tabelaOSAvulsas");

    let cardConcluidas = document.getElementById("cardOSAvulsasConcluidas");
    let tbodyConcluidas = document.getElementById("tabelaOSAvulsasConcluidas");

    const tabelaAbertas = document.getElementById("tabelaAbertas");
    const referencia = tabelaAbertas
        ? tabelaAbertas.closest(".card-tabela, .card, .box, .tabela-box, section, div")
        : null;

    if (!card || !tbody) {
        card = criarCardTabelaOSAvulsa(
            "cardOSAvulsas",
            "tabelaOSAvulsas",
            "Ordens de Serviço Avulsas"
        );

        if (referencia && referencia.parentNode) {
            referencia.parentNode.insertBefore(card, referencia);
        } else {
            document.body.appendChild(card);
        }

        tbody = document.getElementById("tabelaOSAvulsas");
    }

    if (!cardConcluidas || !tbodyConcluidas) {
        cardConcluidas = criarCardTabelaOSAvulsa(
            "cardOSAvulsasConcluidas",
            "tabelaOSAvulsasConcluidas",
            "Ordens de Serviço Avulsas Finalizadas"
        );

        if (card && card.parentNode) {
            card.parentNode.insertBefore(cardConcluidas, card.nextSibling);
        } else if (referencia && referencia.parentNode) {
            referencia.parentNode.insertBefore(cardConcluidas, referencia);
        } else {
            document.body.appendChild(cardConcluidas);
        }

        tbodyConcluidas = document.getElementById("tabelaOSAvulsasConcluidas");
    }

    return { card, tbody, cardConcluidas, tbodyConcluidas };
}

function normalizarStatusOSAvulsa(status) {
    if (!status) return "em_aberto";

    const s = String(status).toLowerCase().trim();

    if (s.includes("andamento") || s.includes("exec")) return "em_andamento";
    if (s.includes("concl") || s.includes("final")) return "concluido";
    if (s.includes("abert")) return "em_aberto";

    return s.replace(/\s+/g, "_");
}

function statusOSAvulsaHTML(status) {
    const mapa = {
        em_aberto: ["status-avulsa-aberto", "Em aberto"],
        em_andamento: ["status-avulsa-andamento", "Em execução"],
        concluido: ["status-avulsa-concluido", "Finalizado"]
    };

    const [classe, texto] = mapa[normalizarStatusOSAvulsa(status)] || mapa.em_aberto;

    return `<span class="status-box ${classe}">${texto}</span>`;
}

function formatarTecnicosOSAvulsa(os) {
    return os.tecnicos_nomes || os.tecnicos || "-";
}

function urlAnexoOSAvulsa(os) {
    const arquivo = os.anexo_path || os.anexo || os.arquivo || "";
    if (!arquivo) return "";

    return String(arquivo).startsWith("/")
        ? arquivo
        : `/api/os-avulsas/anexo/${arquivo}`;
}

function botaoAnexoOSAvulsa(os) {
    const url = urlAnexoOSAvulsa(os);
    if (!url) return "";

    return `
        <button class="btn-acao-avulsa"
                title="Visualizar anexo"
                onclick="visualizarAnexo('${url}')">📎</button>
    `;
}

function montarAcoesOSAvulsa(os, concluida = false) {
    const status = normalizarStatusOSAvulsa(os.status);
    let botoes = "";

    if (concluida) {
        botoes += botaoAnexoOSAvulsa(os);
        botoes += `
            <button class="btn-acao-avulsa"
                    title="Comprovante da OS Avulsa"
                    onclick="comprovacaoOSAvulsa(${os.id})">📄</button>
        `;
        return botoes || "-";
    }

    botoes += `
        <button class="btn-acao-avulsa"
                title="Editar"
                onclick="editarOSAvulsa(${os.id})">✏️</button>
    `;

    if (status === "em_aberto") {
        botoes += `
            <button class="btn-acao-avulsa"
                    title="Lançar OS Avulsa"
                    onclick="alterarStatusOSAvulsa(${os.id}, 'em_andamento')">🚀</button>
        `;
    }

    if (status !== "concluido") {
        botoes += `
            <button class="btn-acao-avulsa"
                    title="Concluir OS Avulsa"
                    onclick="alterarStatusOSAvulsa(${os.id}, 'concluido')">✅</button>
        `;
    }

    botoes += botaoAnexoOSAvulsa(os);

    botoes += `
        <button class="btn-acao-avulsa"
                title="Excluir"
                onclick="excluirOSAvulsa(${os.id})">🗑️</button>
    `;

    return botoes;
}

function textoDuasLinhas(valor) {
    const texto = valor || "-";
    return `<div class="texto-descricao" title="${String(texto).replace(/"/g, '&quot;')}">${texto}</div>`;
}

function montarLinhaOSAvulsa(os, concluida = false) {
    const status = normalizarStatusOSAvulsa(os.status);

    const iniciadoEm =
        os.iniciado_em ||
        os.iniciada_em ||
        (status === "em_andamento" ? os.atualizado_em : null);

    return `
        <tr>
    <td><strong>${os.localidade || os.localidade_nome || "-"}</strong></td>

    <td>${formatarTecnicosOSAvulsa(os)}</td>

    <td>${os.tipo_servico || os.tipo_servico_nome || "-"}</td>

    <td>${os.endereco || formatarEndereco(os)}</td>

    <td class="descricao-avulsa">
        ${textoDuasLinhas(os.descricao)}
    </td>

    <td>${formatarData(iniciadoEm)}</td>

    <td>${
        formatarData(
            os.finalizado_em ||
            os.concluido_em ||
            os.atualizado_em
        )
    }</td>

    <td>${statusOSAvulsaHTML(status)}</td>

    <td>
        <div class="acoes" onclick="event.stopPropagation()">
            ${montarAcoesOSAvulsa(os, concluida)}
        </div>
    </td>
</tr>
    `;
}

async function carregarOSAvulsas() {
    const {
        card,
        tbody,
        cardConcluidas,
        tbodyConcluidas
    } = garantirTabelaOSAvulsas();

    try {
        const lista = await apiFetch(`/api/os-avulsas/painel?periodo=${periodoAtual}`);

        osAvulsasCache = Array.isArray(lista) ? lista : [];

        osAvulsas = osAvulsasCache.filter(os => {
            const status = normalizarStatusOSAvulsa(os.status);
            return status === "em_aberto" || status === "em_andamento";
        });

        osAvulsasConcluidas = osAvulsasCache.filter(os => {
            const status = normalizarStatusOSAvulsa(os.status);
            return status === "concluido";
        });

        if (tbody) tbody.innerHTML = "";
        if (tbodyConcluidas) tbodyConcluidas.innerHTML = "";

        if (card) card.style.display = osAvulsas.length ? "block" : "none";
        if (cardConcluidas) cardConcluidas.style.display = osAvulsasConcluidas.length ? "block" : "none";

        osAvulsas.forEach(os => {
            tbody.innerHTML += montarLinhaOSAvulsa(os, false);
        });

        osAvulsasConcluidas.forEach(os => {
            tbodyConcluidas.innerHTML += montarLinhaOSAvulsa(os, true);
        });

        atualizarCards();

    } catch (err) {
        console.error("Erro ao carregar OS Avulsas:", err);

        if (card) card.style.display = "none";
        if (cardConcluidas) cardConcluidas.style.display = "none";
    }
}

// ===============================
// CARREGAR OS
// ===============================
async function carregarOS() {
    try {

        const data = await apiFetch(`/api/ordens_servico?periodo=${periodoAtual}`);

        ordens = data.map(o => ({
            ...o,
            // Garante que a descrição inicial permaneça disponível no resumo.
            descricao: o.descricao ?? o.descrição ?? o.observacoes ?? o.observacao ?? "",
            status: normalizarStatus(o.status),
            tecnicos_nomes: o.tecnicos_nomes || o.tecnico || [],
            localidade_nome: o.localidade_nome ?? "Sem localidade"
        }));

        try {
            gerarResumoTopo(ordens);
        } catch (e) {
            console.error("Erro no resumo:", e);
        }

        atualizarCards();
        popularTabelas();

        // Carrega avulsas separado, sem quebrar as OS normais
        try {
            await carregarOSAvulsas();
        } catch (e) {
            console.error("Erro isolado nas OS Avulsas:", e);
        }

    } catch (err) {
        console.error("Erro ao carregar OS:", err);
    }
}

// ===============================
// CARREGAR CLIENTE MIKWEB
// ===============================

async function buscarClienteMikWeb() {
    try {
        const id = document.getElementById("id_cliente").value.trim();

        if (!id) {
            alert("Digite o ID do cliente/contrato.");
            return;
        }

        const cliente = await fetchAuth(`/api/integracoes/mikweb/os-cliente/${id}`);

        document.getElementById("resultadoMikWeb").innerHTML = `
            <div style="margin-top:10px;padding:10px;border:1px solid #ddd;border-radius:8px;background:#f8fafc;">
                <strong>${cliente.nome}</strong><br>
                <small>Login: ${cliente.login || "-"}</small><br>
                <button type="button" onclick='preencherClienteMikWeb(${JSON.stringify(cliente)})'>
                    Usar este cliente
                </button>
            </div>
        `;

    } catch (err) {
        console.error(err);
        alert(err.erro || "Cliente não encontrado na MikWeb.");
    }
}

// ===============================
// CARDS
// ===============================
function atualizarCards() {
    const abertasEl = document.getElementById("abertas");
    const andamentoEl = document.getElementById("andamento");
    const finalizadasEl = document.getElementById("finalizadas");
    const ausentesEl = document.getElementById("clientesAusentes");

    const osAvulsasEl = document.getElementById("osAvulsas");

    if (osAvulsasEl) osAvulsasEl.innerText = osAvulsas.length + osAvulsasConcluidas.length;
    if (abertasEl) abertasEl.innerText = ordens.filter(o => o.status === "aberto").length;
    if (andamentoEl) andamentoEl.innerText = ordens.filter(o => o.status === "em_andamento").length;
    if (finalizadasEl) finalizadasEl.innerText = ordens.filter(o => o.status === "concluido").length;
    if (ausentesEl) ausentesEl.innerText = ordens.filter(o => o.status === "cliente_ausente").length;
}

// ===============================
// TABELAS
// ===============================
function popularTabelas() {

    const hoje = new Date();
    hoje.setHours(0,0,0,0);

    // ===============================
    // 🔥 FILTRO POR PERÍODO
    // ===============================
    function dentroPeriodo(data) {

    if (!data) return false;

    const d = new Date(data);
    if (isNaN(d)) return false;

    const hoje = new Date();
    hoje.setHours(23, 59, 59, 999);

    const inicio = new Date(hoje);

    if (periodoAtual === "hoje") {
        inicio.setHours(0, 0, 0, 0);
    }

    if (periodoAtual === "ontem") {
        inicio.setDate(inicio.getDate() - 1);
        inicio.setHours(0, 0, 0, 0);

        const fim = new Date(inicio);
        fim.setHours(23, 59, 59, 999);

        return d >= inicio && d <= fim;
    }

    if (periodoAtual === "7dias") {
        inicio.setDate(inicio.getDate() - 6);
        inicio.setHours(0, 0, 0, 0);
    }

    if (periodoAtual === "30dias") {
        inicio.setDate(inicio.getDate() - 29);
        inicio.setHours(0, 0, 0, 0);
    }

    if (periodoAtual === "hoje") {
        const fim = new Date(hoje);
        inicio.setHours(0, 0, 0, 0);
        return d >= inicio && d <= fim;
    }

    return d >= inicio && d <= hoje;
}

    // ===============================
    // 🔥 ABERTAS
    // ===============================
    const abertas = ordens.filter(o => {

        // 🔥 EM ABERTO / AUSENTE
        if (
            o.status === "aberto" ||
            o.status === "cliente_ausente"
        ) {

            // 🔥 SEM AGENDAMENTO:
            // FICA SEMPRE VISÍVEL
            if (!o.agendamento) {
                return true;
            }

            // 🔥 COM AGENDAMENTO:
            // RESPEITA FILTRO
            return dentroPeriodo(o.agendamento);
        }

        // 🔥 AGENDADAS
        if (o.status === "agendado") {

            if (!o.agendamento) {
                return true;
            }

            return dentroPeriodo(o.agendamento);
        }

        return false;
    });

    // ===============================
    // 🔥 EM ANDAMENTO
    // ===============================
    const andamento = ordens.filter(o =>
        o.status === "em_andamento"
    );

    // ===============================
    // 🔥 CONCLUÍDAS
    // ===============================
    const concluidas = ordens.filter(o => {

    if (o.status !== "concluido") return false;

    const dataBase = o.finalizado_em;

    if (!dataBase) return false;

    return dentroPeriodo(dataBase);
});

    // ===============================
    // 🔥 RENDER
    // ===============================
    popularTabela("tabelaAbertas", abertas);

    popularTabelaAndamento(
        "tabelaAndamento",
        andamento
    );

    popularTabelaCompleta(
        "tabelaConcluidas",
        concluidas
    );
}

// ===============================
// TABELA CONCLUÍDAS
// ===============================
function popularTabelaCompleta(id, dados) {

    const tbody = document.getElementById(id);

    if (!tbody) {
        console.warn("Tabela não encontrada:", id);
        return;
    }

    tbody.innerHTML = "";

    if (!dados.length) {

        tbody.innerHTML =
            `<tr><td colspan="16">Nenhum registro</td></tr>`;

        return;
    }

    dados.forEach(os => {

        const [classe, texto] =
            STATUS_MAP[os.status] || STATUS_MAP["aberto"];

        let botoes = `

            <!-- 🔁 RECLICAR -->
            <span class="icone-acao"
                  title="Reclicar atendimento"
                  onclick="reclicarAtendimento(${os.id})">
                  🔁
            </span>

            <!-- 📍 LOCALIZAÇÃO -->
            <span class="icone-acao"
                  title="Abrir localização"
                  onclick="abrirLocalizacao('${os.latitude}', '${os.longitude}')">
                  📍
            </span>

            <!-- 📎 ANEXO -->
            ${os.anexo_path ? `
            <span class="icone-acao"
                  title="Visualizar anexo"
                  onclick="visualizarAnexo('${os.anexo_path}')">
                  📎
            </span>
            ` : ""}

            <!-- 📄 COMPROVAÇÃO -->
            <span class="icone-acao"
                  title="Comprovação da OS"
                  onclick="comprovacaoOS(${os.id})">
                  📄
            </span>
        `;

        tbody.innerHTML += `
        <tr class="linha-os-resumo" onclick="abrirResumoOS(${os.id})">
            <td>
                <strong>${os.nome || "-"}</strong>
            </td>

            <td>
                ${os.localidade_nome || "-"}
            </td>

            <td>
                ${formatarEndereco(os)}
            </td>

            <td>
                ${formatarTecnicos(os.tecnicos_nomes)}
            </td>

            <td>
                ${os.tipo_servico_nome || "-"}
            </td>

            <td>
                ${os.plano_nome || "-"}
            </td>

            <td>
                ${os.id_cliente || "-"}
            </td>

            <td>
                ${os.login || "-"}
            </td>

            <td>
                ${os.vlan || os.localidade_vlan || "-"}
            </td>

            <td>
                ${os.telefone || "-"}
            </td>

            <td>
                ${formatarData(os.iniciado_em)}
            </td>


            <td>
                ${formatarData(
                    os.finalizado_em || os.iniciado_em
                )}
            </td>

            <td>
                ${os.finalizado_por_nome || "-"}
            </td>

            <td>
                <span class="status-box ${classe}">
                    ${texto}
                </span>
            </td>

            <td>
                <div class="acoes" onclick="event.stopPropagation()">
                    ${botoes}
                </div>
            </td>

        </tr>`;
    });
}

// ===============================
// TABELA EM ANDAMENTO
// ===============================
function popularTabelaAndamento(id, dados) {

    const tbody = document.getElementById(id);

    if (!tbody) {
        console.warn("Tabela não encontrada:", id);
        return;
    }

    tbody.innerHTML = "";

    if (!dados.length) {

        tbody.innerHTML =
            `<tr><td colspan="15">Nenhuma OS encontrada</td></tr>`;

        return;
    }

    dados.forEach(os => {

        const [classe, texto] =
            STATUS_MAP[os.status] || STATUS_MAP["aberto"];

        let botoes = `

            <span class="icone-acao"
                  title="Editar"
                  onclick="editarOS(${os.id})">
                  ✏️
            </span>

            <span class="icone-acao"
                  title="Abrir localização"
                  onclick="abrirLocalizacao('${os.latitude}', '${os.longitude}')">
                  📍
            </span>

            ${os.anexo_path ? `
            <span class="icone-acao"
                  title="Visualizar anexo"
                  onclick="visualizarAnexo('${os.anexo_path}')">
                  📎
            </span>
            ` : ""}

            <span class="icone-acao"
                  title="Imprimir OS"
                  onclick="imprimirOS(${os.id})">
                  🖨️
            </span>

            <span class="icone-acao"
                  title="Finalizar"
                  onclick="finalizarOS(${os.id})">
                  ✅
            </span>

            <span class="icone-acao"
                  title="Excluir"
                  onclick="excluirOS(${os.id})">
                  🗑️
            </span>
        `;

        tbody.innerHTML += `
        <tr class="linha-os-resumo" onclick="abrirResumoOS(${os.id})">
            <td>
                <strong>${os.nome}</strong>
            </td>

            <td>
                ${os.localidade_nome}
            </td>

            <td>
                ${formatarEndereco(os)}
            </td>

            <td>
                ${formatarTecnicos(os.tecnicos_nomes)}
            </td>

            <td>
                ${os.tipo_servico_nome || "-"}
            </td>

            <td>
                ${os.plano_nome || "-"}
            </td>

            <td>
                ${os.id_cliente || "-"}
            </td>

            <td>
                ${os.login || "-"}
            </td>

            <td>
                ${os.vlan || os.localidade_vlan || "-"}
            </td>

            <td>
                ${os.telefone || "-"}
            </td>

            <td>
                ${formatarData(os.iniciado_em)}
            </td>

            <td>
                ${os.enviado_por_nome || "-"}
            </td>

            <td>
                <span class="status-box ${classe}">
                    ${texto}
                </span>
            </td>

            <td>
                <div class="acoes" onclick="event.stopPropagation()">
                    ${botoes}
                </div>
            </td>

        </tr>`;
    });
}

// ===============================
// TABELA ABERTAS
// ===============================
function popularTabela(id, dados) {

    const tbody = document.getElementById(id);

    if (!tbody) {
        console.warn("Tabela não encontrada:", id);
        return;
    }

    tbody.innerHTML = "";

    if (!dados.length) {

        tbody.innerHTML =
            `<tr><td colspan="16">Nenhuma OS encontrada</td></tr>`;

        return;
    }

    dados.forEach(os => {

        const [classe, texto] =
            STATUS_MAP[os.status] || STATUS_MAP["aberto"];

        let botoes = `

            <span class="icone-acao"
                title="Editar"
                onclick="editarOS(${os.id})">
                ✏️
            </span>

            <span class="icone-acao"
                title="Abrir localização"
                onclick="abrirLocalizacao('${os.latitude}', '${os.longitude}')">
                📍
            </span>

            ${os.anexo_path ? `
            <span class="icone-acao"
                title="Visualizar anexo"
                onclick="visualizarAnexo('${os.anexo_path}')">
                📎
            </span>
            ` : ""}
        `;

        // 🔥 BOTÃO LANÇAR AGORA
        if (
            ["aberto", "cliente_ausente", "agendado"]
            .includes(os.status)
        ) {

            botoes += `

                <span class="icone-acao"
                    title="Lançar agora"
                    onclick="lancarAgora(${os.id})">
                    🚀
                </span>
            `;
        }

        botoes += `

            <span class="icone-acao"
                title="Imprimir OS"
                onclick="imprimirOS(${os.id})">
                🖨️
            </span>

            <span class="icone-acao"
                title="Excluir"
                onclick="excluirOS(${os.id})">
                🗑️
            </span>
        `;

        tbody.innerHTML += `
        <tr class="linha-os-resumo" onclick="abrirResumoOS(${os.id})">
            <td>
                <strong>${os.nome || "-"}</strong>
            </td>

            <td>
                ${os.localidade_nome || "-"}
            </td>

            <td>
                ${formatarEndereco(os)}
            </td>

            <td>
                ${formatarTecnicos(os.tecnicos_nomes)}
            </td>

            <td>
                ${os.tipo_servico_nome || "-"}
            </td>

            <td>
                ${os.plano_nome || "-"}
            </td>

            <td>
                ${os.id_cliente || "-"}
            </td>

            <td>
                ${os.login || "-"}
            </td>

            <td>
                ${os.vlan || os.localidade_vlan || "-"}
            </td>

            <td>
                ${os.telefone || "-"}
            </td>

            <td>
                ${formatarData(os.criado_em)}
            </td>

            <td>
                ${os.criado_por_nome || "-"}
            </td>

            <td>
                ${formatarData(os.agendamento)}
            </td>

            <td>
                <span class="status-box ${classe}">
                    ${texto}
                </span>
            </td>

            <td>
                <div class="acoes" onclick="event.stopPropagation()">
                    ${botoes}
                </div>
            </td>

        </tr>`;
    });
}



// ===============================
// POP-UP RESUMO DA OS
// ===============================
function escapeResumo(valor){
    return String(valor ?? "-")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function valorResumo(valor){
    if(valor === null || valor === undefined || valor === "") return "-";
    return escapeResumo(valor);
}

function linhaResumo(label1, valor1, label2, valor2){
    return `
        <div class="resumo-linha">
            <div class="resumo-item">
                <small>${escapeResumo(label1)}</small>
                <strong>${valorResumo(valor1)}</strong>
            </div>
            <div class="resumo-item">
                <small>${escapeResumo(label2)}</small>
                <strong>${valorResumo(valor2)}</strong>
            </div>
        </div>
    `;
}

function textoResumo(valor){
    return String(valor ?? "").trim() || "-";
}

function anexoAtualResumo(os){
    const status = normalizarStatus(os?.status);

    if(status === "cliente_ausente"){
        return os?.anexo_ausente || os?.anexo_ausente_path || "";
    }

    if(status === "concluido"){
        return os?.anexo_finalizado || os?.anexo_finalizado_path || "";
    }

    return os?.anexo_path || os?.anexo || "";
}

function detalheAtualResumo(os){
    const status = normalizarStatus(os?.status);

    if(status === "cliente_ausente"){
        return {
            titulo: "Observação de ausência",
            texto: os?.observacao_ausente || ""
        };
    }

    if(status === "concluido"){
        return {
            titulo: "Observação de conclusão",
            texto: os?.observacao_finalizado || ""
        };
    }

    return {
        titulo: "Descrição",
        texto: os?.descricao ?? os?.descricao_inicial ?? ""
    };
}

function anexosResumo(os){
    const anexo = anexoAtualResumo(os);
    if(!anexo) return `<div class="resumo-vazio">Nenhum anexo cadastrado.</div>`;

    const arquivo = String(anexo);
    const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(arquivo);
    const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(arquivo);

    if(isImg){
        return `
            <div class="resumo-midia">
                <img src="${escapeResumo(arquivo)}" alt="Anexo da OS">
            </div>
            <button class="btn-resumo cinza" onclick="event.stopPropagation(); visualizarAnexo('${escapeResumo(arquivo)}')">📎 Abrir anexo</button>
        `;
    }

    if(isVideo){
        return `
            <div class="resumo-midia">
                <video controls>
                    <source src="${escapeResumo(arquivo)}">
                </video>
            </div>
            <button class="btn-resumo cinza" onclick="event.stopPropagation(); visualizarAnexo('${escapeResumo(arquivo)}')">📎 Abrir anexo</button>
        `;
    }

    return `<button class="btn-resumo cinza" onclick="event.stopPropagation(); visualizarAnexo('${escapeResumo(arquivo)}')">📎 Abrir anexo</button>`;
}

function localizacaoResumo(os){
    const lat = os.latitude;
    const lng = os.longitude;

    if(!lat || !lng){
        return `<div class="resumo-vazio">Localização não cadastrada.</div>`;
    }

    const mapa = `https://maps.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&z=16&output=embed`;

    return `
        <div class="resumo-mapa">
            <iframe src="${mapa}" loading="lazy"></iframe>
        </div>
        <button class="btn-resumo azul" onclick="event.stopPropagation(); abrirLocalizacao('${escapeResumo(lat)}','${escapeResumo(lng)}')">📍 Abrir no mapa</button>
    `;
}

function servicoTVResumo(os){
    if(!os.aplicativo && !os.url && !os.usuario && !os.senha){
        return "";
    }

    return `
        <div class="resumo-card destaque-tv">
            <h3>📺 Serviço de TV / SVA</h3>
            ${linhaResumo("Aplicativo", os.aplicativo, "URL", os.url)}
            ${linhaResumo("Usuário", os.usuario, "Senha", os.senha)}
        </div>
    `;
}

function garantirModalResumoOS(){
    if(document.getElementById("modalResumoOS")) return;

    const style = document.createElement("style");
    style.id = "styleResumoOS";
    style.innerHTML = `
        .linha-os-resumo{ cursor:pointer; }
        .linha-os-resumo:hover{ background:#eff6ff !important; }

        #modalResumoOS{
            position:fixed;
            inset:0;
            background:rgba(15,23,42,0.72);
            z-index:999999;
            display:none;
            align-items:center;
            justify-content:center;
            padding:22px;
        }

        .resumo-os-box{
            width:min(980px, 96vw);
            max-height:92vh;
            background:white;
            border-radius:18px;
            box-shadow:0 28px 80px rgba(0,0,0,.35);
            overflow:hidden;
            display:flex;
            flex-direction:column;
        }

        .resumo-os-head{
            display:flex;
            align-items:flex-start;
            justify-content:space-between;
            gap:16px;
            padding:20px 24px;
            border-bottom:1px solid #e5e7eb;
            background:#f8fafc;
        }

        .resumo-os-head h2{
            margin:0;
            font-size:21px;
            color:#0f172a;
            font-weight:800;
        }

        .resumo-os-head p{
            margin:5px 0 0;
            color:#64748b;
            font-size:13px;
        }

        .resumo-fechar{
            border:none;
            background:#ef4444;
            color:white;
            border-radius:999px;
            width:34px;
            height:34px;
            cursor:pointer;
            font-weight:800;
            font-size:16px;
        }

        .resumo-os-body{
            padding:20px 24px;
            overflow:auto;
        }

        .resumo-grid-cards{
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:14px;
        }

        .resumo-card{
            border:1px solid #e5e7eb;
            border-radius:14px;
            padding:16px;
            background:#fff;
        }

        .resumo-card.full{
            grid-column:1 / -1;
        }

        .resumo-card h3{
            margin:0 0 13px;
            font-size:15px;
            color:#0f172a;
            font-weight:800;
        }

        .destaque-tv{
            grid-column:1 / -1;
            background:#eff6ff;
            border-color:#bfdbfe;
        }

        .resumo-linha{
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:12px;
            margin-bottom:10px;
        }

        .resumo-linha:last-child{ margin-bottom:0; }

        .resumo-item{
            background:#f8fafc;
            border:1px solid #f1f5f9;
            border-radius:10px;
            padding:10px 12px;
            min-height:58px;
        }

        .resumo-item small{
            display:block;
            color:#64748b;
            font-size:11px;
            font-weight:800;
            text-transform:uppercase;
            margin-bottom:5px;
        }

        .resumo-item strong{
            display:block;
            color:#0f172a;
            font-size:13px;
            line-height:1.35;
            word-break:break-word;
        }

        .resumo-texto{
            background:#f8fafc;
            border:1px solid #f1f5f9;
            border-radius:10px;
            padding:12px;
            color:#0f172a;
            font-size:13px;
            line-height:1.45;
            white-space:pre-wrap;
            min-height:54px;
        }

        .resumo-midia img,
        .resumo-midia video{
            max-width:100%;
            max-height:260px;
            border-radius:12px;
            display:block;
            margin-bottom:12px;
            border:1px solid #e5e7eb;
        }

        .resumo-mapa iframe{
            width:100%;
            height:240px;
            border:0;
            border-radius:12px;
            margin-bottom:12px;
            background:#f1f5f9;
        }

        .resumo-vazio{
            color:#64748b;
            font-size:13px;
            background:#f8fafc;
            border-radius:10px;
            padding:12px;
        }

        .resumo-os-actions{
            display:flex;
            justify-content:flex-end;
            gap:10px;
            padding:16px 24px;
            border-top:1px solid #e5e7eb;
            background:#f8fafc;
            flex-wrap:wrap;
        }

        .btn-resumo{
            border:none;
            color:white;
            padding:11px 15px;
            border-radius:10px;
            cursor:pointer;
            font-weight:800;
            font-family:Arial, Helvetica, sans-serif;
        }

        .btn-resumo.azul{ background:#2563eb; }
        .btn-resumo.verde{ background:#16a34a; }
        .btn-resumo.vermelho{ background:#ef4444; }
        .btn-resumo.cinza{ background:#64748b; }

        @media(max-width:800px){
            .resumo-grid-cards,
            .resumo-linha{
                grid-template-columns:1fr;
            }

            .resumo-card.full,
            .destaque-tv{
                grid-column:auto;
            }

            .resumo-os-actions{
                justify-content:flex-start;
            }
        }
    `;
    document.head.appendChild(style);

    const modal = document.createElement("div");
    modal.id = "modalResumoOS";
    modal.onclick = fecharResumoOS;
    modal.innerHTML = `
        <div class="resumo-os-box" onclick="event.stopPropagation()">
            <div class="resumo-os-head">
                <div>
                    <h2 id="resumoOSTitulo">Resumo da OS</h2>
                    <p id="resumoOSSubtitulo">Dados completos do atendimento</p>
                </div>
                <button class="resumo-fechar" type="button" onclick="fecharResumoOS()">×</button>
            </div>
            <div class="resumo-os-body" id="resumoOSConteudo"></div>
            <div class="resumo-os-actions" id="resumoOSAcoes"></div>
        </div>
    `;
    document.body.appendChild(modal);
}

window.fecharResumoOS = function(){
    const modal = document.getElementById("modalResumoOS");
    if(modal) modal.style.display = "none";
};


function materiaisResumoOS(os){
    const origem = os?.origem_equipamento === 'empresa' ? 'Equipamento da empresa' : 'Equipamento próprio do cliente';
    const modalidade = os?.origem_equipamento === 'empresa' ? (os?.modalidade_equipamento === 'vendido' ? 'Vendido' : 'Comodato') : '-';
    let materiais=os?.materiais_os || []; if(typeof materiais==='string'){try{materiais=JSON.parse(materiais)}catch{materiais=[]}}
    const lista=Array.isArray(materiais)&&materiais.length ? `<div style="margin-top:10px;display:grid;gap:7px">${materiais.map(m=>`<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 10px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px"><strong>${escapeResumo(m.nome||'Produto')}</strong><span>${Number(m.quantidade)||1} un.</span></div>`).join('')}</div>` : '<div class="resumo-texto">Nenhum material informado.</div>';
    return `<div class="resumo-card full"><h3>📦 Equipamentos e materiais</h3>${linhaResumo('Origem',origem,'Modalidade',modalidade)}${os?.origem_equipamento==='empresa'?lista:''}</div>`;
}

window.abrirResumoOS = async function(id){
    garantirModalResumoOS();

    let os = (ordens || []).find(o => Number(o.id) === Number(id));

    if(!os){
        alert("OS não encontrada no painel.");
        return;
    }

    // Busca os dados completos da OS no momento em que o resumo é aberto.
    // Isso evita que a listagem resumida ou um cache antigo esconda `descricao`.
    try {
        let detalhe = await apiFetch(`/api/ordens_servico/${id}`);

        // Compatibilidade com APIs que encapsulam o registro.
        detalhe = detalhe?.os || detalhe?.ordem || detalhe?.data || detalhe;

        if (detalhe && typeof detalhe === "object") {
            const descricaoCompleta = String(
                detalhe.descricao ?? detalhe.descricao_inicial ?? detalhe["descrição"] ?? os.descricao ?? ""
            ).trim();

            os = {
                ...os,
                ...detalhe,
                descricao: descricaoCompleta,
                status: normalizarStatus(detalhe.status ?? os.status)
            };

            const indice = (ordens || []).findIndex(o => Number(o.id) === Number(id));
            if (indice >= 0) ordens[indice] = os;
        }
    } catch (erro) {
        console.warn("Não foi possível atualizar os dados completos da OS:", erro);
    }

    const [classeStatus, textoStatus] = STATUS_MAP[os.status] || STATUS_MAP["aberto"];

    document.getElementById("resumoOSTitulo").innerText =
        `Resumo da OS #${os.id}`;

    document.getElementById("resumoOSSubtitulo").innerText =
        `${os.nome || "Cliente não informado"} • ${textoStatus}`;

    const conteudo = document.getElementById("resumoOSConteudo");
    const detalheStatus = detalheAtualResumo(os);

    conteudo.innerHTML = `
        <div class="resumo-grid-cards">

            <div class="resumo-card">
                <h3>👤 Cliente</h3>
                ${linhaResumo("Nome", os.nome, "ID Cliente", os.id_cliente)}
                ${linhaResumo("Telefone", os.telefone, "Login", os.login)}
                ${linhaResumo("Plano", os.plano_nome, "VLAN", os.vlan || os.localidade_vlan)}
            </div>

            <div class="resumo-card">
                <h3>🛠️ Atendimento</h3>
                ${linhaResumo("Tipo de Serviço", os.tipo_servico_nome, "Status", textoStatus)}
                ${linhaResumo("Técnicos", (os.tecnicos_nomes || "").replace(/,/g, ", "), "Criado por", os.criado_por_nome)}
                ${linhaResumo("Criado em", formatarData(os.criado_em || os.data_abertura), "Agendamento", formatarData(os.agendamento))}
            </div>

            <div class="resumo-card">
                <h3>📍 Endereço</h3>
                ${linhaResumo("Localidade", os.localidade_nome, "Bairro", os.bairro)}
                ${linhaResumo("Rua", os.rua || os.endereco, "Número", os.n)}
                ${linhaResumo("Referência", os.referencia, "Coordenadas", os.latitude && os.longitude ? `${os.latitude}, ${os.longitude}` : "-")}
            </div>

            <div class="resumo-card">
                <h3>📅 Datas</h3>
                ${linhaResumo("Envio", formatarData(os.agendamento_envio), "Iniciado em", formatarData(os.iniciado_em))}
                ${linhaResumo("Finalizado em", formatarData(os.finalizado_em), "Finalizado por", os.status === "concluido" ? (os.finalizado_por_nome || "-") : "-")}
            </div>

            ${servicoTVResumo(os)}

            ${materiaisResumoOS(os)}

            <div class="resumo-card full">
                <h3>📝 ${escapeResumo(detalheStatus.titulo)}</h3>
                <div class="resumo-texto">${escapeResumo(textoResumo(detalheStatus.texto))}</div>
            </div>

            <div class="resumo-card">
                <h3>📎 Imagem / Anexo</h3>
                ${anexosResumo(os)}
            </div>

            <div class="resumo-card">
                <h3>🗺️ Localização</h3>
                ${localizacaoResumo(os)}
            </div>

        </div>
    `;

    const acoes = document.getElementById("resumoOSAcoes");

    const podeLancar = ["aberto", "cliente_ausente", "agendado"].includes(os.status);

    acoes.innerHTML = `
        <button class="btn-resumo azul" onclick="editarOS(${os.id})">✏️ Editar</button>
        ${podeLancar ? `<button class="btn-resumo verde" onclick="lancarAgora(${os.id})">🚀 Lançar Agora</button>` : ""}
        <button class="btn-resumo vermelho" onclick="excluirOS(${os.id})">🗑️ Excluir</button>
    `;

    document.getElementById("modalResumoOS").style.display = "flex";
};


// ===============================
// AÇÕES OS AVULSAS
// ===============================
window.editarOSAvulsa = (id) => {
    window.location.href = `/nova-os-avulsa.html?id=${id}`;
};

window.alterarStatusOSAvulsa = async (id, status) => {

    const texto = {
        em_aberto: "voltar esta OS Avulsa para Em aberto",
        em_andamento: "iniciar esta OS Avulsa",
        concluido: "concluir esta OS Avulsa"
    }[status] || "alterar o status desta OS Avulsa";

    if (!confirm(`Deseja ${texto}?`)) return;

    await apiFetch(`/api/os-avulsas/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status })
    });

    carregarOS();
};

window.excluirOSAvulsa = async (id) => {

    if (!confirm("Deseja excluir esta OS Avulsa?")) return;

    await apiFetch(`/api/os-avulsas/${id}`, {
        method: "DELETE"
    });

    carregarOS();
};

// ===============================
// AÇÕES
// ===============================
window.editarOS = (id) => {

    window.location.href =
        `editar-os.html?id=${id}`;
};

window.lancarAgora = async (id) => {

    const os = (ordens || []).find(o => Number(o.id) === Number(id));

    if(os && !osTemTecnicoSelecionado(os)){
        alert("Selecione pelo menos um técnico para poder lançar OS.");
        return;
    }

    if (!confirm("Deseja iniciar essa OS agora?")) return;

    try{
        await apiFetch(`/api/ordens_servico/iniciar/${id}`, {
            method: "POST"
        });

        fecharResumoOS();
        carregarOS();
    }catch(err){
        alert(err.message || "Erro ao lançar OS. Verifique se existe técnico selecionado.");
    }
};

window.finalizarOS = async (id) => {

    if (!confirm("Finalizar essa OS?")) return;

    await apiFetch(`/api/ordens_servico/concluir/${id}`, {
        method: "POST"
    });

    carregarOS();
};

window.excluirOS = async (id) => {

    if (!confirm("Excluir OS?")) return;

    await apiFetch(`/api/ordens_servico/${id}`, {
        method: "DELETE"
    });

    carregarOS();
};

// ===============================
// 🔁 RECLICAR ATENDIMENTO
// ===============================
window.reclicarAtendimento = (id) => {

    window.location.href =
        `editar-os.html?id=${id}&reclicar=1`;
};

// ===============================
// 📄 COMPROVAÇÃO OS
// ===============================
window.comprovacaoOS = (id) => {

    const usuario = JSON.parse(
        localStorage.getItem("usuario")
    );

    if (!usuario) {

        alert("Usuário não encontrado");
        return;
    }

    const token = btoa(
        usuario.id + "_SGOS"
    );

    window.open(
        `/api/ordens_servico/comprovacao/${id}?token=${token}`,
        "_blank"
    );
};

// ===============================
// 📄 COMPROVANTE OS AVULSA
// ===============================
window.comprovacaoOSAvulsa = (id) => {

    const usuario = JSON.parse(
        localStorage.getItem("usuario")
    );

    if (!usuario) {
        alert("Usuário não encontrado");
        return;
    }

    const token = btoa(
        usuario.id + "_SGOS"
    );

    window.open(
        `/api/os-avulsas/comprovacao/${id}?token=${token}`,
        "_blank"
    );
};

// ===============================
// GOOGLE MAPS
// ===============================
window.abrirLocalizacao = (latitude, longitude) => {

    if (!latitude || !longitude) {

        alert("Localização não cadastrada nesta OS.");
        return;
    }

    const url =
        `https://www.google.com/maps?q=${latitude},${longitude}`;

    window.open(url, "_blank");
};

// ===============================
// FILTRO DE PERÍODO
// ===============================
document.addEventListener("DOMContentLoaded", () => {

    const filtro = document.getElementById("filtroPeriodo");

    if (filtro) {

        filtro.addEventListener("change", () => {

            periodoAtual = filtro.value;

            carregarOS();
        });
    }
});

// ===============================
// 🖨️ IMPRIMIR OS
// ===============================
window.imprimirOS = (id) => {

    const usuario = JSON.parse(
        localStorage.getItem("usuario")
    );

    if (!usuario) {

        alert("Usuário não encontrado");

        return;
    }

    const token = btoa(
        usuario.id + "_SGOS"
    );

    window.open(
        `/api/ordens_servico/imprimir/${id}?token=${token}`,
        "_blank"
    );
};

// ===============================
// 👁️ VISUALIZAR ANEXO POPUP
// ===============================
window.visualizarAnexo = (arquivo) => {

    if (!arquivo) {

        alert("Esta OS não possui anexo.");
        return;
    }

    // remove popup anterior
    const antigo =
        document.getElementById("popup-anexo");

    if (antigo) {
        antigo.remove();
    }

    // overlay
    const overlay =
        document.createElement("div");

    overlay.id = "popup-anexo";

    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";

    overlay.style.width = "100%";
    overlay.style.height = "100%";

    overlay.style.background =
        "rgba(0,0,0,0.75)";

    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    overlay.style.zIndex = "999999";

    // container
    const box =
        document.createElement("div");

    box.style.position = "relative";

    box.style.maxWidth = "90%";
    box.style.maxHeight = "90%";

    box.style.background = "#fff";

    box.style.borderRadius = "12px";

    box.style.padding = "10px";

    box.style.boxShadow =
        "0 0 20px rgba(0,0,0,0.4)";

    // botão fechar
    const fechar =
        document.createElement("span");

    fechar.innerHTML = "✖";

    fechar.style.position = "absolute";
    fechar.style.top = "-10px";
    fechar.style.right = "-10px";

    fechar.style.cursor = "pointer";

    fechar.style.fontSize = "22px";

    fechar.style.fontWeight = "bold";

    fechar.style.color = "#fff";

    fechar.style.background = "#e74c3c";

    fechar.style.width = "32px";
    fechar.style.height = "32px";

    fechar.style.display = "flex";

    fechar.style.alignItems = "center";
    fechar.style.justifyContent = "center";

    fechar.style.borderRadius = "50%";

    fechar.onclick = () => {
        overlay.remove();
    };

    // detectar extensão
    const ext =
        arquivo.split(".").pop().toLowerCase();

    let elemento;

    // imagem
    if (
        ["jpg","jpeg","png","gif","webp"]
        .includes(ext)
    ) {

        elemento =
            document.createElement("img");

        elemento.src = arquivo;

        elemento.style.maxWidth = "100%";
        elemento.style.maxHeight = "80vh";

        elemento.style.borderRadius = "8px";
    }

    // pdf
    else if (ext === "pdf") {

        elemento =
            document.createElement("iframe");

        elemento.src = arquivo;

        elemento.style.width = "80vw";
        elemento.style.height = "80vh";

        elemento.style.border = "none";
    }

    // fallback
    else {

        elemento =
            document.createElement("a");

        elemento.href = arquivo;

        elemento.target = "_blank";

        elemento.innerText =
            "📥 Abrir arquivo";

        elemento.style.fontSize = "18px";
    }

    box.appendChild(fechar);

    box.appendChild(elemento);

    overlay.appendChild(box);

    document.body.appendChild(overlay);

    // fecha clicando fora
    overlay.addEventListener("click", e => {

        if (e.target === overlay) {
            overlay.remove();
        }
    });
};

// ===============================
// INIT
// ===============================
window.addEventListener("DOMContentLoaded", async () => {

    await carregarTecnicosMap();

    carregarOS();

    setInterval(carregarOS, 60000);
});


/* =====================================================
   PATCH FINAL OS AVULSAS - RESUMOS + RECICLAR
   ===================================================== */
function normalizarStatusAvulsaPatch(status) {
    const s = String(status || "em_aberto").toLowerCase().trim();

    if (s.includes("andamento") || s.includes("exec")) return "em_andamento";
    if (s.includes("concl") || s.includes("final")) return "concluido";
    if (s.includes("abert")) return "em_aberto";

    return s.replace(/\s+/g, "_");
}

function listaTecnicosAvulsaPatch(os) {
    const valor = os.tecnicos_nomes || os.tecnicos || "";

    if (Array.isArray(valor)) {
        return valor.map(v => String(v).trim()).filter(Boolean);
    }

    if (typeof valor === "string") {
        try {
            const parsed = JSON.parse(valor);

            if (Array.isArray(parsed)) {
                return parsed.map(v => String(v).trim()).filter(Boolean);
            }
        } catch {}

        return valor
            .split(",")
            .map(v => String(v).trim())
            .filter(Boolean);
    }

    return valor ? [String(valor).trim()] : [];
}

function badgeTecnicosAvulsaPatch(os) {
    const lista = listaTecnicosAvulsaPatch(os);

    if (!lista.length) return "-";

    return lista
        .map(nome => `<span class="badge-tecnico">${nome}</span>`)
        .join("");
}

function abrirReciclarOSAvulsa(id) {
    window.location.href = `/nova-os-avulsa.html?id=${id}&reciclar=1`;
}

window.reciclarOSAvulsa = abrirReciclarOSAvulsa;

function adicionarEstiloPatchOSAvulsas() {
    if (document.getElementById("patch-final-os-avulsas-style")) return;

    const style = document.createElement("style");
    style.id = "patch-final-os-avulsas-style";

    style.innerHTML = `
        .linha-avulsa-resumo .avatar-tecnico{
            background:#dbeafe;
            color:#2563eb;
            font-weight:800;
        }

        .linha-avulsa-resumo .badge-campo{
            background:#dcfce7;
            color:#15803d;
        }

        #cardOSAvulsas td,
        #cardOSAvulsasConcluidas td{
            vertical-align:middle;
        }

        .descricao-avulsa{
            width:320px;
            max-width:320px;
            white-space:normal !important;
            vertical-align:middle;
            line-height:18px;
        }

        .descricao-avulsa .texto-descricao{
            display:block;
            width:320px;
            max-width:320px;
            white-space:normal !important;
            word-break:normal;
            overflow-wrap:break-word;
            line-height:18px;
            max-height:36px;
            overflow:hidden;
            margin:0;
            padding:0;
        }

        .badge-tecnico{
            display:inline-block;
            background:#eef2ff;
            color:#1e40af;
            padding:5px 9px;
            border-radius:999px;
            font-size:12px;
            margin:2px;
            font-weight:800;
        }
    `;

    document.head.appendChild(style);
}

function obterOSAvulsasCachePatch() {
    if (typeof osAvulsasCache !== "undefined" && Array.isArray(osAvulsasCache)) {
        return osAvulsasCache;
    }

    if (typeof window.osAvulsasCache !== "undefined" && Array.isArray(window.osAvulsasCache)) {
        return window.osAvulsasCache;
    }

    return [];
}

function atualizarCardsComAvulsasPatch() {
    const lista = obterOSAvulsasCachePatch();

    const abertasAvulsas = lista.filter(os =>
        normalizarStatusAvulsaPatch(os.status) === "em_aberto"
    ).length;

    const execucaoAvulsas = lista.filter(os =>
        normalizarStatusAvulsaPatch(os.status) === "em_andamento"
    ).length;

    const finalizadasAvulsas = lista.filter(os =>
        normalizarStatusAvulsaPatch(os.status) === "concluido"
    ).length;

    const abertasEl = document.getElementById("abertas");
    const andamentoEl =
        document.getElementById("andamento") ||
        document.getElementById("execução") ||
        document.getElementById("execucao");

    const finalizadasEl = document.getElementById("finalizadas");
    const osAvulsasEl = document.getElementById("osAvulsas");

    if (abertasEl) {
        const normaisAbertas =
            Array.isArray(ordens)
                ? ordens.filter(o => o.status === "aberto").length
                : Number(abertasEl.innerText || 0);

        abertasEl.innerText = normaisAbertas + abertasAvulsas;
    }

    if (andamentoEl) {
        const normaisExec =
            Array.isArray(ordens)
                ? ordens.filter(o => o.status === "em_andamento").length
                : Number(andamentoEl.innerText || 0);

        andamentoEl.innerText = normaisExec + execucaoAvulsas;
    }

    if (finalizadasEl) {
        const normaisFinalizadas =
            Array.isArray(ordens)
                ? ordens.filter(o => o.status === "concluido").length
                : Number(finalizadasEl.innerText || 0);

        finalizadasEl.innerText = normaisFinalizadas + finalizadasAvulsas;
    }

    if (osAvulsasEl) {
        osAvulsasEl.innerText = abertasAvulsas + execucaoAvulsas + finalizadasAvulsas;
    }
}

function atualizarResumoInferiorComAvulsasPatch() {
    adicionarEstiloPatchOSAvulsas();

    const lista = obterOSAvulsasCachePatch();

    const emExecucaoAvulsas = lista.filter(os =>
        normalizarStatusAvulsaPatch(os.status) === "em_andamento"
    );

    document.querySelectorAll(".linha-avulsa-resumo").forEach(e => e.remove());

    const cards = document.querySelectorAll(".cards-resumo-bottom .card-bottom");

    const blocoTecnicos = cards[0];
    const blocoLocalidades = cards[1];
    const blocoTipos = cards[2];

    if (!emExecucaoAvulsas.length) return;

    // Remove mensagens "disponíveis/nenhuma execução" quando existir avulsa em execução
    if (blocoTecnicos) {
        blocoTecnicos.querySelectorAll(".linha-tecnico").forEach(linha => {
            const texto = linha.innerText.toLowerCase();
            if (
                texto.includes("técnicos disponíveis") ||
                texto.includes("tecnicos disponíveis") ||
                texto.includes("nenhuma os em execução")
            ) {
                linha.remove();
            }
        });
    }

    if (blocoLocalidades) {
        blocoLocalidades.querySelectorAll(".linha-info, div").forEach(linha => {
            const texto = linha.innerText?.toLowerCase?.() || "";
            if (texto.includes("nenhuma localidade em execução")) {
                linha.remove();
            }
        });
    }

    if (blocoTipos) {
        blocoTipos.querySelectorAll(".linha-info, div").forEach(linha => {
            const texto = linha.innerText?.toLowerCase?.() || "";
            if (texto.includes("nenhum serviço em execução")) {
                linha.remove();
            }
        });
    }

    const tecnicos = {};
    const localidades = {};
    const tipos = {};

    emExecucaoAvulsas.forEach(os => {
        listaTecnicosAvulsaPatch(os).forEach(t => {
            if (!t) return;
            tecnicos[t] = (tecnicos[t] || 0) + 1;
        });

        const localidade = os.localidade || os.localidade_nome;
        if (localidade) {
            localidades[localidade] = (localidades[localidade] || 0) + 1;
        }

        const tipo = os.tipo_servico || os.tipo_servico_nome;
        if (tipo) {
            tipos[tipo] = (tipos[tipo] || 0) + 1;
        }
    });

    function inserirAntesDoLink(bloco, html) {
        if (!bloco) return;

        const link = bloco.querySelector(".link-bottom");

        if (link) {
            link.insertAdjacentHTML("beforebegin", html);
        } else {
            bloco.insertAdjacentHTML("beforeend", html);
        }
    }

    Object.entries(tecnicos).forEach(([nome, total]) => {
        inserirAntesDoLink(blocoTecnicos, `
            <div class="linha-tecnico linha-avulsa-resumo">
                <div class="avatar-tecnico">A</div>
                <div class="info-tecnico">
                    <strong>${nome}</strong>
                    <small>${total} OS Avulsa em execução</small>
                </div>
                <span class="badge-campo">Avulsa</span>
            </div>
        `);
    });

    Object.entries(localidades).forEach(([nome, total]) => {
        inserirAntesDoLink(blocoLocalidades, `
            <div class="linha-info linha-avulsa-resumo">
                <span>${nome}</span>
                <strong>${total}</strong>
            </div>
        `);
    });

    Object.entries(tipos).forEach(([nome, total]) => {
        inserirAntesDoLink(blocoTipos, `
            <div class="linha-info linha-avulsa-resumo">
                <span>${nome}</span>
                <strong>${total}</strong>
            </div>
        `);
    });
}

function ajustarTabelaOSAvulsasFinalizadasPatch() {
    const tbody = document.getElementById("tabelaOSAvulsasConcluidas");

    if (!tbody) return;

    tbody.querySelectorAll("tr").forEach(tr => {
        const texto = tr.innerText || "";

        if (!texto.trim() || texto.includes("Nenhum")) return;

        const ultimaCelula = tr.querySelector("td:last-child");

        if (!ultimaCelula) return;

        if (!ultimaCelula.innerHTML.includes("reciclarOSAvulsa")) {
            const idMatch = ultimaCelula.innerHTML.match(/comprovanteOSAvulsa\((\d+)\)|comprovacaoOSAvulsa\((\d+)\)|OSAvulsa\((\d+)\)/);
            let id = null;

            if (idMatch) {
                id = idMatch[1] || idMatch[2] || idMatch[3];
            }

            if (!id) {
                const onclicks = tr.innerHTML.match(/\((\d+)\)/g);
                if (onclicks && onclicks.length) {
                    id = onclicks[onclicks.length - 1].replace(/[()]/g, "");
                }
            }

            if (id) {
                const divAcoes = ultimaCelula.querySelector(".acoes") || ultimaCelula;
                divAcoes.insertAdjacentHTML("beforeend", `
                    <button class="btn-acao-avulsa"
                            title="Reciclar OS Avulsa"
                            onclick="reciclarOSAvulsa(${id})">🔁</button>
                `);
            }
        }
    });
}

function aplicarPatchFinalOSAvulsas() {
    atualizarCardsComAvulsasPatch();
    atualizarResumoInferiorComAvulsasPatch();
    ajustarTabelaOSAvulsasFinalizadasPatch();

    // Aplica badge azul se alguma linha avulsa tiver técnicos em texto puro
    document.querySelectorAll("#tabelaOSAvulsas tr, #tabelaOSAvulsasConcluidas tr").forEach(tr => {
        const tds = tr.querySelectorAll("td");
        if (tds.length < 2) return;

        const celTec = tds[1];

        if (
            celTec &&
            !celTec.querySelector(".badge-tecnico") &&
            celTec.innerText.trim() &&
            celTec.innerText.trim() !== "-"
        ) {
            const nomes = celTec.innerText
                .split(",")
                .map(n => n.trim())
                .filter(Boolean);

            celTec.innerHTML = nomes
                .map(n => `<span class="badge-tecnico">${n}</span>`)
                .join("");
        }
    });
}

// intercepta carregarOSAvulsas sem quebrar se a função ainda não existir
(function iniciarPatchFinalOSAvulsas() {
    const timer = setInterval(() => {
        if (typeof carregarOSAvulsas === "function") {
            clearInterval(timer);

            const original = carregarOSAvulsas;

            carregarOSAvulsas = async function() {
                await original();
                setTimeout(aplicarPatchFinalOSAvulsas, 150);
            };

            setTimeout(aplicarPatchFinalOSAvulsas, 800);
        }
    }, 200);

(function corrigirDescricaoOSAvulsasSemCortar(){

    if (document.getElementById("patch-descricao-os-avulsas-sem-cortar")) return;

    const style = document.createElement("style");
    style.id = "patch-descricao-os-avulsas-sem-cortar";

    style.innerHTML = `
        #cardOSAvulsas table,
        #cardOSAvulsasConcluidas table{
            table-layout:auto !important;
            min-width:1450px !important;
        }

        #cardOSAvulsas td,
        #cardOSAvulsasConcluidas td{
            vertical-align:middle !important;
        }

        #cardOSAvulsas td:nth-child(5),
        #cardOSAvulsasConcluidas td:nth-child(5){
            width:420px !important;
            max-width:420px !important;
            white-space:normal !important;
            overflow:visible !important;
        }

        #cardOSAvulsas .descricao-avulsa,
        #cardOSAvulsasConcluidas .descricao-avulsa{
            width:420px !important;
            max-width:420px !important;
            min-width:420px !important;
            white-space:normal !important;
            overflow:visible !important;
            display:table-cell !important;
            vertical-align:middle !important;
            line-height:18px !important;
            height:auto !important;
            max-height:none !important;
        }

        #cardOSAvulsas .descricao-avulsa .texto-descricao,
        #cardOSAvulsasConcluidas .descricao-avulsa .texto-descricao{
            display:block !important;
            width:420px !important;
            max-width:420px !important;
            white-space:normal !important;
            word-break:break-word !important;
            overflow-wrap:anywhere !important;
            line-height:18px !important;
            height:auto !important;
            max-height:none !important;
            overflow:visible !important;
            margin:0 !important;
            padding:0 !important;
        }
    `;

    document.head.appendChild(style);

})();


})();
