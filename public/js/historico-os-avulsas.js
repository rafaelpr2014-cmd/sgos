async function apiFetch(url, options = {}) {
    const usuario = JSON.parse(localStorage.getItem("usuario") || "{}");
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
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}
function formatarData(data) {
    if (!data) return "-";
    const d = new Date(data);
    return isNaN(d) ? "-" : d.toLocaleString("pt-BR");
}
function normalizarStatus(status) {
    const s = String(status || "em_aberto").toLowerCase().trim();
    if (s.includes("andamento") || s.includes("exec")) return "em_andamento";
    if (s.includes("concl") || s.includes("final")) return "concluido";
    if (s.includes("abert")) return "em_aberto";
    return s;
}
function statusHTML(status) {
    const s = normalizarStatus(status);
    const mapa = {
        em_aberto: ["status-aberto", "Em aberto"],
        em_andamento: ["status-andamento", "Em execução"],
        concluido: ["status-concluido", "Finalizado"]
    };
    const item = mapa[s] || mapa.em_aberto;
    return `<span class="status-box ${item[0]}">${item[1]}</span>`;
}
function visualizarAnexoOSAvulsa(arquivo) {
    if (!arquivo) return alert("Esta OS Avulsa não possui anexo.");
    const url = String(arquivo).startsWith("/") ? arquivo : `/api/os-avulsas/anexo/${arquivo}`;
    window.open(url, "_blank");
}
function comprovanteOSAvulsa(id) {
    const usuario = JSON.parse(localStorage.getItem("usuario") || "{}");
    const token = btoa((usuario.id || "") + "_SGOS");
    window.open(`/api/os-avulsas/comprovacao/${id}?token=${token}`, "_blank");
}
async function reciclarOSAvulsa(id) {
    if (!confirm("Deseja reciclar esta OS Avulsa e voltar para Em aberto?")) return;
    await apiFetch(`/api/os-avulsas/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status: "em_aberto" })
    });
    carregarHistorico();
}
async function carregarHistorico() {
    const tbody = document.getElementById("tbody");
    const busca = document.getElementById("busca").value.toLowerCase().trim();
    const statusFiltro = document.getElementById("status").value;
    tbody.innerHTML = `<tr><td colspan="12">Carregando...</td></tr>`;
    let url = "/api/os-avulsas";
    if (statusFiltro) url += `?status=${encodeURIComponent(statusFiltro)}`;
    const lista = await apiFetch(url);
    const filtrados = lista.filter(os => {
        const texto = [os.localidade, os.tecnicos_nomes, os.tecnicos, os.tipo_servico, os.endereco, os.descricao, os.criado_por_nome, os.finalizado_por_nome].join(" ").toLowerCase();
        return !busca || texto.includes(busca);
    });
    if (!filtrados.length) {
        tbody.innerHTML = `<tr><td colspan="12">Nenhum registro encontrado</td></tr>`;
        return;
    }
    tbody.innerHTML = "";
    filtrados.forEach(os => {
        const status = normalizarStatus(os.status);
        const acoes = `
            <div class="acoes">
                ${os.anexo ? `<button class="acao" title="Anexo" onclick="visualizarAnexoOSAvulsa('${os.anexo}')">📎</button>` : ""}
                <button class="acao" title="Comprovante" onclick="comprovanteOSAvulsa(${os.id})">📄</button>
                ${status === "concluido" ? `<button class="acao" title="Reciclar OS Avulsa" onclick="reciclarOSAvulsa(${os.id})">🔁</button>` : ""}
            </div>`;
        tbody.innerHTML += `
            <tr>
                <td><strong>${os.localidade || "-"}</strong></td>
                <td>${os.tecnicos_nomes || os.tecnicos || "-"}</td>
                <td>${os.tipo_servico || "-"}</td>
                <td>${os.endereco || "-"}</td>
                <td><div class="descricao">${os.descricao || "-"}</div></td>
                <td>${formatarData(os.criado_em)}</td>
                <td>${formatarData(os.iniciado_em)}</td>
                <td>${formatarData(os.finalizado_em || os.atualizado_em)}</td>
                <td>${os.criado_por_nome || "-"}</td>
                <td>${os.finalizado_por_nome || "-"}</td>
                <td>${statusHTML(os.status)}</td>
                <td>${acoes}</td>
            </tr>`;
    });
}
document.getElementById("busca").addEventListener("input", () => {
    clearTimeout(window.__timerBuscaAvulsa);
    window.__timerBuscaAvulsa = setTimeout(carregarHistorico, 300);
});
document.getElementById("status").addEventListener("change", carregarHistorico);
document.addEventListener("DOMContentLoaded", carregarHistorico);
