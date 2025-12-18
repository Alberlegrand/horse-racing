// Test script pour tester le timing de la course

const http = require('http');

const BASE_URL = 'http://localhost:8080';

function makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(body) });
                } catch (e) {
                    resolve({ status: res.statusCode, body: body });
                }
            });
        });

        req.on('error', reject);
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function main() {
    console.log('🚀 Test du timing de la course');
    console.log('================================\n');

    try {
        // 1. Vérifier que le serveur est prêt
        console.log('1️⃣ Vérification du serveur...');
        const getRound = await makeRequest('POST', '/api/v1/rounds/', { action: 'get' });
        console.log('   ✅ Serveur prêt');
        console.log('   Round actuel:', getRound.body?.data?.id);
        console.log('');

        // 2. Déclencher la course
        console.log('2️⃣ Démarrage de la course...');
        console.log('   [TIMESTAMP] ' + new Date().toLocaleTimeString());
        const startTime = Date.now();
        const finish = await makeRequest('POST', '/api/v1/rounds/', { action: 'finish' });
        console.log('   ✅ Commande finish envoyée');
        console.log('');

        // 3. Attendre et afficher les logs
        console.log('3️⃣ Monitoring de la course (35 secondes)...');
        console.log('   Attendez les logs du serveur...');
        console.log('');

        // Attendre la fin de la course
        await new Promise(resolve => setTimeout(resolve, 36000));

    } catch (err) {
        console.error('❌ Erreur:', err.message);
    }
}

main().catch(console.error);
