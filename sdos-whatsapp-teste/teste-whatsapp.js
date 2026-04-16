const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Escaneie o QR code');
});

client.on('ready', async () => {
    console.log('WhatsApp conectado!');

    setTimeout(async () => {
        try {
            const numero = '5573998069552@c.us';

            await client.sendMessage(
                numero,
                '🚀 SDOS TESTE:\nSua OS está EM ROTA!\nTécnico: João\nPrevisão: 14:30'
            );

            console.log('Mensagem enviada com sucesso!');
        } catch (erro) {
            console.log('Erro ao enviar:', erro);
        }
    }, 5000);
});

client.initialize();