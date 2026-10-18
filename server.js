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

// 🆕 Auxiliar para criar um quadrado de território inicial estruturado
function criarTerritorioInicial(cx, cy) {
    const r = 60; // tamanho do raio da base
    return [
        { x: cx - r, y: cy - r },
        { x: cx + r, y: cy - r },
        { x: cx + r, y: cy + r },
        { x: cx - r, y: cy + r }
    ];
}

// 🆕 Função matemática para checar se um ponto está dentro do polígono de território
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
    const offsetX = (Math.random() - 0.5) * 600;
    const offsetY = (Math.random() - 0.5) * 600;
    const bx = Math.max(150, Math.min(2850, centerX + offsetX));
    const by = Math.max(150, Math.min(2850, centerY + offsetY));

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
            // Guarda o rastro fora da base
            player.trail.push({ x: player.x, y: player.y });
            if (player.trail.length > 300) player.trail.shift();
        } else if (emSuaBase && player.trail.length > 0) {
            // 🆕 CAPTURA DE TERRITÓRIO: Retornou à base, anexa a trilha ao polígono existente
            player.territory = player.territory.concat(player.trail);
            player.trail = []; // limpa a trilha usada
        }

        player.x += player.dx;
        player.y += player.dy;

        // Limites físicos do mapa
        if (player.x < 30) { player.x = 30; if(player.isBot) player.dx *= -1; }
        if (player.x > gameState.mapSize - 30) { player.x = gameState.mapSize - 30; if(player.isBot) player.dx *= -1; }
        if (player.y < 30) { player.y = 30; if(player.isBot) player.dy *= -1; }
        if (player.y > gameState.mapSize - 30) { player.y = gameState.mapSize - 30; if(player.isBot) player.dy *= -1; }
    });

    // 🆕 SISTEMA DE COLISÕES (FÍSICA DE ELIMINAÇÃO)
    Object.values(gameState.players).forEach(p1 => {
        if (!p1.alive) return;

        Object.values(gameState.players).forEach(p2 => {
            if (!p2.alive || p2.trail.length < 2) return;

            // Testa se a cabeça de p1 bateu em algum ponto da trilha ativa de p2
            p2.trail.forEach(pontoTrilha => {
                const distancia = Math.hypot(p1.x - pontoTrilha.x, p1.y - pontoTrilha.y);
                if (distancia < 18) {
                    // Colisão detectada! Quem teve a trilha cortada (p2) morre
                    p2.alive = false;
                    gameState.pot += 5.00; // bônus adicionado ao pote por abate
                }
            });
        });
    });

    // Envia dados para conexões ativas e avisa quem perdeu
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'update', gameState: gameState }));
            
            // Verifica se o jogador associado a este cliente morreu nesta rodada
            Object.values(gameState.players).forEach(p => {
                if (!p.alive && p.id === client.id) {
                    client.send(JSON.stringify({ type: 'gameOver', id: p.id }));
                }
            });
        }
    });
}, 100);

server.listen(PORT, () => { console.log(`🚀 Motor com colisão e expansão de território ativo na porta ${PORT}`); });
