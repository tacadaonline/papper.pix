const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
        if (err) { 
            res.writeHead(500); 
            res.end('Erro ao carregar index.html'); 
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
    grid: {}, 
    mapRows: 75, 
    mapCols: 75, 
    blockSize: 40
};

const CORES = ['#FF3366', '#33FF66', '#3366FF', '#FFFF33', '#FF33FF', '#00FFFF', '#FF9900'];

function gerarId() {
    return '_' + Math.random().toString(36).substr(2, 9);
}

function conquistarAreaInicial(startRow, startCol, playerId, cor) {
    for (let r = startRow; r < startRow + 4; r++) {
        for (let c = startCol; c < startCol + 4; c++) {
            gameState.grid[`${r},${c}`] = { tipo: 'base', dono: playerId, cor: cor };
        }
    }
}

function removerDadosDoJogador(playerId) {
    Object.keys(gameState.grid).forEach(chave => {
        if (gameState.grid[chave].dono === playerId) {
            delete gameState.grid[chave];
        }
    });
}

function solidificarRastro(playerId) {
    Object.keys(gameState.grid).forEach(chave => {
        const bloco = gameState.grid[chave];
        if (bloco.dono === playerId && bloco.tipo === 'rastro') {
            bloco.tipo = 'base';
        }
    });
}

function criarBot(idNome) {
    const r = Math.floor(Math.random() * (gameState.mapRows - 10)) + 3;
    const c = Math.floor(Math.random() * (gameState.mapCols - 10)) + 3;
    const cor = CORES[Math.floor(Math.random() * CORES.length)];

    gameState.players[idNome] = {
        id: idNome,
        row: r, col: c,
        dRow: 1, dCol: 0, 
        color: cor,
        alive: true,
        isBot: true
    };
    conquistarAreaInicial(r, c, idNome, cor);
}

criarBot('BOT_Mestre');
criarBot('BOT_Alvo');

wss.on('connection', (ws) => {
    const playerId = gerarId();
    ws.id = playerId; // Corrige o ID no objeto do socket

    const r = Math.floor(Math.random() * (gameState.mapRows - 15)) + 5;
    const c = Math.floor(Math.random() * (gameState.mapCols - 15)) + 5;
    const cor = '#00ffcc'; 

    gameState.players[playerId] = {
        id: playerId,
        row: r, col: c,
        dRow: 0, dCol: 0, 
        color: cor,
        alive: true,
        isBot: false,
        balance: 50.00
    };

    gameState.pot += 2.00;
    conquistarAreaInicial(r, c, playerId, cor);

    ws.send(JSON.stringify({ type: 'init', id: playerId, balance: gameState.players[playerId].balance }));

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            const p = gameState.players[playerId];
            if (data.type === 'move' && p?.alive) {
                if (data.dRow === -p.dRow && data.dRow !== 0) return;
                if (data.dCol === -p.dCol && data.dCol !== 0) return;
                p.dRow = data.dRow;
                p.dCol = data.dCol;
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => { 
        removerDadosDoJogador(playerId);
        delete gameState.players[playerId];
    });
});

setInterval(() => {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;

        if (player.isBot && Math.random() < 0.12) {
            const opcoes = [{r:1,c:0}, {r:-1,c:0}, {r:0,c:1}, {r:0,c:-1}];
            const escolha = opcoes[Math.floor(Math.random() * opcoes.length)];
            if (!(escolha.r === -player.dRow && escolha.r !== 0) && !(escolha.c === -player.dCol && escolha.c !== 0)) {
                player.dRow = escolha.r; player.dCol = escolha.c;
            }
        }

        if (player.dRow === 0 && player.dCol === 0) return;

        player.row += player.dRow;
        player.col += player.dCol;

        if (player.row < 0) { player.row = 0; if(player.isBot) player.dRow *= -1; }
        if (player.row >= gameState.mapRows) { player.row = gameState.mapRows - 1; if(player.isBot) player.dRow *= -1; }
        if (player.col < 0) { player.col = 0; if(player.isBot) player.dCol *= -1; }
        if (player.col >= gameState.mapCols) { player.col = gameState.mapCols - 1; if(player.isBot) player.dCol *= -1; }

        const chavePosicao = `${player.row},${player.col}`;
        const blocoAtual = gameState.grid[chavePosicao];

        if (!blocoAtual || blocoAtual.dono !== player.id) {
            if (blocoAtual && blocoAtual.tipo === 'rastro') {
                const oponenteId = blocoAtual.dono;
                if (gameState.players[oponenteId]) {
                    gameState.players[oponenteId].alive = false;
                    removerDadosDoJogador(oponenteId);
                    gameState.pot += 5.00;
                }
            }
            gameState.grid[chavePosicao] = { tipo: 'rastro', dono: player.id, cor: player.color };
        } else if (blocoAtual && blocoAtual.dono === player.id) {
            if (blocoAtual.tipo === 'rastro') {
                player.alive = false;
                removerDadosDoJogador(player.id);
            } else if (blocoAtual.tipo === 'base') {
                solidificarRastro(player.id);
            }
        }
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'update', gameState: gameState }));
            
            Object.values(gameState.players).forEach(p => {
                if (!p.alive && p.id === client.id) {
                    client.send(JSON.stringify({ type: 'gameOver', id: p.id }));
                }
            });
        }
    });
}, 130);

server.listen(PORT, () => { console.log(`🚀 Motor ativo na porta ${PORT}`); });
