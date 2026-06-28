// =========================================================
// PATCH PARA nova-os-avulsa.html - MODO EDIÇÃO
// Cole dentro do <script>, logo após: let anexoArquivo = null;
// =========================================================

const paramsOSAvulsa = new URLSearchParams(window.location.search);
const osAvulsaId = paramsOSAvulsa.get("id");

// =========================================================
// CARREGAR OS AVULSA PARA EDIÇÃO
// =========================================================
async function carregarOSAvulsaEdicao() {
    if (!osAvulsaId) return;

    const os = await apiFetch(`/api/os-avulsas/${osAvulsaId}`);

    document.getElementById("localidade").value = os.localidade || "";
    document.getElementById("tipo_servico").value = os.tipo_servico || "";
    document.getElementById("descricao").value = os.descricao || "";
    document.getElementById("status").value = os.status || "em_aberto";

    setTimeout(() => {
        let tecnicos = [];

        try {
            tecnicos = JSON.parse(os.tecnicos || "[]");
        } catch {
            tecnicos = [];
        }

        Array
        .from(document.getElementById("tecnico").options)
        .forEach(opt => {
            opt.selected = tecnicos.includes(Number(opt.value));
        });
    }, 200);

    const titulo = document.querySelector(".page-title h2");
    if (titulo) titulo.innerText = "Editar OS Avulsa";

    const btnSalvar = document.getElementById("btnSalvar");
    if (btnSalvar) btnSalvar.innerText = "Salvar Alterações";

    if (os.anexo) {
        document.getElementById("previewAnexo").innerHTML = `
            <div style="margin-top:15px;">
                <b>Anexo atual:</b><br>
                <a href="/api/os-avulsas/anexo/${os.anexo}" target="_blank">📎 Visualizar anexo</a>
            </div>
        `;
    }
}

// =========================================================
// ALTERE A FUNÇÃO salvarOSAvulsa()
// Troque este trecho:
// await apiFetch("/api/os-avulsas", { method:"POST", body:formData });
// por:
// =========================================================

await apiFetch(
    osAvulsaId ? `/api/os-avulsas/${osAvulsaId}` : "/api/os-avulsas",
    {
        method: osAvulsaId ? "PUT" : "POST",
        body: formData
    }
);

// =========================================================
// NO DOMContentLoaded, depois de await carregarTecnicos(); adicione:
// =========================================================

await carregarOSAvulsaEdicao();
