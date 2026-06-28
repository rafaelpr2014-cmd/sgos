import { PushNotifications } from '@capacitor/push-notifications';

export async function iniciarPush() {

    const perm = await PushNotifications.requestPermissions();

    if (perm.receive !== 'granted') {
        console.log('Permissão negada');
        return;
    }

    await PushNotifications.register();

    PushNotifications.addListener(
        'registration',
        token => {

            console.log(
                'TOKEN FCM:',
                token.value
            );

        }
    );

    PushNotifications.addListener(
        'registrationError',
        err => {

            console.error(
                'ERRO FCM:',
                err
            );

        }
    );
}