// ======================================
// SALVAR ATENDIMENTO (AGORA CORRETO)
// ======================================
async function salvarAtendimento() {

    const nome = document.getElementById("nome").value.trim();
    const telefone = document.getElementById("telefone").value.trim();
    const localidade = document.getElementById("localidade").value;

    const rua = document.getElementById("rua").value.trim();
    const bairro = document.getElementById("bairro").value.trim();
    const referencia = document.getElementById("referencia").value.trim();

    const plano = document.getElementById("plano").value;
    const id_cliente = document.getElementById("id_cliente").value;
    const login = document.getElementById("login").value;
    const tipo_servico = document.getElementById("tipo_servico").value;

    const agendamento = document.getElementById("agendamento").value;

    const tecnicoSelect = document.getElementById("tecnico");
    const tecnico = Array.from(tecnicoSelect.selectedOptions)
        .map(option => option.value);

    // VALIDAÇÃO
    if (!nome || !telefone || !localidade || !plano || !tipo_servico || tecnico.length === 0) {
        alert("Preencha todos os campos obrigatórios.");
        return;
    }

    try {

        const response = await fetch("/api/ordens_servico", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                nome,
                telefone,
                localidade,
                rua,
                bairro,
                referencia,
                plano,
                tecnico,
                id_cliente,
                login,
                tipo_servico,
                agendamento
            })
        });

        if (!response.ok) throw new Error("Erro ao salvar");

        alert("Atendimento criado com sucesso! 🚀");

        limparFormulario();

    } catch (error) {
        console.error("Erro:", error);
        alert("Erro ao salvar atendimento.");
    }
}