(function(){
'use strict';
const $=id=>document.getElementById(id);
let empresas=[];
let empresaSelecionada=null;
let cobrancaEditando=null;

function usuarioAtual(){try{return JSON.parse(localStorage.getItem('usuario'))}catch{return null}}
function empresaIdUsuario(u){return Number(u?.empresa_id??u?.empresaId??u?.id_empresa??0)}
if(empresaIdUsuario(usuarioAtual())!==1){alert('Acesso exclusivo da empresa administradora.');location.replace('/painel.html');return}

const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const moeda=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dataBR=v=>{if(!v)return '-';const [a,m,d]=String(v).slice(0,10).split('-');return a&&m&&d?`${d}/${m}/${a}`:v};
function nomeEmpresa(e){return e.nome_fantasia||e.nome_provedor||e.razao_social||e.nome_completo||`Empresa ${e.id}`}
function documento(e){return e.cnpj||e.cpf||'-'}
function badge(status){const s=String(status||'PENDENTE').toUpperCase();const cls=s==='PAGO'?'badge-ok':s==='VENCIDO'?'badge-vencido':s==='REMOVIDO'?'badge-removido':'badge-pendente';return `<span class="badge ${cls}">${esc(s)}</span>`}

async function api(url,opt){return fetchAuth(url,opt)}

async function carregarConfig(){try{const r=await api('/api/asaas/configuracao');$('statusConfig').textContent=r.configurado?`Asaas ${String(r.ambiente).toUpperCase()} configurado`:`Asaas não configurado: ${r.erro}`;$('statusConfig').style.color=r.configurado?'#15803d':'#b91c1c'}catch(e){$('statusConfig').textContent='Erro ao verificar Asaas';$('statusConfig').style.color='#b91c1c'}}

function filtrar(){const q=$('busca').value.toLowerCase().trim();const f=$('filtroIntegracao').value;const lista=empresas.filter(e=>{const texto=[nomeEmpresa(e),e.cnpj,e.cpf,e.subdominio,e.email,e.telefone].join(' ').toLowerCase();const okQ=!q||texto.includes(q);const integrada=!!e.asaas_customer_id;const okF=!f||(f==='integrada'?integrada:!integrada);return okQ&&okF});renderEmpresas(lista)}

function renderEmpresas(lista){const b=$('empresasBody');if(!lista.length){b.innerHTML='<tr><td colspan="7" class="empty">Nenhuma empresa encontrada.</td></tr>';return}b.innerHTML=lista.map(e=>`<tr>
<td><strong>${esc(nomeEmpresa(e))}</strong><div class="muted">ID ${Number(e.id)} • ${esc(e.subdominio||'sem subdomínio')}</div></td>
<td>${esc(documento(e))}</td><td>${esc(e.telefone||'-')}<div class="muted">${esc(e.email||'-')}</div></td>
<td>${esc(e.plano_empresa||'-')}<div class="muted">Vencimento dia ${esc(e.vencimento||'-')}</div></td>
<td>${e.asaas_customer_id?`<span class="badge badge-ok">Integrada</span><div class="muted">${esc(e.asaas_customer_id)}</div>`:'<span class="badge badge-pendente">Não integrada</span>'}</td>
<td>${Number(e.total_cobrancas||0)}<div class="muted">${Number(e.cobrancas_pagas||0)} pagas • ${Number(e.cobrancas_vencidas||0)} vencidas</div></td>
<td><div class="actions"><button class="btn btn-success" data-action="sincronizar" data-id="${Number(e.id)}">Sincronizar</button><button class="btn btn-primary" data-action="abrir" data-id="${Number(e.id)}">Cobranças</button></div></td></tr>`).join('')}

async function carregarEmpresas(){try{empresas=await api('/api/asaas/empresas');if(!Array.isArray(empresas))empresas=[];filtrar();const inicial=Number(new URLSearchParams(location.search).get('empresa_id')||0);if(inicial&&!empresaSelecionada&&empresas.some(e=>Number(e.id)===inicial))await abrirCobrancas(inicial)}catch(e){console.error(e);alert(e.message||'Erro ao carregar empresas')}}

async function sincronizar(id){const btn=document.querySelector(`[data-action="sincronizar"][data-id="${id}"]`);if(btn){btn.disabled=true;btn.textContent='Sincronizando...'}try{await api(`/api/asaas/empresas/${id}/sincronizar`,{method:'POST'});alert('Empresa sincronizada com o Asaas.');await carregarEmpresas()}catch(e){console.error(e);alert(e.message||'Erro ao sincronizar empresa')}finally{if(btn){btn.disabled=false;btn.textContent='Sincronizar'}}}

async function abrirCobrancas(id){empresaSelecionada=empresas.find(e=>Number(e.id)===Number(id));if(!empresaSelecionada)return;$('secaoCobrancas').style.display='block';$('tituloCobrancas').textContent=`Cobranças — ${nomeEmpresa(empresaSelecionada)}`;await carregarCobrancas();$('secaoCobrancas').scrollIntoView({behavior:'smooth',block:'start'})}

async function carregarCobrancas(){try{const lista=await api(`/api/asaas/cobrancas?empresa_id=${empresaSelecionada.id}`);renderCobrancas(Array.isArray(lista)?lista:[])}catch(e){console.error(e);alert(e.message||'Erro ao carregar cobranças')}}

function renderCobrancas(lista){const b=$('cobrancasBody');if(!lista.length){b.innerHTML='<tr><td colspan="6" class="empty">Nenhuma cobrança emitida para esta empresa.</td></tr>';return}b.innerHTML=lista.map(c=>`<tr><td>${esc(c.competencia||'-')}</td><td>${esc(c.descricao||'-')}</td><td>${moeda(c.valor)}</td><td>${dataBR(c.vencimento)}</td><td>${badge(c.status_interno)}</td><td><div class="actions">
${c.invoice_url?`<a class="btn btn-light" href="${esc(c.invoice_url)}" target="_blank" rel="noopener">Abrir</a>`:''}
${c.bank_slip_url?`<a class="btn btn-light" href="${esc(c.bank_slip_url)}" target="_blank" rel="noopener">Boleto</a>`:''}
<button class="btn btn-success" data-caction="sync" data-id="${Number(c.id)}">Atualizar</button>
${String(c.status_interno).toUpperCase()!=='REMOVIDO'?`<button class="btn btn-warning" data-caction="edit" data-json="${encodeURIComponent(JSON.stringify(c))}">Editar</button><button class="btn btn-danger" data-caction="delete" data-id="${Number(c.id)}">Remover</button>`:''}
</div></td></tr>`).join('')}

function abrirModal(c=null){cobrancaEditando=c;$('modalTitulo').textContent=c?'Editar cobrança':'Emitir boleto';$('btnSalvarCobranca').textContent=c?'Salvar alterações':'Emitir boleto';$('competencia').value=c?.competencia?.slice(0,7)||new Date().toISOString().slice(0,7);$('valor').value=c?.valor||'';$('vencimento').value=c?.vencimento?.slice(0,10)||'';$('descricao').value=c?.descricao||`Mensalidade SGOS - ${$('competencia').value}`;$('competencia').disabled=!!c;$('modalCobranca').classList.add('open')}
function fecharModal(){$('modalCobranca').classList.remove('open');cobrancaEditando=null}

async function salvarCobranca(){const payload={empresa_id:empresaSelecionada.id,competencia:$('competencia').value,valor:Number($('valor').value),vencimento:$('vencimento').value,descricao:$('descricao').value.trim()};if(!payload.valor||!payload.vencimento)return alert('Informe valor e vencimento.');const btn=$('btnSalvarCobranca');const editando=!!cobrancaEditando;btn.disabled=true;try{if(editando){await api(`/api/asaas/cobrancas/${cobrancaEditando.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})}else{await api('/api/asaas/cobrancas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})}fecharModal();await carregarCobrancas();await carregarEmpresas();alert(editando?'Cobrança atualizada.':'Boleto emitido com sucesso.')}catch(e){console.error(e);alert(e.message||'Erro ao salvar cobrança')}finally{btn.disabled=false}}

async function sincronizarCobranca(id){
  const btn=document.querySelector(`[data-caction="sync"][data-id="${id}"]`);
  const textoOriginal=btn?.textContent||'Atualizar';
  if(btn){btn.disabled=true;btn.textContent='Atualizando...'}
  try{
    const resultado=await api(`/api/asaas/cobrancas/${id}/sincronizar`);
    await carregarCobrancas();
    await carregarEmpresas();
    const status=String(resultado?.status_interno||resultado?.cobranca?.status||'').toUpperCase();
    if(status==='PAGO'||status==='RECEIVED'||status==='CONFIRMED'){
      alert('Pagamento identificado e cobrança atualizada como paga.');
    }else{
      alert(`Cobrança atualizada. Status: ${status||'não informado'}.`);
    }
  }catch(e){
    console.error(e);
    alert(e.message||'Erro ao atualizar cobrança');
  }finally{
    if(btn){btn.disabled=false;btn.textContent=textoOriginal}
  }
}
async function removerCobranca(id){const motivo=prompt('Informe o motivo da remoção do boleto:');if(motivo===null)return;if(!motivo.trim())return alert('O motivo é obrigatório.');if(!confirm('Confirma a remoção desta cobrança no Asaas?'))return;try{await api(`/api/asaas/cobrancas/${id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({motivo})});await carregarCobrancas();await carregarEmpresas()}catch(e){console.error(e);alert(e.message||'Erro ao remover cobrança')}}

$('empresasBody').addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b)return;b.dataset.action==='sincronizar'?sincronizar(b.dataset.id):abrirCobrancas(b.dataset.id)});
$('cobrancasBody').addEventListener('click',e=>{const b=e.target.closest('button[data-caction]');if(!b)return;const a=b.dataset.caction;if(a==='sync')sincronizarCobranca(b.dataset.id);if(a==='delete')removerCobranca(b.dataset.id);if(a==='edit')abrirModal(JSON.parse(decodeURIComponent(b.dataset.json)))});
$('busca').addEventListener('input',filtrar);$('filtroIntegracao').addEventListener('change',filtrar);$('btnNovaCobranca').addEventListener('click',()=>abrirModal());$('btnFecharModal').addEventListener('click',fecharModal);$('btnCancelarModal').addEventListener('click',fecharModal);$('btnSalvarCobranca').addEventListener('click',salvarCobranca);$('modalCobranca').addEventListener('click',e=>{if(e.target===$('modalCobranca'))fecharModal()});
Promise.all([carregarConfig(),carregarEmpresas()]);
})();
