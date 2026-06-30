const path = require("path");
const fs = require("fs");

let firebaseInstance = null;

function iniciarFirebase() {
    if (firebaseInstance) {
        return firebaseInstance;
    }

    let initializeApp, cert, getApps, getMessaging;

    try {
        ({ initializeApp, cert, getApps } = require("firebase-admin/app"));
        ({ getMessaging } = require("firebase-admin/messaging"));
    } catch (err) {
        console.warn("⚠️ Firebase Admin SDK não instalado.");
        console.warn("Execute: npm install firebase-admin");
        return null;
    }

    try {
        const servicePath =
            process.env.FIREBASE_SERVICE_ACCOUNT ||
            path.join(process.cwd(), "firebase-service-account.json");

        if (!fs.existsSync(servicePath)) {
            console.warn("⚠️ firebase-service-account.json não encontrado.");
            return null;
        }

        const serviceAccount = JSON.parse(
            fs.readFileSync(servicePath, "utf8")
        );

        if (!serviceAccount.private_key || !serviceAccount.client_email) {
            console.warn("⚠️ firebase-service-account.json inválido.");
            return null;
        }

        serviceAccount.private_key =
            serviceAccount.private_key.replace(/\\n/g, "\n");

        if (!getApps().length) {
            initializeApp({
                credential: cert(serviceAccount)
            });

            console.log("✅ Firebase Admin inicializado");
        }

        const messaging = getMessaging();

        // Compatibilidade com código antigo:
        // permite usar admin.messaging().send(...)
        firebaseInstance = {
            messaging: () => messaging,
            getMessaging: () => messaging
        };

        return firebaseInstance;

    } catch (err) {
        console.warn("⚠️ Firebase Admin não inicializado:", err.message);
        return null;
    }
}

module.exports = iniciarFirebase;
