(function(){
  const esc=v=>String(v??'-').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const moeda=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const forma=v=>({dinheiro:'Dinheiro',pix:'PIX',cartao_credito:'Cartão de crédito',cartao_debito:'Cartão de débito',cheque:'Cheque'}[v]||v||'-');
  const statusPagamento=v=>v==='pago'?'Pago':v==='pendente'?'Pendente':'-';
  async function requisicao(url){
    if(typeof window.apiFetch==='function') return window.apiFetch(url);
    const usuario=JSON.parse(localStorage.getItem('usuario')||'{}');
    const r=await fetch(url,{headers:{'x-usuario-id':usuario.id||'',Accept:'application/json'}});
    if(!r.ok) throw new Error((await r.json().catch(()=>({}))).erro||'Erro ao carregar OS.');
    return r.json();
  }
  function garantir(){
    if(document.getElementById('modalOSCompartilhado'))return;
    const st=document.createElement('style');st.textContent=`
    .os-link{color:#2563eb;text-decoration:underline;font-weight:800;cursor:pointer}.os-modal{display:none;position:fixed;inset:0;background:rgba(15,23,42,.68);z-index:99999;padding:20px;align-items:center;justify-content:center}.os-modal.on{display:flex}.os-box{width:min(980px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 30px 80px rgba(15,23,42,.35)}.os-head{display:flex;justify-content:space-between;align-items:flex-start;padding:20px 22px;border-bottom:1px solid #e5e7eb;background:#f8fafc}.os-head h2{margin:0}.os-fechar{border:0;background:#fee2e2;color:#b91c1c;width:36px;height:36px;border-radius:50%;font-size:20px;cursor:pointer}.os-body{padding:22px}.os-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.os-item{border:1px solid #e5e7eb;border-radius:11px;padding:12px;min-width:0}.os-item.full{grid-column:1/-1}.os-item small{display:block;color:#64748b;font-size:11px;font-weight:800;text-transform:uppercase;margin-bottom:5px}.os-item strong,.os-item div{font-size:13px;word-break:break-word}.os-status-pago{color:#15803d}.os-status-pendente{color:#b45309}.os-materiais{width:100%;border-collapse:collapse}.os-materiais th,.os-materiais td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:12px}.os-anexo{display:inline-block;margin-top:5px;color:#2563eb;font-weight:800}@media(max-width:760px){.os-grid{grid-template-columns:1fr}.os-item.full{grid-column:auto}}`;
    document.head.appendChild(st);
    const m=document.createElement('div');m.id='modalOSCompartilhado';m.className='os-modal';m.onclick=e=>{if(e.target===m)m.classList.remove('on')};m.innerHTML='<div class="os-box"><div class="os-head"><div><h2 id="osCompartilhadoTitulo">Resumo da OS</h2><div id="osCompartilhadoSub"></div></div><button class="os-fechar" type="button">×</button></div><div class="os-body" id="osCompartilhadoBody"></div></div>';
    m.querySelector('.os-fechar').onclick=()=>m.classList.remove('on');document.body.appendChild(m);
  }
  window.abrirResumoOSCompartilhado=async function(id){
    garantir();const m=document.getElementById('modalOSCompartilhado'),body=document.getElementById('osCompartilhadoBody');m.classList.add('on');body.innerHTML='Carregando...';
    try{
      const os=await requisicao('/api/ordens_servico/'+Number(id));let mats=os.materiais_os||[];if(typeof mats==='string'){try{mats=JSON.parse(mats)}catch{mats=[]}}
      document.getElementById('osCompartilhadoTitulo').textContent='Resumo da OS #'+os.id;document.getElementById('osCompartilhadoSub').textContent=os.nome||os.cliente_nome||'';
      const tabela=Array.isArray(mats)&&mats.length?`<table class="os-materiais"><thead><tr><th>Produto</th><th>Qtd.</th><th>Unitário</th><th>Desconto</th><th>Total</th></tr></thead><tbody>${mats.map(x=>`<tr><td>${esc(x.nome||x.produto_nome)}</td><td>${esc(x.quantidade)}</td><td>${moeda(x.valor_unitario)}</td><td>${moeda(x.desconto)}</td><td><strong>${moeda(x.valor_total)}</strong></td></tr>`).join('')}</tbody></table>`:'Nenhum material vinculado.';
      const anexo=os.anexo_pagamento_equipamento?`<a class="os-anexo" href="${esc(os.anexo_pagamento_equipamento)}" target="_blank" rel="noopener">Visualizar comprovante</a>`:'Sem comprovante.';
      body.innerHTML=`<div class="os-grid">
      <div class="os-item"><small>Cliente</small><strong>${esc(os.nome||os.cliente_nome)}</strong></div><div class="os-item"><small>Telefone</small><strong>${esc(os.telefone)}</strong></div><div class="os-item"><small>Status da OS</small><strong>${esc(os.status)}</strong></div>
      <div class="os-item"><small>Localidade</small><strong>${esc(os.localidade_nome||os.localidade)}</strong></div><div class="os-item"><small>Plano</small><strong>${esc(os.plano_nome||os.plano)}</strong></div><div class="os-item"><small>Serviço</small><strong>${esc(os.tipo_servico_nome||os.tipo_servico)}</strong></div>
      <div class="os-item full"><small>Descrição inicial</small><div>${esc(os.descricao)}</div></div>
      <div class="os-item"><small>Origem do equipamento</small><strong>${os.origem_equipamento==='empresa'?'Equipamento da empresa':'Equipamento próprio'}</strong></div><div class="os-item"><small>Modalidade</small><strong>${os.modalidade_equipamento==='vendido'?'Vendido':os.modalidade_equipamento==='comodato'?'Comodato':'-'}</strong></div><div class="os-item"><small>Tipo de pagamento</small><strong>${esc(forma(os.forma_pagamento_equipamento))}</strong></div>
      <div class="os-item"><small>Status do pagamento</small><strong class="os-status-${esc(os.status_pagamento_equipamento)}">${statusPagamento(os.status_pagamento_equipamento)}</strong></div><div class="os-item"><small>Subtotal</small><strong>${moeda(os.subtotal_equipamentos)}</strong></div><div class="os-item"><small>Desconto</small><strong>${moeda(os.desconto_equipamentos)}</strong></div>
      <div class="os-item"><small>Valor final</small><strong>${moeda(os.total_equipamentos)}</strong></div><div class="os-item full"><small>Comprovante do pagamento</small>${anexo}</div><div class="os-item full"><small>Equipamentos e materiais</small>${tabela}</div></div>`;
    }catch(e){body.innerHTML='<div style="color:#b91c1c">'+esc(e.message)+'</div>'}
  };
  function transformar(root=document){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(n=>{if(!/OS\s*#?\s*\d+/i.test(n.nodeValue||'')||n.parentElement?.closest('a,button,script,style,.os-modal'))return;const frag=document.createDocumentFragment();let last=0,re=/OS\s*#?\s*(\d+)/ig,m;while((m=re.exec(n.nodeValue))){frag.append(n.nodeValue.slice(last,m.index));const a=document.createElement('a');a.href='#';a.className='os-link';a.textContent=m[0];const osId=Number(m[1]);a.dataset.osId=String(osId);a.onclick=e=>{e.preventDefault();e.stopPropagation();window.abrirResumoOSCompartilhado(osId)};frag.append(a);last=re.lastIndex}frag.append(n.nodeValue.slice(last));n.parentNode.replaceChild(frag,n)});
  }
  document.addEventListener('DOMContentLoaded',()=>{garantir();transformar();new MutationObserver(ms=>ms.forEach(x=>x.addedNodes.forEach(n=>{if(n.nodeType===1)transformar(n)}))).observe(document.body,{childList:true,subtree:true})});
})();
