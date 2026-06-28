const path = require("path");
const fs = require("fs");

let adminInstance = null;

function iniciarFirebase(){
    if(adminInstance){
        return adminInstance;
    }

    let admin;

    try {
        admin = require("firebase-admin");
    } catch(err){
        console.warn("⚠️ firebase-admin não instalado. Rode: npm install firebase-admin");
        return null;
    }

    try {
        const servicePath =
            process.env.FIREBASE_SERVICE_ACCOUNT ||
            path.join(process.cwd(), "firebase-service-account.json");

        if(!fs.existsSync(servicePath)){
            console.warn("⚠️ firebase-service-account.json não encontrado. Push FCM não será enviado ainda.");
            return null;
        }

        const serviceAccount = JSON.parse(
            fs.readFileSync(servicePath, "utf8")
        );

        if(!serviceAccount.private_key || !serviceAccount.client_email){
            console.warn("⚠️ firebase-service-account.json inválido. Gere a chave em Firebase > Configurações do projeto > Contas de serviço.");
            return null;
        }

        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");

        try {
            admin.app();
        } catch {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }

        adminInstance = admin;
        console.log("✅ Firebase Admin inicializado");
        return adminInstance;

    } catch(err){
        console.warn("⚠️ Firebase Admin não inicializado:", err.message);
        return null;
    }
}

module.exports = iniciarFirebase;
