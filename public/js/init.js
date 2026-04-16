// ===============================
// 👤 OBTER USUÁRIO DO LOCALSTORAGE
// ===============================
function obterUsuario() {
    const user = localStorage.getItem("usuario");
    return user ? JSON.parse(user) : null;
}

// ===============================
// 🔐 VERIFICAR AUTENTICAÇÃO
// ===============================
function verificarAutenticacao() {
    const usuario = obterUsuario();
    const paginaLogin = window.location.pathname.includes("login");

    if (!usuario && !paginaLogin) {
        window.location.href = "/login.html";
    }
}

// ===============================
// 🔥 FETCH PADRÃO COM AUTH (CORRIGIDO)
// ===============================
async function fetchAuth(url, opcoes = {}) {
    const usuario = obterUsuario();

    const isFormData = opcoes.body instanceof FormData;

    const headers = {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(opcoes.headers || {})
    };

    if (usuario) {
        headers["x-usuario-id"] = usuario.id;
        headers["x-usuario-nome"] = usuario.usuario || usuario.nome;
        headers["x-usuario-cargo"] = usuario.cargo;
    }

    const res = await fetch(url, {
        ...opcoes,
        headers
    });

    if (res.status === 401) {
        localStorage.removeItem("usuario");
        window.location.href = "/login.html";
        return;
    }

    if (!res.ok) {
        const text = await res.text();
        console.error("Erro API:", text);
        throw new Error("Erro na API");
    }

    return await res.json();
}

// ===============================
// 🟢 USUÁRIO LOGADO
// ===============================
function atualizarUsuarioLogado() {
    const el = document.getElementById("userEmpresa");
    const usuario = obterUsuario();
    if (el && usuario) {
        el.innerText = `${usuario.usuario || usuario.nome} (${usuario.cargo}) ▼`;
    }
}

// ===============================
// 🔧 NORMALIZAÇÃO
// ===============================
function normalizarStatus(status) {
    if (!status) return "agendado";

    const s = status.toString().trim().toLowerCase().replace(/\s+/g, "_");

    switch(s) {
        case "aberto": return "aberto";
        case "em_andamento": return "em_andamento";
        case "concluido": return "concluido";
        case "cliente_ausente": return "cliente_ausente";
        case "agendado": return "agendado";
        default: return "agendado";
    }
}

function normalizarOS(os) {
    return {
        ...os,
        status: normalizarStatus(os.status),
        cliente: os.cliente || os.nome || "-",
        endereco: os.endereco || (os.rua ? `${os.rua} ${os.bairro || ""} ${os.referencia || ""}`.trim() : "-"),
        servico: os.servico || os.tipo_servico_nome || "-",
        plano: os.plano || os.plano_nome || "-",
        agendamento: os.data_agendamento || os.agendamento || "-",
        tecnico: os.tecnico || "-",
        criado_por: os.criado_por_nome || "-" 
    };
}

// ===============================
// ✏️ EDITAR
// ===============================
window.editar = function(id) {
    window.location.href = `/novo-atendimento.html?id=${id}`;
};

// ===============================
// 🚀 LANÇAR AGORA
// ===============================
window.lancarAgora = async function(id) {
    if (!confirm("Deseja lançar essa OS agora?")) return;

    try {
        await fetchAuth(`/api/ordens_servico/${id}/lancar_agora`, {
            method: "POST"
        });

        alert("🚀 OS lançada!");
        carregarOrdensServico();

    } catch (err) {
        console.error(err);
        alert("Erro ao lançar OS");
    }
};

// ===============================
// 📦 CACHE
// ===============================
let osCache = [];

// ===============================
// 📊 CARREGAR ORDENS
// ===============================
async function carregarOrdensServico() {
    try {
        const os = await fetchAuth("/api/ordens_servico");
        osCache = os.map(normalizarOS);

        let abertas = 0, andamento = 0, finalizadas = 0, ausentes = 0;

        const tabelaAbertas = document.getElementById("tabelaAbertas");
        const tabelaAndamento = document.getElementById("tabelaAndamento");
        const tabelaConcluidas = document.getElementById("tabelaConcluidas");

        [tabelaAbertas, tabelaAndamento, tabelaConcluidas].forEach(tbl => {
            if (tbl) tbl.innerHTML = "";
        });

        osCache.forEach(o => {

            if(o.status === "aberto") abertas++;
            else if(o.status === "em_andamento") andamento++;
            else if(o.status === "concluido") finalizadas++;
            else if(o.status === "cliente_ausente") ausentes++;

            const tr = document.createElement("tr");

            const statusClass = {
                "agendado": "status-agendado",
                "aberto": "status-aberto",
                "em_andamento": "status-andamento",
                "concluido": "status-finalizado",
                "cliente_ausente": "status-ausente"
            }[o.status] || "";

            const statusHTML = `<span class="status-box ${statusClass}">${o.status.replace("_"," ")}</span>`;

            tr.innerHTML = `
<td>${o.id}</td>
<td>${o.cliente}</td>
<td>${o.localidade || "-"}</td>
<td>${o.endereco}</td>
<td>${o.tecnico}</td>
<td>${o.servico}</td>
<td>${o.plano}</td>
<td>${o.id_cliente || "-"}</td>
<td>${o.login || "-"}</td>
<td>${o.telefone || "-"}</td>
<td>${o.criado_por}</td>
<td>${o.agendamento}</td>
<td>${o.finalizadoEm || o.iniciadoEm || "-"}</td>
<td>${o.finalizadoPor || o.enviadoPor || "-"}</td>
<td>${statusHTML}</td>
<td>
    <button onclick="editar(${o.id})">✏️</button>
    <button onclick="lancarAgora(${o.id})">🚀</button>
</td>
            `;

            if(o.status === "aberto" || o.status === "cliente_ausente") {
                tabelaAbertas?.appendChild(tr);
            } else if(o.status === "em_andamento") {
                tabelaAndamento?.appendChild(tr);
            } else if(o.status === "concluido") {
                tabelaConcluidas?.appendChild(tr);
            }
        });

        if (tabelaAbertas && tabelaAbertas.innerHTML === "") {
            tabelaAbertas.innerHTML = `<tr><td colspan="16">Nenhuma OS encontrada</td></tr>`;
        }

        if (tabelaAndamento && tabelaAndamento.innerHTML === "") {
            tabelaAndamento.innerHTML = `<tr><td colspan="16">Nenhuma OS encontrada</td></tr>`;
        }

        if (tabelaConcluidas && tabelaConcluidas.innerHTML === "") {
            tabelaConcluidas.innerHTML = `<tr><td colspan="16">Nenhuma OS encontrada</td></tr>`;
        }

    } catch(err) {
        console.error("Erro ao carregar OS:", err);
    }
}

// ===============================
// 🔽 CARREGAR SELECTS FILTRADOS
// ===============================
async function carregarSelects() {
    try {
        const localidades = await fetchAuth("/api/ordens_servico/localidades");
        const tecnicos = await fetchAuth("/api/ordens_servico/tecnicos");

        const selLocalidade = document.getElementById("localidade");
        const selTecnico = document.getElementById("tecnico");

        if (selLocalidade) {
            selLocalidade.innerHTML = "";
            localidades.forEach(l => {
                const opt = document.createElement("option");
                opt.value = l.id;
                opt.textContent = l.nome;
                selLocalidade.appendChild(opt);
            });
        }

        if (selTecnico) {
            selTecnico.innerHTML = "";
            tecnicos.forEach(t => {
                const opt = document.createElement("option");
                opt.value = t.id;
                opt.textContent = t.nome;
                selTecnico.appendChild(opt);
            });
        }

    } catch(err) {
        console.error("Erro ao carregar selects:", err);
    }
}

// ===============================
// 🚀 INIT
// ===============================
verificarAutenticacao();

window.addEventListener("DOMContentLoaded", () => {
    atualizarUsuarioLogado();
    carregarOrdensServico();
    carregarSelects(); // 🔹 aqui
});