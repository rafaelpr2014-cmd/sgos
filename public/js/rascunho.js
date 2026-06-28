<script src="/js/auth.js" defer></script>

<script>
// =========================
// FUNÇÃO PADRÃO (ANTI-ERRO API)
// =========================
function tratarResposta(res){
    if(res.status === 401){
        console.warn("Não autenticado")
        return Promise.resolve([]) // 🔥 CORRETO
    }
    return res.json()
}

// =========================
// LISTAR RASCUNHOS
// =========================
function carregarRascunhos(){
    fetch("/api/ordens_servico")
    .then(tratarResposta)
    .then(data => {

        if(!Array.isArray(data)){
            console.warn("Erro API:", data)
            return
        }

        let html = ""

        // filtrar apenas rascunhos
        const rascunhos = data.filter(r => r.status === "rascunho")

        if(!rascunhos.length){
            html = `<tr><td colspan="15">Nenhum rascunho encontrado</td></tr>`
        } else {

            rascunhos.forEach(r => {

                let dataFormatada = r.agendamento 
                    ? new Date(r.agendamento).toLocaleString("pt-BR") 
                    : "-"

                let tecnicos = "-"
                try{
                    if(r.tecnico){
                        const lista = typeof r.tecnico === "string"
                            ? JSON.parse(r.tecnico)
                            : r.tecnico
                        tecnicos = lista.map(t => `<span class="badge-tecnico">${t}</span>`).join(", ")
                    }
                }catch{}

                let prioridadeClass = ""
                if(r.prioridade === "baixa") prioridadeClass = "prioridade-baixa"
                if(r.prioridade === "media") prioridadeClass = "prioridade-media"
                if(r.prioridade === "alta") prioridadeClass = "prioridade-alta"

                html += `
<tr>
<td>${r.id || "-"}</td>
<td>${r.nome || "-"}</td>
<td>${r.localidade_nome || r.localidade || "-"}</td>
<td>${r.rua || "-"}</td>
<td>${r.bairro || "-"}</td>
<td>${r.referencia || "-"}</td>
<td>${r.plano_nome || r.plano || "-"}</td>
<td>${r.tipo_servico_nome || r.tipo_servico || "-"}</td>
<td>${r.login || "-"}</td>
<td>${r.id_cliente || "-"}</td>
<td>${r.telefone || "-"}</td>
<td>${tecnicos}</td>
<td>${r.prioridade ? `<span class="badge ${prioridadeClass}">${r.prioridade}</span>` : "-"}</td>
<td>${dataFormatada}</td>
<td>
<button onclick="excluir(${r.id})">🗑</button>
</td>
</tr>
`
            })
        }

        document.getElementById("listaRascunhos").innerHTML = html

    })
    .catch(err => {
        console.error("Erro:", err)
        document.getElementById("listaRascunhos").innerHTML =
        `<tr><td colspan="15">Erro ao carregar</td></tr>`
    })
}

// =========================
// CARREGAR SELECT PADRÃO
// =========================
function carregarSelect(url, id){

    fetch(url)
    .then(tratarResposta)
    .then(data => {

        if(!Array.isArray(data)) return

        let html = '<option value="">Selecione</option>'

        data.forEach(item => {
            html += `<option value="${item.id}">${item.nome}</option>`
        })

        const el = document.getElementById(id)
        if(el) el.innerHTML = html

    })
}

// =========================
// CARREGAR TECNICOS
// =========================
function carregarTecnicos(){
    fetch("/api/tecnicos")
    .then(tratarResposta)
    .then(data => {

        if(!Array.isArray(data)) return

        let html = '<option value="">Selecione</option>'

        data.forEach(t => {
            html += `<option value="${t.nome}">${t.nome}</option>`
        })

        document.getElementById("tecnico").innerHTML = html
    })
}

// =========================
// PEGAR TECNICOS SELECIONADOS
// =========================
function getTecnicosSelecionados(){
    const select = document.getElementById("tecnico")
    return Array.from(select.selectedOptions).map(o => o.value)
}

// =========================
// SALVAR RASCUNHO
// =========================
function salvarRascunho(){

    const dados = {
        nome: document.getElementById("nome").value,
        telefone: document.getElementById("telefone").value,
        login: document.getElementById("login").value,
        id_cliente: document.getElementById("id_cliente").value,
        localidade: document.getElementById("localidade").value,
        plano: document.getElementById("plano").value,
        tipo_servico: document.getElementById("servico").value,
        tecnico: getTecnicosSelecionados(),
        prioridade: document.getElementById("prioridade").value,
        rua: document.getElementById("rua").value,
        bairro: document.getElementById("bairro").value,
        referencia: document.getElementById("referencia").value,
        descricao: document.getElementById("descricao").value,
        agendamento: document.getElementById("agendamento").value
    }

    fetch("/api/rascunho", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados)
    })
    .then(tratarResposta)
    .then(() => {
        alert("Rascunho salvo!")
        carregarRascunhos()
    })
}

// =========================
// EXCLUIR
// =========================
function excluir(id){
    if(!confirm("Deseja excluir?")) return

    fetch(`/api/rascunho/${id}`, { method:"DELETE" })
    .then(() => carregarRascunhos())
}

// =========================
// INIT
// =========================
document.addEventListener("DOMContentLoaded", () => {

    console.log("Sistema carregado ✅")

    carregarRascunhos()
    carregarSelect("/api/localidades", "localidade")
    carregarSelect("/api/planos", "plano")
    carregarSelect("/api/servicos", "servico")
    carregarTecnicos()

})
</script>