function carregarMenu() {
    const menuHTML = `
<nav class="menu">
  <a href="painel.html" class="logo-menu">
    <img src="https://i.ibb.co/cjdcT5w/logo-topo-sgos-branco-1.png" alt="Logo Painel">
  </a>

  <input type="text" id="buscaOS" placeholder="🔎 Buscar cliente..." class="input-busca-menu">

  <div class="dropdown">
    <a href="#">📝 Cadastrar ▼</a>
    <div class="dropdown-content">
      <a href="cadastrar_planos.html">Cadastrar Planos</a>
      <a href="cadastrar_localidades.html">Cadastrar Localidades</a>
      <a href="cadastrar_servicos.html">Cadastrar Tipos de Serviços</a>
    </div>
  </div>

  <a href="agendamentos.html">📅 Agendamentos</a>
  <a href="viabilidade.html">📡 Viabilidades</a>
  <a href="relatorios.html"> 📈 Relatórios</a> 
  <a href="cronograma.html"> 👷🏼‍♂️ Cronograma de Serviços</a>
  <a href="inviabilidade.html">❌ Inviabilidades </a>
  <a href="usuarios.html">👤 Usuários</a>
  <a href="#" onclick="modoTV()">📺 Modo TV</a>

  <div class="dropdown" id="userMenu">
    <a id="userEmpresa">Carregando... ▼</a>
    <div class="dropdown-content">
      <div id="usuariosOnline" style="padding:5px 10px; font-size:13px; color:#00ff90;">
        Usuários online: Carregando...
      </div>
      <a href="#" onclick="logout()">🚪 Sair</a>
    </div>
  </div>
</nav>
    `;

    const body = document.body;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = menuHTML;

    body.prepend(wrapper);
}

document.addEventListener("DOMContentLoaded", carregarMenu);