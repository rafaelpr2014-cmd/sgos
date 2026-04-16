// Pegar ID da URL
const params = new URLSearchParams(window.location.search);
const osId = params.get("id");

async function carregarOS() {
    try {
        const data = await fetchAuth("/api/ordens_servico");
        const os = data.find(o => o.id == osId);
        if (!os) return alert("OS não encontrada");

        document.getElementById("osId").value = os.id;
        document.getElementById("nome").value = os.nome || "";
        document.getElementById("tecnico").value = Array.isArray(os.tecnico) ? os.tecnico.join(", ") : os.tecnico || "";
        document.getElementById("agendamento").value = os.agendamento ? new Date(os.agendamento).toISOString().slice(0,16) : "";
        document.getElementById("tipo_servico_id").value = os.tipo_servico_id || "";
        document.getElementById("plano_nome").value = os.plano_nome || "";
        document.getElementById("telefone").value = os.telefone || "";
        document.getElementById("login").value = os.login || "";
        document.getElementById("id_cliente").value = os.id_cliente || "";
        document.getElementById("status").value = os.status || "aberto";

    } catch (err) {
        console.error("Erro ao carregar OS:", err);
    }
}

document.getElementById("formEditarOS").addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
        nome: document.getElementById("nome").value,
        tecnico: document.getElementById("tecnico").value.split(",").map(t => t.trim()),
        agendamento: document.getElementById("agendamento").value,
        tipo_servico_id: document.getElementById("tipo_servico_id").value,
        plano_nome: document.getElementById("plano_nome").value,
        telefone: document.getElementById("telefone").value,
        login: document.getElementById("login").value,
        id_cliente: document.getElementById("id_cliente").value,
        status: document.getElementById("status").value
    };

    try {
        await fetchAuth("/api/ordens_servico/" + osId, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        alert("OS atualizada com sucesso!");
        window.location.href = "/painel.html";

    } catch (err) {
        console.error("Erro ao atualizar OS:", err);
        alert("Erro ao atualizar OS");
    }
});

carregarOS();