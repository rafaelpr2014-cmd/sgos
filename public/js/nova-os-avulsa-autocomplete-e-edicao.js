// =====================================================

async function apiFetchOSAvulsa(url, options = {}) {
    const usuario = JSON.parse(localStorage.getItem("usuario") || "{}");

    if (!usuario || !usuario.id) {
        alert("Sessão expirada.");
        window.location.href = "/login.html";
        return;
    }

    const res = await fetch(url, {
        ...options,
        headers: {
            "x-usuario-id": usuario.id,
            ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
            ...(options.headers || {})
        }
    });

    if (!res.ok) {
        const text = await res.text();
        console.error("Erro API OS Avulsa:", text);
        throw new Error(text || "Erro API OS Avulsa");
    }

    return res.json();
}

function getParamOSAvulsa(nome) {
    return new URLSearchParams(window.location.search).get(nome);
}

function setValorCampoOSAvulsa(id, valor) {
    const el =
        document.getElementById(id) ||
        document.querySelector(`[name="${id}"]`);

    if (!el) return;

    el.value = valor || "";

    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
}

// =====================================================
// TÉCNICOS - NORMALIZAÇÃO E SELEÇÃO NO EDITAR
// =====================================================
function normalizarListaTecnicosOSAvulsa(valor) {
    if (!valor) return [];

    if (Array.isArray(valor)) {
        return valor
            .map(v => String(v).trim())
            .filter(Boolean);
    }

    if (typeof valor === "string") {
        const texto = valor.trim();

        if (!texto) return [];

        try {
            const parsed = JSON.parse(texto);

            if (Array.isArray(parsed)) {
                return parsed
                    .map(v => String(v).trim())
                    .filter(Boolean);
            }

            if (parsed !== null && parsed !== undefined) {
                return [String(parsed).trim()].filter(Boolean);
            }

        } catch {}

        return texto
            .split(",")
            .map(v => String(v).trim())
            .filter(Boolean);
    }

    return [String(valor).trim()].filter(Boolean);
}

function normalizarTextoComparacaoOSAvulsa(valor) {
    return String(valor || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function selecionarTecnicosOSAvulsa(os) {
    const select =
        document.getElementById("tecnico") ||
        document.getElementById("tecnicos") ||
        document.querySelector('[name="tecnico"]') ||
        document.querySelector('[name="tecnicos"]');

    if (!select) {
        console.warn("Select de técnicos não encontrado.");
        return;
    }

    const ids = normalizarListaTecnicosOSAvulsa(os.tecnicos)
        .map(v => String(v).trim());

    const nomes = normalizarListaTecnicosOSAvulsa(os.tecnicos_nomes)
        .map(normalizarTextoComparacaoOSAvulsa);

    Array.from(select.options).forEach(opt => {
        const value = String(opt.value || "").trim();
        const text = normalizarTextoComparacaoOSAvulsa(opt.textContent);

        opt.selected =
            ids.includes(value) ||
            nomes.includes(text);
    });

    select.dispatchEvent(new Event("change", { bubbles: true }));
}

// Aguarda o select ser preenchido pela função carregarTecnicos() da página
async function aguardarOptionsTecnicosOSAvulsa(tentativas = 30) {
    const select =
        document.getElementById("tecnico") ||
        document.getElementById("tecnicos") ||
        document.querySelector('[name="tecnico"]') ||
        document.querySelector('[name="tecnicos"]');

    if (!select) return null;

    for (let i = 0; i < tentativas; i++) {
        if (select.options && select.options.length > 0) {
            return select;
        }

        await new Promise(resolve => setTimeout(resolve, 150));
    }

    return select;
}

// =====================================================
// CARREGAR EDIÇÃO
// =====================================================
async function carregarEdicaoOSAvulsa() {
    const id = getParamOSAvulsa("id");
    if (!id) return;

    try {
        const os = await apiFetchOSAvulsa(`/api/os-avulsas/${id}`);

        setValorCampoOSAvulsa("localidade", os.localidade || os.localidade_nome);
        setValorCampoOSAvulsa("tipo_servico", os.tipo_servico || os.tipo_servico_nome);
        setValorCampoOSAvulsa("endereco", os.endereco);
        setValorCampoOSAvulsa("descricao", os.descricao);
        setValorCampoOSAvulsa("status", os.status || "em_aberto");

        setValorCampoOSAvulsa("tecnicos_nomes", os.tecnicos_nomes);

        const idHidden =
            document.getElementById("editId") ||
            document.getElementById("id") ||
            document.querySelector('[name="id"]');

        if (idHidden) idHidden.value = os.id;

        await aguardarOptionsTecnicosOSAvulsa();
        selecionarTecnicosOSAvulsa(os);

        const titulo = document.querySelector(".header-title");
        if (titulo) titulo.innerText = "Editar OS Avulsa";

        const pageTitle = document.querySelector(".page-title h2");
        if (pageTitle) pageTitle.innerText = "Editar OS Avulsa";

        const btnSalvar = document.getElementById("btnSalvar");
        if (btnSalvar) btnSalvar.innerText = "Atualizar OS Avulsa";

    } catch (err) {
        console.error("Erro ao carregar OS Avulsa para edição:", err);
        alert("Não foi possível carregar os dados da OS Avulsa.");
    }
}

// =====================================================
// AUTOCOMPLETE
// =====================================================
function injetarEstiloAutocompleteOSAvulsa() {
    if (document.getElementById("style-autocomplete-os-avulsa")) return;

    const style = document.createElement("style");
    style.id = "style-autocomplete-os-avulsa";

    style.innerHTML = `
        .autocomplete-osavulsa-wrap{
            position:relative !important;
        }

        .autocomplete-osavulsa-box{
            position:absolute;
            left:0;
            top:calc(100% + 4px);
            width:100%;
            background:#fff;
            border:1px solid #2563eb;
            border-radius:10px;
            box-shadow:0 10px 24px rgba(37,99,235,.20);
            z-index:99999;
            max-height:220px;
            overflow:auto;
            display:none;
        }

        .autocomplete-osavulsa-item{
            padding:10px 12px;
            color:#2563eb;
            font-weight:700;
            cursor:pointer;
            font-size:14px;
            border-bottom:1px solid #dbeafe;
            background:#fff;
        }

        .autocomplete-osavulsa-item:hover{
            background:#dbeafe;
        }

        .autocomplete-osavulsa-novo{
            color:#1d4ed8;
            background:#eff6ff;
        }
    `;

    document.head.appendChild(style);
}

function configurarAutocompleteOSAvulsa(inputId, _datalistId, endpoint) {
    const input =
        document.getElementById(inputId) ||
        document.querySelector(`[name="${inputId}"]`);

    if (!input) return;

    injetarEstiloAutocompleteOSAvulsa();

    const parent = input.parentElement;
    if (parent) parent.classList.add("autocomplete-osavulsa-wrap");

    const box = document.createElement("div");
    box.className = "autocomplete-osavulsa-box";
    input.insertAdjacentElement("afterend", box);

    let timer = null;

    function esconder() {
        setTimeout(() => {
            box.style.display = "none";
        }, 180);
    }

    function renderizar(lista, termo) {
        box.innerHTML = "";

        const nomes = [
            ...new Set(
                (Array.isArray(lista) ? lista : [])
                    .map(item =>
                        item.nome ||
                        item.localidade ||
                        item.tipo_servico ||
                        ""
                    )
                    .map(nome => String(nome).trim())
                    .filter(Boolean)
            )
        ];

        nomes.forEach(nome => {
            const item = document.createElement("div");
            item.className = "autocomplete-osavulsa-item";
            item.textContent = nome;

            item.onclick = () => {
                input.value = nome;
                input.dispatchEvent(new Event("change", { bubbles: true }));
                input.dispatchEvent(new Event("input", { bubbles: true }));
                box.style.display = "none";
            };

            box.appendChild(item);
        });

        if (
            termo &&
            !nomes.some(n => n.toLowerCase() === termo.toLowerCase())
        ) {
            const novo = document.createElement("div");
            novo.className = "autocomplete-osavulsa-item autocomplete-osavulsa-novo";
            novo.textContent = `+ Usar novo: ${termo}`;

            novo.onclick = () => {
                input.value = termo;
                input.dispatchEvent(new Event("change", { bubbles: true }));
                input.dispatchEvent(new Event("input", { bubbles: true }));
                box.style.display = "none";
            };

            box.appendChild(novo);
        }

        box.style.display = box.children.length ? "block" : "none";
    }

    async function buscar() {
        const q = input.value.trim();

        try {
            const lista = await apiFetchOSAvulsa(
                `${endpoint}?q=${encodeURIComponent(q)}`
            );

            renderizar(lista, q);

        } catch (err) {
            console.error(`Erro no autocomplete de ${inputId}:`, err);
            box.style.display = "none";
        }
    }

    input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(buscar, 220);
    });

    input.addEventListener("focus", buscar);
    input.addEventListener("blur", esconder);
}

// =====================================================
// PATCH SALVAR/EDITAR
// Se a página tiver salvarOSAvulsa(), intercepta para usar PUT no modo edição.
// =====================================================
function aplicarPatchSalvarEdicaoOSAvulsa() {
    const id = getParamOSAvulsa("id");

    if (!id) return;

    const btn = document.getElementById("btnSalvar");
    if (!btn) return;

    btn.onclick = null;

    btn.addEventListener("click", async () => {
        try {
            const localidade = document.getElementById("localidade")?.value.trim() || "";
            const endereco = document.getElementById("endereco")?.value.trim() || "";
            const tipoServico = document.getElementById("tipo_servico")?.value.trim() || "";
            const descricao = document.getElementById("descricao")?.value.trim() || "";
            const status = document.getElementById("status")?.value || "em_aberto";

            const select =
                document.getElementById("tecnico") ||
                document.getElementById("tecnicos");

            const tecnicosSelecionados = select
                ? Array.from(select.selectedOptions)
                : [];

            const tecnicosIds = tecnicosSelecionados.map(o => Number(o.value));
            const tecnicosNomes = tecnicosSelecionados.map(o => o.textContent.trim());

            if (!localidade) {
                alert("Informe a localidade.");
                return;
            }

            if (tecnicosIds.length === 0) {
                alert("Selecione pelo menos um técnico.");
                return;
            }

            if (!tipoServico) {
                alert("Informe o tipo de serviço.");
                return;
            }

            const formData = new FormData();

            formData.append("localidade", localidade);
            formData.append("endereco", endereco);
            formData.append("tecnicos", JSON.stringify(tecnicosIds));
            formData.append("tecnicos_nomes", tecnicosNomes.join(", "));
            formData.append("tipo_servico", tipoServico);
            formData.append("descricao", descricao);
            formData.append("status", status);

            const inputAnexo = document.getElementById("anexo");
            if (inputAnexo && inputAnexo.files && inputAnexo.files[0]) {
                formData.append("anexo", inputAnexo.files[0]);
            }

            await apiFetchOSAvulsa(`/api/os-avulsas/${id}`, {
                method: "PUT",
                body: formData
            });

            alert("OS Avulsa atualizada com sucesso!");
            window.location.href = "/painel.html";

        } catch (err) {
            console.error("Erro ao atualizar OS Avulsa:", err);
            alert("Erro ao atualizar OS Avulsa.");
        }
    });
}

(function aplicarAutocompletePromptOSAvulsa(){
    if (document.getElementById("autocomplete-prompt-os-avulsa-style")) return;

    const style = document.createElement("style");
    style.id = "autocomplete-prompt-os-avulsa-style";

    style.innerHTML = `
        .autocomplete-osavulsa-wrap{
            position:relative !important;
        }

        .autocomplete-osavulsa-box{
            top:0 !important;
            left:calc(100% + 10px) !important;
            width:360px !important;
            min-width:280px;
            background:#0f172a !important;
            border:1px solid #2563eb !important;
            border-radius:10px !important;
            box-shadow:0 10px 30px rgba(37,99,235,.30) !important;
            z-index:999999 !important;
            overflow:hidden !important;
        }

        .autocomplete-osavulsa-box::before{
            content:"Sugestões";
            display:block;
            background:#2563eb;
            color:white;
            font-size:12px;
            font-weight:800;
            padding:8px 10px;
            letter-spacing:.3px;
        }

        .autocomplete-osavulsa-item{
            color:#93c5fd !important;
            background:#0f172a !important;
            border-bottom:1px solid rgba(147,197,253,.18) !important;
            font-family:Consolas, "Courier New", monospace !important;
            font-size:13px !important;
            padding:9px 12px !important;
        }

        .autocomplete-osavulsa-item::before{
            content:"> ";
            color:#38bdf8;
            font-weight:900;
        }

        .autocomplete-osavulsa-item:hover{
            background:#1e3a8a !important;
            color:white !important;
        }

        .autocomplete-osavulsa-novo{
            color:#bfdbfe !important;
            background:#172554 !important;
        }

        @media(max-width:900px){
            .autocomplete-osavulsa-box{
                left:0 !important;
                top:calc(100% + 4px) !important;
                width:100% !important;
            }
        }
    `;

    document.head.appendChild(style);
})();

(function patchAutocompleteSelecionadoOSAvulsa(){

    if (document.getElementById("patch-autocomplete-selecionado-os-avulsa")) return;

    const style = document.createElement("style");
    style.id = "patch-autocomplete-selecionado-os-avulsa";

    style.innerHTML = `
        .campo-autocomplete-selecionado{
            border-color:#2563eb !important;
            background:#eff6ff !important;
            box-shadow:0 0 0 3px rgba(37,99,235,.13) !important;
            font-weight:700;
        }

        .autocomplete-confirmado{
            position:absolute;
            right:12px;
            top:50%;
            transform:translateY(-50%);
            background:#2563eb;
            color:white;
            border-radius:999px;
            padding:4px 9px;
            font-size:11px;
            font-weight:800;
            pointer-events:none;
            z-index:5;
        }

        .autocomplete-osavulsa-wrap{
            position:relative !important;
        }

        .autocomplete-osavulsa-wrap input.campo-autocomplete-selecionado{
            padding-right:105px !important;
        }
    `;

    document.head.appendChild(style);

    function marcarSelecionado(input){
        if (!input) return;

        input.classList.add("campo-autocomplete-selecionado");

        const wrap = input.closest(".autocomplete-osavulsa-wrap") || input.parentElement;
        if (!wrap) return;

        let selo = wrap.querySelector(".autocomplete-confirmado");

        if (!selo) {
            selo = document.createElement("span");
            selo.className = "autocomplete-confirmado";
            selo.innerText = "Selecionado";
            wrap.appendChild(selo);
        }
    }

    function removerSelecionado(input){
        if (!input) return;

        input.classList.remove("campo-autocomplete-selecionado");

        const wrap = input.closest(".autocomplete-osavulsa-wrap") || input.parentElement;
        const selo = wrap ? wrap.querySelector(".autocomplete-confirmado") : null;

        if (selo) selo.remove();
    }

    function esconderTodasSugestoes(){
        document.querySelectorAll(".autocomplete-osavulsa-box").forEach(box => {
            box.style.display = "none";
        });
    }

    document.addEventListener("click", function(e){
        const item = e.target.closest(".autocomplete-osavulsa-item");

        if (item) {
            const box = item.closest(".autocomplete-osavulsa-box");
            const wrap = item.closest(".autocomplete-osavulsa-wrap");
            const input = wrap ? wrap.querySelector("input") : null;

            setTimeout(() => {
                if (box) box.style.display = "none";
                esconderTodasSugestoes();

                if (input && input.value.trim()) {
                    marcarSelecionado(input);
                }
            }, 80);

            return;
        }

        if (!e.target.closest(".autocomplete-osavulsa-wrap")) {
            esconderTodasSugestoes();
        }
    }, true);

    ["localidade", "tipo_servico"].forEach(id => {
        const input = document.getElementById(id);

        if (!input) return;

        let valorConfirmado = "";

        input.addEventListener("change", () => {
            if (input.value.trim()) {
                valorConfirmado = input.value.trim();
                marcarSelecionado(input);
                esconderTodasSugestoes();
            }
        });

        input.addEventListener("input", () => {
            if (input.value.trim() !== valorConfirmado) {
                removerSelecionado(input);
            }
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                esconderTodasSugestoes();
                input.blur();
            }
        });

        setTimeout(() => {
            if (input.value.trim()) {
                valorConfirmado = input.value.trim();
                marcarSelecionado(input);
            }
        }, 700);
    });

})();

(function patchEditarReciclarOSAvulsa(){

    if (window.__patchEditarReciclarOSAvulsaAplicado) return;
    window.__patchEditarReciclarOSAvulsaAplicado = true;

    function getParam(nome) {
        return new URLSearchParams(window.location.search).get(nome);
    }

    function esconderSugestoes() {
        document.querySelectorAll(".autocomplete-osavulsa-box").forEach(box => {
            box.style.display = "none";
        });
    }

    function marcarCampoConfirmado(input) {
        if (!input || !input.value.trim()) return;

        input.classList.add("campo-autocomplete-selecionado");

        const wrap =
            input.closest(".autocomplete-osavulsa-wrap") ||
            input.parentElement;

        if (!wrap) return;

        let selo = wrap.querySelector(".autocomplete-confirmado");

        if (!selo) {
            selo = document.createElement("span");
            selo.className = "autocomplete-confirmado";
            selo.innerText = "Selecionado";
            wrap.appendChild(selo);
        }
    }

    function aplicarVisualConfirmado() {
        ["localidade", "tipo_servico"].forEach(id => {
            const input = document.getElementById(id);

            if (input && input.value.trim()) {
                marcarCampoConfirmado(input);
            }
        });

        esconderSugestoes();
    }

    function aplicarStatusReciclar() {
        const reciclar = getParam("reciclar");

        if (reciclar !== "1") return;

        const status = document.getElementById("status");

        if (status) {
            status.value = "em_aberto";
            status.dispatchEvent(new Event("change", { bubbles:true }));
        }

        const btnSalvar = document.getElementById("btnSalvar");

        if (btnSalvar) {
            btnSalvar.innerText = "Reciclar OS Avulsa";
        }

        const titulo = document.querySelector(".header-title");
        if (titulo) titulo.innerText = "Reciclar OS Avulsa";

        const pageTitle = document.querySelector(".page-title h2");
        if (pageTitle) pageTitle.innerText = "Reciclar OS Avulsa";
    }

    // Bloqueia popup automático logo após carregar edição/reciclagem.
    function bloquearPopupInicial() {
        const id = getParam("id");

        if (!id) return;

        esconderSugestoes();

        let bloqueado = true;

        setTimeout(() => {
            bloqueado = false;
        }, 1400);

        ["localidade", "tipo_servico"].forEach(campoId => {
            const input = document.getElementById(campoId);

            if (!input) return;

            input.addEventListener("focus", () => {
                if (bloqueado) {
                    esconderSugestoes();
                }
            }, true);

            input.addEventListener("input", () => {
                bloqueado = false;
            }, true);
        });

        const observer = new MutationObserver(() => {
            if (bloqueado) {
                esconderSugestoes();
            }
        });

        observer.observe(document.body, {
            childList:true,
            subtree:true,
            attributes:true,
            attributeFilter:["style", "class"]
        });

        setTimeout(() => {
            observer.disconnect();
            esconderSugestoes();
        }, 1600);
    }

    function aplicarDepoisDaEdicaoCarregar() {
        let tentativas = 0;

        const timer = setInterval(() => {
            tentativas++;

            aplicarStatusReciclar();
            aplicarVisualConfirmado();
            esconderSugestoes();

            const localidade = document.getElementById("localidade");
            const tipo = document.getElementById("tipo_servico");

            const carregouCampos =
                (localidade && localidade.value.trim()) ||
                (tipo && tipo.value.trim()) ||
                tentativas >= 20;

            if (carregouCampos) {
                clearInterval(timer);

                setTimeout(() => {
                    aplicarStatusReciclar();
                    aplicarVisualConfirmado();
                    esconderSugestoes();
                }, 300);
            }

        }, 150);
    }

    // Corrige o envio do modo reciclar: salva como em_aberto.
    function garantirSubmitReciclarEmAberto() {
        const reciclar = getParam("reciclar");

        if (reciclar !== "1") return;

        const btnSalvar = document.getElementById("btnSalvar");
        const status = document.getElementById("status");

        if (!btnSalvar || !status) return;

        btnSalvar.addEventListener("click", () => {
            status.value = "em_aberto";
            status.dispatchEvent(new Event("change", { bubbles:true }));
        }, true);
    }

    window.addEventListener("DOMContentLoaded", () => {
        bloquearPopupInicial();

        setTimeout(() => {
            aplicarDepoisDaEdicaoCarregar();
            garantirSubmitReciclarEmAberto();
        }, 250);
    });

})();




// =====================================================
// INIT
// =====================================================
window.addEventListener("DOMContentLoaded", () => {
    configurarAutocompleteOSAvulsa(
        "localidade",
        "listaLocalidadesOSAvulsa",
        "/api/os-avulsas/opcoes/localidades"
    );

    configurarAutocompleteOSAvulsa(
        "tipo_servico",
        "listaTiposServicosOSAvulsa",
        "/api/os-avulsas/sugestoes/tipos-servicos"
    );

    carregarEdicaoOSAvulsa();

    setTimeout(aplicarPatchSalvarEdicaoOSAvulsa, 500);
});
