const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
        if (err) {
            res.writeHead(500); res.end('Erro');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(content);
        }
    });
});

const wss = new WebSocket.Server({ server });

let gameState = {
    players: {},
    pot: 0.00,
    mapSize: 3000
};

const CORES = ['#FF3366', '#33FF66', '#3366FF', '#FFFF33', '#FF33FF', '#00FFFF', '#FF9900'];

function gerarId() {
    return '_' + Math.random().toString(36).substr(2, 9);
}

// 🆕 Função para inicializar um Bot com IA simples
function criarBot(idNome) {
    gameState.players[idNome] = {
        id: idNome,
        x: Math.floor(Math.random() * 2000) + 500,
        y: Math.floor(Math.random() * 2000) + 500,
        dx: 4, // começa andando pra direita
        dy: 0,
        color: CORES[Math.floor(Math.random() * CORES.length)],
        trail: [],
        alive: true,
        isBot: true, // Demarca que é IA
        balance: 0
    };
}

// Adiciona 3 bots automáticos no servidor ao iniciar
criarBot('BOT_Mestre');
criarBot('BOT_Alvo');
criarBot('BOT_Veloz');

wss.on('connection', (ws) => {
    const playerId = gerarId();

    gameState.players[playerId] = {
        id: playerId,
        x: Math.floor(Math.random() * 2000) + 500,
        y: Math.floor(Math.random() * 2000) + 500,
        dx: 0,
        dy: 0,
        color: '#00ffcc', // Cor fixa neon pro jogador real se diferenciar
        trail: [],
        alive: true,
        isBot: false,
        balance: 50.00
    };

    gameState.pot += 2.00;

    ws.send(JSON.stringify({ type: 'init', id: playerId, balance: gameState.players[playerId].balance }));

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'move' && gameState.players[playerId]?.alive) {
                gameState.players[playerId].dx = data.dx * 6;
                gameState.players[playerId].dy = data.dy * 6;
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => { delete gameState.players[playerId]; });
});

// MOTOR DO JOGO + IA DOS BOTS (Roda a cada 45ms)
setInterval(() => {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;

        // 🆕 Lógica de IA do Bot: muda de direção aleatoriamente de vez em quando
        if (player.isBot && Math.random() < 0.04) {
            const anguloAleatorio = Math.random() * Math.PI * 2;
            player.dx = Math.cos(anguloAleatorio) * 5; // Velocidade do Bot
            player.dy = Math.sin(anguloAleatorio) * 5;
        }

        if (player.dx !== 0 || player.dy !== 0) {
            player.trail.push({ x: player.x, y: player.y });
            if (player.trail.length > 200) player.trail.shift();
        }

        player.x += player.dx;
        player.y += player.dy;

        // Limites do mapa
        if (player.x < 25) { player.x = 25; if(player.isBot) player.dx *= -1; }
        if (player.x > gameState.mapSize - 25) { player.x = gameState.mapSize - 25; if(player.isBot) player.dx *= -1; }
        if (player.y < 25) { player.y = 25; if(player.isBot) player.dy *= -1; }
        if (player.y > gameState.mapSize - 25) { player.y = gameState.mapSize - 25; if(player.isBot) player.dy *= -1; }
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'update', gameState: gameState }));
        }
    });
}, 45);

server.listen(PORT, () => { console.log(`🚀 Servidor com Bots ativo na porta ${PORT}`); });
