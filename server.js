const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Erro');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
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

wss.on('connection', (ws) => {
    const playerId = gerarId();

    gameState.players[playerId] = {
        id: playerId,
        x: Math.floor(Math.random() * (gameState.mapSize - 400)) + 200,
        y: Math.floor(Math.random() * (gameState.mapSize - 400)) + 200,
        dx: 0,
        dy: 0,
        color: CORES[Math.floor(Math.random() * CORES.length)],
        trail: [],
        alive: true,
        balance: 50.00
    };

    gameState.pot += 2.00;

    ws.send(JSON.stringify({
        type: 'init',
        id: playerId,
        balance: gameState.players[playerId].balance
    }));

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'move' && gameState.players[playerId]?.alive) {
                // 🚀 Aplica velocidade multiplicando diretamente o vetor livre enviado pelo toque do celular
                const velocidadeBase = 6;
                gameState.players[playerId].dx = data.dx * velocidadeBase;
                gameState.players[playerId].dy = data.dy * velocidadeBase;
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        delete gameState.players[playerId];
    });
});

setInterval(() => {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;

        if (player.dx !== 0 || player.dy !== 0) {
            player.trail.push({ x: player.x, y: player.y });
            if (player.trail.length > 250) player.trail.shift();
        }

        player.x += player.dx;
        player.y += player.dy;

        if (player.x < 20) player.x = 20;
        if (player.x > gameState.mapSize - 20) player.x = gameState.mapSize - 20;
        if (player.y < 20) player.y = 20;
        if (player.y > gameState.mapSize - 20) player.y = gameState.mapSize - 20;
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'update',
                gameState: gameState
            }));
        }
    });
}, 45);

server.listen(PORT, () => {
    console.log(`🚀 Motor 360° livre iniciado na porta ${PORT}`);
});
