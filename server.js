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

function criarTerritorioInicial(cx, cy) {
    const r = 80; // Aumentado ligeiramente o tamanho da base inicial para melhor visualização
    return [
        { x: cx - r, y: cy - r },
        { x: cx + r, y: cy - r },
        { x: cx + r, y: cy + r },
        { x: cx - r, y: cy + r }
    ];
}

function estaDentroDoPoligono(ponto, poligono) {
    let x = ponto.x, y = ponto.y;
    let dentro = false;
    for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
        let xi = poligono[i].x, yi = poligono[i].y;
        let xj = poligono[j].x, yj = poligono[j].y;
        let intersecta = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersecta) dentro = !dentro;
    }
    return dentro;
}

function criarBotPertoDe(centerX, centerY, idNome) {
    const offsetX = (Math.random() - 0.5) * 800;
    const offsetY = (Math.random() - 0.5) * 800;
    const bx = Math.max(200, Math.min(2800, centerX + offsetX));
    const by = Math.max(200, Math.min(2800, centerY + offsetY));

    gameState.players[idNome] = {
        id: idNome,
        x: bx,
        y: by,
        dx: 12,
        dy: 0,
        color: CORES[Math.floor(Math.random() * CORES.length)],
        trail: [],
        territory: criarTerritorioInicial(bx, by),
        alive: true,
        isBot: true,
        balance: 0
    };
}

wss.on('connection', (ws) => {
    const playerId = gerarId();
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
        territory: criarTerritorioInicial(spawnX, spawnY),
        alive: true,
        isBot: false,
        balance: 50.00
    };

    gameState.pot += 2.00;

    // Spawna os bots perto
    criarBotPertoDe(spawnX, spawnY, `BOT_1_${playerId}`);
    criarBotPertoDe(spawnX, spawnY, `BOT_2_${playerId}`);

    ws.send(JSON.stringify({ type: 'init', id: playerId, balance: gameState.players[playerId].balance }));

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'move' && gameState.players[playerId]?.alive) {
                gameState.players[playerId].dx = data.dx * 13;
                gameState.players[playerId].dy = data.dy * 13;
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => { 
        delete gameState.players[playerId];
        delete gameState.players[`BOT_1_${playerId}`];
        delete gameState.players[`BOT_2_${playerId}`];
    });
});

setInterval(() => {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;

        if (player.isBot && Math.random() < 0.07) {
            const angulo = Math.random() * Math.PI * 2;
            player.dx = Math.cos(angulo) * 11;
            player.dy = Math.sin(angulo) * 11;
        }

        const emSuaBase = estaDentroDoPoligono({ x: player.x, y: player.y }, player.territory);

        if (!emSuaBase) {
            player.trail.push({ x: player.x, y: player.y });
            if (player.trail.length > 300) player.trail.shift();
        } else if (emSuaBase && player.trail.length > 0) {
            // Unifica o território ao voltar para a base
            player.territory = player.territory.concat(player.trail);
            player.trail = [];
        }

        player.x += player.dx;
        player.y += player.dy;

        if (player.x < 30) { player.x = 30; if(player.isBot) player.dx *= -1; }
        if (player.x > gameState.mapSize - 30) { player.x = gameState.mapSize - 30; if(player.isBot) player.dx *= -1; }
        if (player.y < 30) { player.y = 30; if(player.isBot) player.dy *= -1; }
        if (player.y > gameState.mapSize - 30) { player.y = gameState.mapSize - 30; if(player.isBot) player.dy *= -1; }
    });

    // ⚔️ NOVO SISTEMA DE COLISÕES REFINADO (SEM AUTODESTRUIÇÃO IMEDIATA)
    Object.values(gameState.players).forEach(p1 => {
        if (!p1.alive) return;

        Object.values(gameState.players).forEach(p2 => {
            if (!p2.alive || p2.trail.length < 2) return;

            // Percorre a trilha de p2 ponto por ponto
            for (let i = 0; i < p2.trail.length; i++) {
                // 🔐 TRAVA DE SEGURANÇA: Se p1 estiver batendo na sua própria trilha (p1 === p2),
                // ignora os últimos 5 pontos criados para não morrer ao sair da base.
                if (p1.id === p2.id && i >= p2.trail.length - 5) {
                    continue; 
                }

                const pontoTrilha = p2.trail[i];
                const distancia = Math.hypot(p1.x - pontoTrilha.x, p1.y - pontoTrilha.y);

                if (distancia < 20) {
                    p2.alive = false; // Quem teve a trilha cortada morre!
                    gameState.pot += 5.00;
                    break; 
                }
            }
        });
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'update', gameState: gameState }));
            
            // Avisa especificamente o jogador que faleceu
            Object.values(gameState.players).forEach(p => {
                if (!p.alive && p.id === client.id) {
                    client.send(JSON.stringify({ type: 'gameOver', id: p.id }));
                }
            });
        }
    });
}, 100);

server.listen(PORT, () => { console.log(`🚀 Motor com física ajustada ativo na porta ${PORT}`); });
