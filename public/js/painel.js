// ===============================
// VARIÁVEIS GLOBAIS
// ===============================
let ordens = [];

// ===============================
// API FETCH PADRÃO (🔥 IMPORTANTE)
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
// MAPA DE STATUS
// ===============================
const STATUS_MAP = {
    "aberto": ["status-aberto","Aberto"],
    "em_andamento": ["status-andamento","Em andamento"],
    "cliente_ausente": ["status-ausente","Cliente Ausente"],
    "concluido": ["status-finalizado","Concluído"],
    "agendado": ["status-agendado","Agendado"]
};

// ===============================
// FORMATOS
// ===============================
function formatarData(data) {
    if (!data) return "-";
    return new Date(data).toLocaleString("pt-BR");
}

function formatarEndereco(os) {
    return `${os.rua || "-"}<br><small>${os.bairro || ""} ${os.referencia || ""}</small>`;
}

function formatarTecnicos(tecnicos) {
    if (!tecnicos || tecnicos === "[]") return "-";

    try {
        const arr = typeof tecnicos === "string" ? JSON.parse(tecnicos) : tecnicos;
        return arr.map(t => `<span class="badge-tecnico">${t}</span>`).join("");
    } catch {
        return tecnicos || "-";
    }
}

// ===============================
// STATUS
// ===============================
function normalizarStatus(status) {
    if (!status) return "agendado";
    const s = status.toLowerCase();
    if (s === "andamento") return "em_andamento";
    if (s === "ausente") return "cliente_ausente";
    return s.replace(/\s+/g, "_");
}

// ===============================
// CARREGAR OS
// ===============================
async function carregarOS() {
    try {
        const data = await apiFetch("/api/ordens_servico");

        ordens = data.map(o => ({
            ...o,
            status: normalizarStatus(o.status)
        }));

        atualizarCards();
        popularTabelas();

    } catch (err) {
        console.error("Erro ao carregar OS:", err);
    }
}

// ===============================
// CARDS
// ===============================
function atualizarCards() {
    document.getElementById("abertas").innerText = ordens.filter(o => o.status === "aberto").length;
    document.getElementById("andamento").innerText = ordens.filter(o => o.status === "em_andamento").length;
    document.getElementById("finalizadas").innerText = ordens.filter(o => o.status === "concluido").length;
    document.getElementById("clientesAusentes").innerText = ordens.filter(o => o.status === "cliente_ausente").length;
}

// ===============================
// TABELAS
// ===============================
function popularTabelas() {
    popularTabela("tabelaAbertas", ordens.filter(o => ["aberto","cliente_ausente"].includes(o.status)));
    popularTabelaCompleta("tabelaAndamento", ordens.filter(o => o.status === "em_andamento"));
    popularTabelaCompleta("tabelaConcluidas", ordens.filter(o => o.status === "concluido"));
}

// ===============================
// TABELA COMPLETA
// ===============================
function popularTabelaCompleta(id, dados) {
    const tbody = document.getElementById(id);
    tbody.innerHTML = "";

    if (!dados.length) {
        tbody.innerHTML = `<tr><td colspan="14">Nenhum registro</td></tr>`;
        return;
    }

    dados.forEach(os => {
        const [classe, texto] = STATUS_MAP[os.status] || STATUS_MAP["agendado"];

        tbody.innerHTML += `
        <tr>
            <td>${os.id}</td>
            <td><strong>${os.nome}</strong></td>
            <td>${os.localidade_nome || "-"}</td>
            <td>${formatarEndereco(os)}</td>
            <td>${formatarTecnicos(os.tecnicos_nomes || os.tecnicos)}</td>
            <td>${os.tipo_servico_nome || "-"}</td>
            <td>${os.plano_nome || "-"}</td>
            <td>${os.id_cliente || "-"}</td>
            <td>${os.login || "-"}</td>
            <td>${os.telefone || "-"}</td>
            <td>${formatarData(os.iniciado_em || os.finalizado_em)}</td>
            <td>${os.enviado_por || os.finalizado_por || "-"}</td>
            <td><span class="status-box ${classe}">${texto}</span></td>
        </tr>`;
    });
}

// ===============================
// TABELA COM AÇÕES
// ===============================
function popularTabela(id, dados) {
    const tbody = document.getElementById(id);
    tbody.innerHTML = "";

    if (!dados.length) {
        tbody.innerHTML = `<tr><td colspan="15">Nenhum registro</td></tr>`;
        return;
    }

    dados.forEach(os => {
        const [classe, texto] = STATUS_MAP[os.status] || STATUS_MAP["agendado"];

        let botoes = `
        <span class="icone-acao" onclick="editarOS(${os.id})">✏️</span>
        `;

        if (os.status === "aberto" || os.status === "cliente_ausente") {
            botoes += `<span class="icone-acao" onclick="lancarAgora(${os.id})">🚀</span>`;
        }

        if (os.status === "em_andamento") {
            botoes += `<span class="icone-acao" onclick="finalizarOS(${os.id})">✅</span>`;
        }

        botoes += `<span class="icone-acao" onclick="excluirOS(${os.id})">🗑️</span>`;

        tbody.innerHTML += `
        <tr>
            <td>${os.id}</td>
            <td><strong>${os.nome}</strong></td>
            <td>${os.localidade_nome || "-"}</td>
            <td>${formatarEndereco(os)}</td>
            <td>${formatarTecnicos(os.tecnicos_nomes || os.tecnicos)}</td>
            <td>${os.tipo_servico_nome || "-"}</td>
            <td>${os.plano_nome || "-"}</td>
            <td>${os.id_cliente || "-"}</td>
            <td>${os.login || "-"}</td>
            <td>${os.telefone || "-"}</td>
            <td>${formatarData(os.data_abertura)}</td>
            <td>${os.criado_por_nome || "-"}</td>
            <td>${formatarData(os.agendamento)}</td>
            <td><span class="status-box ${classe}">${texto}</span></td>
            <td>${botoes}</td>
        </tr>`;
    });
}

// ===============================
// AÇÕES
// ===============================
window.editarOS = (id) => {
    window.location.href = `editar-os.html?id=${id}`;
};

window.lancarAgora = async (id) => {
    if (!confirm("Deseja iniciar essa OS agora?")) return;

    try {
        await apiFetch(`/api/ordens_servico/iniciar/${id}`, { method: "POST" });
        alert("OS iniciada!");
        carregarOS();
    } catch {
        alert("Erro ao iniciar OS");
    }
};

window.finalizarOS = async (id) => {
    if (!confirm("Finalizar essa OS?")) return;

    try {
        await apiFetch(`/api/ordens_servico/concluir/${id}`, { method: "POST" });
        alert("OS finalizada!");
        carregarOS();
    } catch {
        alert("Erro ao finalizar OS");
    }
};

window.excluirOS = async (id) => {
    if (!confirm("Excluir OS?")) return;

    try {
        await apiFetch(`/api/ordens_servico/${id}`, { method: "DELETE" });
        alert("OS excluída!");
        carregarOS();
    } catch {
        alert("Erro ao excluir OS");
    }
};

// ===============================
// INIT
// ===============================
window.addEventListener("DOMContentLoaded", () => {
    carregarOS();
    setInterval(carregarOS, 60000);
});