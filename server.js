const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
        if (err) { res.writeHead(500); res.end('Erro'); } 
        else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(content); }
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

function criarBotPertoDe(centerX, centerY, idNome) {
    // Faz o bot nascer no máximo a 400 pixels de distância do jogador real para vê-lo na hora
    const offsetX = (Math.random() - 0.5) * 600;
    const offsetY = (Math.random() - 0.5) * 600;
    
    gameState.players[idNome] = {
        id: idNome,
        x: Math.max(100, Math.min(2900, centerX + offsetX)),
        y: Math.max(100, Math.min(2900, centerY + offsetY)),
        dx: 12, // Velocidade compensada para o loop de 100ms
        dy: 0,
        color: CORES[Math.floor(Math.random() * CORES.length)],
        trail: [],
        alive: true,
        isBot: true,
        balance: 0
    };
}

wss.on('connection', (ws) => {
    const playerId = gerarId();
    
    // Posição central do mapa para o jogador
    const spawnX = Math.floor(Math.random() * 1000) + 1000;
    const spawnY = Math.floor(Math.random() * 1000) + 1000;

    gameState.players[playerId] = {
        id: playerId,
        x: spawnX,
        y: spawnY,
        dx: 0,
        dy: 0,
        color: '#00ffcc',
        trail: [],
        alive: true,
        isBot: false,
        balance: 50.00
    };

    gameState.pot += 2.00;

    // Força a criação de 3 bots ao redor do jogador imediatamente
    criarBotPertoDe(spawnX, spawnY, `BOT_Mestre_${playerId}`);
    criarBotPertoDe(spawnX, spawnY, `BOT_Alvo_${playerId}`);
    criarBotPertoDe(spawnX, spawnY, `BOT_Veloz_${playerId}`);

    ws.send(JSON.stringify({ type: 'init', id: playerId, balance: gameState.players[playerId].balance }));

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'move' && gameState.players[playerId]?.alive) {
                // Multiplicador ajustado para manter velocidade estável a 100ms
                gameState.players[playerId].dx = data.dx * 13;
                gameState.players[playerId].dy = data.dy * 13;
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => { 
        delete gameState.players[playerId];
        delete gameState.players[`BOT_Mestre_${playerId}`];
        delete gameState.players[`BOT_Alvo_${playerId}`];
        delete gameState.players[`BOT_Veloz_${playerId}`];
    });
});

// OTIMIZAÇÃO: Roda a física a cada 100ms poupando banda do Render
setInterval(() => {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;

        // Comportamento do Bot refinado para mudar de rumo
        if (player.isBot && Math.random() < 0.08) {
            const angulo = Math.random() * Math.PI * 2;
            player.dx = Math.cos(angulo) * 11;
            player.dy = Math.sin(angulo) * 11;
        }

        if (player.dx !== 0 || player.dy !== 0) {
            player.trail.push({ x: player.x, y: player.y });
            if (player.trail.length > 150) player.trail.shift();
        }

        player.x += player.dx;
        player.y += player.dy;

        // Barreiras do mapa
        if (player.x < 30) { player.x = 30; if(player.isBot) player.dx *= -1; }
        if (player.x > gameState.mapSize - 30) { player.x = gameState.mapSize - 30; if(player.isBot) player.dx *= -1; }
        if (player.y < 30) { player.y = 30; if(player.isBot) player.dy *= -1; }
        if (player.y > gameState.mapSize - 30) { player.y = gameState.mapSize - 30; if(player.isBot) player.dy *= -1; }
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'update', gameState: gameState }));
        }
    });
}, 100);

server.listen(PORT, () => { console.log(`🚀 Servidor Leve e Otimizado ativo na porta ${PORT}`); });
