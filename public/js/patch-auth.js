/*
  ADICIONE AO SEU auth.js, aproveitando o ping que já acontece no SGOS.
  Assim cada usuário envia atividade e permanece online enquanto estiver usando o sistema.
*/

async function enviarPingPresenca() {
  try {
    await fetch('/api/admin/usuarios-online/ping', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (erro) {
    console.warn('Falha ao atualizar presença:', erro);
  }
}

// Executa imediatamente e depois a cada 60 segundos.
// O servidor considera offline após 5 minutos sem atividade/ping.
enviarPingPresenca();
setInterval(enviarPingPresenca, 60000);

/*
  No logout manual, antes de destruir a sessão, chame:

  await fetch('/api/admin/usuarios-online/logout', {
    method: 'POST',
    credentials: 'include'
  });
*/
