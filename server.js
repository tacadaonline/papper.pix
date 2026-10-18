const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Erro ao carregar o arquivo index.html');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        }
    });
});

const wss = new WebSocket.Server({ server });

let gameState = {
    players: {},
    pot: 0.00
};

const CORES = ['#FF3366', '#33FF66', '#3366FF', '#FFFF33', '#FF33FF', '#00FFFF', '#FF9900'];

function gerarId() {
    return '_' + Math.random().toString(36).substr(2, 9);
}

wss.on('connection', (ws) => {
    const playerId = gerarId();

    gameState.players[playerId] = {
        id: playerId,
        x: Math.floor(Math.random() * 600) + 100,
        y: Math.floor(Math.random() * 400) + 100,
        dx: 0,
        dy: 0,
        color: CORES[Math.floor(Math.random() * CORES.length)],
        trail: [],
        alive: true,
        balance: 25.00
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
                // Ajuste refinado de velocidade no servidor para acompanhar o ritmo
                gameState.players[playerId].dx = data.dx * 6;
                gameState.players[playerId].dy = data.dy * 6;
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        delete gameState.players[playerId];
    });
});

// Loop de física do servidor acelerado para 45ms (Sincronismo veloz)
setInterval(() => {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;

        if (player.dx !== 0 || player.dy !== 0) {
            player.trail.push({ x: player.x, y: player.y });
            if (player.trail.length > 80) player.trail.shift();
        }

        player.x += player.dx;
        player.y += player.dy;

        if (player.x < 15) player.x = 15;
        if (player.x > 785) player.x = 785;
        if (player.y < 15) player.y = 15;
        if (player.y > 585) player.y = 585;
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
    console.log(`🚀 Motor de alta performance rodando na porta ${PORT}`);
});
