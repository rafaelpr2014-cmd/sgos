(() => {
    "use strict";

    const PAGINAS_ADMIN = new Set([
        "financeiro.html",
        "estoque.html",
        "relatorios.html",
        "informativos-ia.html",
        "informativos_ia.html",
        "integracoes.html",
        "whatsapp-cliente.html"
    ]);

    const PAGINAS_SOMENTE_LEITURA = new Set([
        "usuarios.html",
        "planos.html",
        "escritorios.html",
        "localidades.html",
        "tecnicos.html",
        "tipos_servicos.html",
        "tipos-servicos.html",
        "svas.html",
        "whatsapp.html",
        "logs_acesso.html",
        "logs-acoes.html",
        "logs_acoes.html",
        "historico-os.html"
    ]);

    const LINKS_ADMIN = [
        "financeiro.html",
        "estoque.html",
        "relatorios.html",
        "informativos-ia.html",
        "informativos_ia.html",
        "integracoes.html",
        "whatsapp-cliente.html"
    ];

    function normalizarCargo(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim()
            .toLowerCase();
    }

    function paginaAtual() {
        return decodeURIComponent(location.pathname.split("/").pop() || "painel.html")
            .toLowerCase();
    }

    function usuarioLocal() {
        try {
            return JSON.parse(localStorage.getItem("usuario") || "{}");
        } catch {
            return {};
        }
    }

    function headersAutenticacao() {
        const usuario = usuarioLocal();
        const logId = localStorage.getItem("log_id") || "";
        return {
            "x-usuario-id": usuario.id || "",
            "x-log-id": logId,
            "x-sgos-active": "1"
        };
    }

    async function carregarUsuario() {
        const local = usuarioLocal();
        try {
            const resposta = await fetch("/api/me", {
                headers: headersAutenticacao(),
                cache: "no-store"
            });
            if (resposta.ok) return await resposta.json();
        } catch (erro) {
            console.error("Falha ao consultar permissões:", erro);
        }
        return local;
    }

    function removerLinksAdministrativos() {
        document.querySelectorAll("a[href]").forEach(link => {
            const href = String(link.getAttribute("href") || "")
                .split("?")[0]
                .split("#")[0]
                .toLowerCase();
            if (LINKS_ADMIN.some(pagina => href.endsWith(pagina))) {
                link.remove();
            }
        });
    }

    function avisoNaoAutorizado() {
        document.documentElement.style.visibility = "visible";
        document.body.innerHTML = `
            <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f7fb;font-family:Arial,sans-serif;padding:24px">
                <section style="width:min(520px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:32px;text-align:center;box-shadow:0 20px 50px rgba(15,23,42,.12)">
                    <div style="width:64px;height:64px;margin:0 auto 18px;border-radius:18px;background:#fee2e2;color:#dc2626;display:flex;align-items:center;justify-content:center;font-size:32px">⛔</div>
                    <h1 style="margin:0 0 10px;font-size:24px;color:#0f172a">Acesso não autorizado</h1>
                    <p style="margin:0 0 22px;color:#64748b;line-height:1.55">Este módulo é exclusivo para usuários com cargo Administrador.</p>
                    <a href="/painel.html" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:800">Voltar ao painel</a>
                </section>
            </main>`;
    }

    function textoElemento(el) {
        return String(el.textContent || el.value || el.title || el.getAttribute("aria-label") || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim()
            .toLowerCase();
    }

    function tornarSomenteLeitura() {
        document.body.classList.add("sgos-somente-leitura");

        const palavrasAcao = [
            "novo", "cadastrar", "salvar", "editar", "excluir", "remover",
            "ativar", "inativar", "resetar", "alterar", "configurar", "conectar",
            "desconectar", "sincronizar", "adicionar", "criar"
        ];

        const onclickAcao = [
            "salvar", "editar", "excluir", "remover", "toggle", "resetar",
            "cadastrar", "novo", "adicionar", "configurar", "ativar", "desativar"
        ];

        document.querySelectorAll("button, a.btn, input[type='submit'], input[type='button']")
            .forEach(el => {
                const texto = textoElemento(el);
                const onclick = String(el.getAttribute("onclick") || "").toLowerCase();
                const classe = String(el.className || "").toLowerCase();

                const mutacao = palavrasAcao.some(p => texto.includes(p)) ||
                    onclickAcao.some(p => onclick.includes(p)) ||
                    /btn-(danger|warning|editar|excluir|salvar)|action-card/.test(classe);

                if (mutacao) el.style.display = "none";
            });

        // Oculta os cartões/formulários de cadastro e edição, preservando busca e filtros.
        document.querySelectorAll(".card, .page-card, form, section").forEach(bloco => {
            const titulo = textoElemento(bloco.querySelector(".titulo-card, h1, h2, h3, .card-title") || bloco);
            if (/cadastrar|editar usuario|novo usuario|novo plano|nova localidade|novo tecnico|configuracao|credenciais/.test(titulo)) {
                bloco.querySelectorAll("input:not([type='search']), select, textarea").forEach(campo => {
                    campo.disabled = true;
                    campo.setAttribute("aria-disabled", "true");
                });
            }
        });

        // Impede mutações disparadas por formulários que tenham escapado do filtro visual.
        document.addEventListener("submit", evento => {
            evento.preventDefault();
            alert("Acesso somente para visualização. Apenas administradores podem alterar dados.");
        }, true);

        const faixa = document.createElement("div");
        faixa.textContent = "Modo somente leitura — alterações permitidas apenas para administradores";
        faixa.style.cssText = "position:sticky;top:0;z-index:99999;background:#fff7ed;color:#9a3412;border-bottom:1px solid #fed7aa;padding:9px 16px;text-align:center;font:700 12px Arial,sans-serif";
        document.body.prepend(faixa);
    }

    async function iniciar() {
        const usuario = await carregarUsuario();
        const admin = normalizarCargo(usuario?.cargo) === "administrador";
        const pagina = paginaAtual();

        if (!admin) {
            removerLinksAdministrativos();

            if (PAGINAS_ADMIN.has(pagina)) {
                avisoNaoAutorizado();
                return;
            }

            if (PAGINAS_SOMENTE_LEITURA.has(pagina)) {
                tornarSomenteLeitura();
            }
        }

        document.documentElement.style.visibility = "visible";
    }

    document.documentElement.style.visibility = "hidden";
    document.addEventListener("DOMContentLoaded", iniciar, { once: true });
})();
