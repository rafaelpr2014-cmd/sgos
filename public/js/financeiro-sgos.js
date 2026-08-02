(function(){
'use strict';

const $=id=>document.getElementById(id);
const moeda=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const data=v=>v?new Date(String(v).slice(0,10)+'T00:00:00').toLocaleDateString('pt-BR'):'-';
const dataHora=v=>v?new Date(v).toLocaleString('pt-BR'):'-';
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let resumo={};

function usuarioAtual(){try{return JSON.parse(localStorage.getItem('usuario'))}catch{return null}}
function normalizar(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()}
const usuario=usuarioAtual();
if(Number(usuario?.empresa_id)!==1||normalizar(usuario?.cargo)!=='administrador'){
  alert('Acesso exclusivo para administradores da empresa 1.');
  location.replace('/painel.html');
  return;
}

async function api(url){return fetchAuth(url)}

function mesAtual(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function periodoLabel(mes){
  const [ano,m]=mes.split('-').map(Number);
  return new Date(ano,m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
}

function statusBadge(status){
  const s=String(status||'PENDENTE').toUpperCase();
  const cls=s==='PAGO'?'pago':s==='VENCIDO'?'vencido':s==='REMOVIDO'?'removido':'pendente';
  return `<span class="pill ${cls}">${esc(s)}</span>`;
}

function documentos(c){
  const links=[];
  if(c.invoice_url)links.push(`<a class="link" href="${esc(c.invoice_url)}" target="_blank" rel="noopener">Fatura</a>`);
  if(c.bank_slip_url)links.push(`<a class="link" href="${esc(c.bank_slip_url)}" target="_blank" rel="noopener">Boleto</a>`);
  return links.length?`<div class="actions">${links.join('')}</div>`:'-';
}

async function carregarResumo(){
  const mes=$('mes').value;
  resumo=await api(`/api/financeiro-sgos/resumo?mes=${encodeURIComponent(mes)}`);
  $('periodo').textContent=`Exibindo ${periodoLabel(mes)}`;
  $('recebido').textContent=moeda(resumo.total_entradas_pagamentos);
  $('entradas').textContent=`${Number(resumo.entradas_pagamentos||0)} pagamentos`;
  $('gerados').textContent=Number(resumo.boletos_gerados||0);
  $('valorGerado').textContent=`${moeda(resumo.valor_gerado)} emitidos`;
  $('aberto').textContent=moeda(resumo.valor_em_aberto);
  $('pendentes').textContent=`${Number(resumo.boletos_pendentes||0)} pendentes`;
  $('vencidos').textContent=Number(resumo.boletos_vencidos||0);
  $('empresas').textContent=Number(resumo.empresas_cobradas||0);
  $('pagos').textContent=Number(resumo.boletos_pagos||0);
  $('statusPago').textContent=Number(resumo.boletos_pagos||0);
  $('statusPendente').textContent=Number(resumo.boletos_pendentes||0);
  $('statusVencido').textContent=Number(resumo.boletos_vencidos||0);
  $('statusRemovido').textContent=Number(resumo.boletos_removidos||0);
}

async function carregarGrafico(){
  const mes=$('mes').value;
  const r=await api(`/api/financeiro-sgos/grafico?mes=${encodeURIComponent(mes)}`);
  const [ano,m]=mes.split('-').map(Number);
  const ultimo=new Date(ano,m,0).getDate();
  const mapa={};
  for(const item of r.dados||[])mapa[String(item.dia).slice(0,10)]=Number(item.total||0);
  const dados=[];
  for(let dia=1;dia<=ultimo;dia++){
    const chave=`${mes}-${String(dia).padStart(2,'0')}`;
    dados.push({dia,valor:mapa[chave]||0,data:chave});
  }
  const max=Math.max(...dados.map(x=>x.valor),0);
  const total=dados.reduce((s,x)=>s+x.valor,0);
  $('totalGrafico').textContent=moeda(total);
  $('grafico').innerHTML=`<div class="chart">${dados.map(x=>{
    const altura=max?Math.max(2,(x.valor/max)*265):2;
    return `<div class="chart-col"><div class="chart-bar" style="height:${altura}px" data-dia="${data(x.data)}" data-valor="${moeda(x.valor)}"></div><div class="chart-day">${String(x.dia).padStart(2,'0')}</div></div>`;
  }).join('')}</div>`;
  const tip=$('tooltip');
  document.querySelectorAll('.chart-bar').forEach(bar=>{
    bar.onmousemove=e=>{
      tip.innerHTML=`<b>${bar.dataset.dia}</b><br>${bar.dataset.valor}`;
      tip.style.display='block';
      tip.style.left=(e.clientX+12)+'px';
      tip.style.top=(e.clientY+12)+'px';
    };
    bar.onmouseleave=()=>tip.style.display='none';
  });
}

async function carregarPagamentos(){
  const mes=$('mes').value,busca=$('buscaPagamentos').value.trim();
  const r=await api(`/api/financeiro-sgos/pagamentos?mes=${encodeURIComponent(mes)}&busca=${encodeURIComponent(busca)}`);
  const lista=r.pagamentos||[];
  $('tbPagamentos').innerHTML=lista.length?lista.map(c=>`<tr>
    <td><b>${esc(c.empresa_nome)}</b></td>
    <td>${esc(c.competencia||'-')}<div class="muted">${esc(c.asaas_payment_id||'')}</div></td>
    <td>${esc(c.descricao||'-')}</td>
    <td><b>${moeda(c.valor_pago||c.valor)}</b></td>
    <td>${data(c.vencimento)}</td>
    <td>${dataHora(c.pago_em)}</td>
    <td>${esc(c.status_asaas||'-')}</td>
    <td>${documentos(c)}</td>
  </tr>`).join(''):'<tr><td colspan="8" class="empty">Nenhum pagamento encontrado neste mês.</td></tr>';
}

async function carregarBoletos(){
  const mes=$('mes').value,busca=$('buscaBoletos').value.trim(),status=$('statusBoleto').value;
  const r=await api(`/api/financeiro-sgos/boletos?mes=${encodeURIComponent(mes)}&busca=${encodeURIComponent(busca)}&status=${encodeURIComponent(status)}`);
  const lista=r.boletos||[];
  $('tbBoletos').innerHTML=lista.length?lista.map(c=>`<tr>
    <td><b>${esc(c.empresa_nome)}</b></td>
    <td>${esc(c.competencia||'-')}<div class="muted">${esc(c.asaas_payment_id||'')}</div></td>
    <td>${esc(c.descricao||'-')}</td>
    <td><b>${moeda(c.valor)}</b></td>
    <td>${data(c.vencimento)}</td>
    <td>${statusBadge(c.status_interno)}</td>
    <td>${dataHora(c.criado_em)}</td>
    <td>${documentos(c)}</td>
  </tr>`).join(''):'<tr><td colspan="8" class="empty">Nenhum boleto encontrado neste mês.</td></tr>';
}

function detalheLog(valor){
  if(!valor)return '-';
  try{
    const obj=JSON.parse(valor);
    return esc(Object.entries(obj).map(([k,v])=>`${k}: ${v??'-'}`).join(' | '));
  }catch{return esc(valor)}
}

async function carregarLogs(){
  const mes=$('mes').value,busca=$('buscaLogs').value.trim();
  const r=await api(`/api/financeiro-sgos/logs?mes=${encodeURIComponent(mes)}&busca=${encodeURIComponent(busca)}`);
  const lista=r.logs||[];
  $('tbLogs').innerHTML=lista.length?lista.map(l=>`<tr>
    <td>${dataHora(l.criado_em)}</td>
    <td><b>${esc(l.empresa_nome)}</b></td>
    <td>${esc(String(l.acao||'-').replaceAll('_',' '))}</td>
    <td>${esc(l.usuario_nome||'-')}</td>
    <td>${l.cobranca_id?`#${Number(l.cobranca_id)}<div class="muted">${esc(l.competencia||'')}</div>`:'-'}</td>
    <td>${detalheLog(l.detalhes)}</td>
  </tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum log financeiro encontrado neste mês.</td></tr>';
}

async function carregarTudo(){
  $('atualizar').disabled=true;
  $('atualizar').textContent='Atualizando...';
  try{
    await Promise.all([
      carregarResumo(),
      carregarGrafico(),
      carregarPagamentos(),
      carregarBoletos(),
      carregarLogs()
    ]);
  }catch(e){
    console.error(e);
    alert(e.message||'Erro ao carregar o financeiro SGOS.');
  }finally{
    $('atualizar').disabled=false;
    $('atualizar').textContent='Atualizar dados';
  }
}

document.querySelectorAll('.tabs button').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
  };
});

let timer;
function debounce(fn){clearTimeout(timer);timer=setTimeout(fn,350)}
$('buscaPagamentos').oninput=()=>debounce(carregarPagamentos);
$('buscaBoletos').oninput=()=>debounce(carregarBoletos);
$('statusBoleto').onchange=carregarBoletos;
$('buscaLogs').oninput=()=>debounce(carregarLogs);
$('mes').value=mesAtual();
$('mes').onchange=carregarTudo;
$('atualizar').onclick=carregarTudo;
carregarTudo();
})();
