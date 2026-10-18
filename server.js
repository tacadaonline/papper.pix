const WebSocket = require('ws');
const http = require('http');
const fs = require('fs'); // 🆕 Módulo para ler arquivos do servidor
const path = require('path');

const PORT = process.env.PORT || 8080;

// 🚀 Servidor HTTP atualizado para carregar a interface do jogo automaticamente
const server = http.createServer((req, res) => {
    fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Erro ao carregar o arquivo index.html no servidor. Certifique-se de que ele está na mesma pasta que o server.js.');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        }
    });
});

const wss = new WebSocket.Server({ server });

// Estado Global do Jogo (Simplificado para visualização imediata)
let gameState = {
    players: {},
    pot: 0.00
};

const CORES = ['#FF5733', '#33FF57', '#3357FF', '#F3FF33', '#FF33F3', '#00FFFF', '#FF9900'];

function gerarId() {
    return '_' + Math.random().toString(36).substr(2, 9);
}

wss.on('connection', (ws) => {
    const playerId = gerarId();
    console.log(`Jogador conectado: ${playerId}`);

    // Inicializa o jogador em uma posição aleatória do mapa (Canvas 800x600)
    gameState.players[playerId] = {
        id: playerId,
        x: Math.floor(Math.random() * 700) + 50,
        y: Math.floor(Math.random() * 500) + 50,
        dx: 0,
        dy: 0,
        color: CORES[Math.floor(Math.random() * CORES.length)],
        trail: [],
        alive: true,
        balance: 10.00 // Saldo fictício para teste inicial
    };

    // Adiciona uma taxa simbólica ao pote para ver o valor subindo
    gameState.pot += 2.00;

    // Envia os dados iniciais de identificação para este jogador específico
    ws.send(JSON.stringify({
        type: 'init',
        id: playerId,
        balance: gameState.players[playerId].balance
    }));

    // Escuta os comandos de movimento vindos do teclado do cliente
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'move' && gameState.players[playerId]?.alive) {
                // Altera a direção do quadrado de acordo com as setas pressionadas
                gameState.players[playerId].dx = data.dx * 4; // velocidade do movimento
                gameState.players[playerId].dy = data.dy * 4;
            }
        } catch (e) {
            console.error("Erro ao processar mensagem:", e);
        }
    });

    ws.on('close', () => {
        console.log(`Jogador desconectado: ${playerId}`);
        delete gameState.players[playerId];
    });
});

// MOTOR DO JOGO (GAME LOOP): Roda a cada 100 milissegundos para mover os jogadores e atualizar a tela
setInterval(() => {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;

        // Se o jogador estiver se movendo, guarda a posição antiga na trilha/rastro
        if (player.dx !== 0 || player.dy !== 0) {
            player.trail.push({ x: player.x, y: player.y });
            // Limita o tamanho do rastro para não travar a memória do teste inicial
            if (player.trail.length > 50) player.trail.shift();
        }

        // Atualiza a posição atual somando a direção (velocidade)
        player.x += player.dx;
        player.y += player.dy;

        // Limita as bordas do Canvas para o quadrado não sumir da tela
        if (player.x < 0) player.x = 0;
        if (player.x > 800) player.x = 800;
        if (player.y < 0) player.y = 0;
        if (player.y > 600) player.y = 600;
    });

    // Envia o estado atualizado com a posição de todos os quadrados para todos os clientes conectados
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'update',
                gameState: gameState
            }));
        }
    });
}, 100);

server.listen(PORT, () => {
    console.log(`🚀 Jogo rodando perfeitamente e servindo HTML na porta ${PORT}`);
});
