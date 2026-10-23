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
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        }
    });
});

const wss = new WebSocket.Server({ server });

const gameState = {
    players: {},
    pot: 0.00,
    grid: {},
    mapRows: 60,
    mapCols: 60,
    blockSize: 32,
    tickRate: 120
};

const CORES = ['#FF3366', '#33FF66', '#3366FF', '#FFFF33', '#FF33FF', '#00FFFF', '#FF9900'];
const BOT_NAMES = ['BOT_Veloz', 'BOT_Alvo', 'BOT_Omega', 'BOT_Giro', 'BOT_Flare'];

function keyFor(row, col) {
    return `${row},${col}`;
}

function inBounds(row, col) {
    return row >= 0 && row < gameState.mapRows && col >= 0 && col < gameState.mapCols;
}

function sortPlayersByScore() {
    return Object.values(gameState.players).sort((a, b) => b.score - a.score);
}

function calcularPontuacao(playerId) {
    let score = 0;
    Object.values(gameState.grid).forEach(celula => {
        if (celula.dono === playerId && celula.tipo === 'base') score += 1;
    });
    return score;
}

function atualizarPontuacao(playerId) {
    const player = gameState.players[playerId];
    if (!player) return;
    player.score = calcularPontuacao(playerId);
}

function gerarId() {
    return '_' + Math.random().toString(36).slice(2, 11);
}

function removerDadosDoJogador(playerId) {
    Object.keys(gameState.grid).forEach(chave => {
        if (gameState.grid[chave].dono === playerId) {
            delete gameState.grid[chave];
        }
    });
}

function converterRastroEmBase(playerId) {
    const trail = [];
    Object.entries(gameState.grid).forEach(([chave, celula]) => {
        if (celula.dono === playerId && celula.tipo === 'rastro') {
            trail.push(chave);
        }
    });

    if (!trail.length) return;

    const player = gameState.players[playerId];
    if (!player) return;

    let deveSolidificar = false;
    for (const chave of trail) {
        const [r, c] = chave.split(',').map(Number);
        const vizinhos = [
            [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]
        ];

        for (const [nr, nc] of vizinhos) {
            if (!inBounds(nr, nc)) continue;
            const vizinho = gameState.grid[keyFor(nr, nc)];
            if (vizinho && vizinho.dono === playerId && vizinho.tipo === 'base') {
                deveSolidificar = true;
                break;
            }
        }

        if (deveSolidificar) break;
    }

    if (!deveSolidificar) return;

    trail.forEach(chave => {
        const celula = gameState.grid[chave];
        if (celula) {
            celula.tipo = 'base';
            celula.cor = player.color;
        }
    });
}

function criarAreaInicial(startRow, startCol, playerId, cor, size = 4) {
    const half = Math.floor(size / 2);
    for (let r = startRow - half; r < startRow + half; r++) {
        for (let c = startCol - half; c < startCol + half; c++) {
            if (!inBounds(r, c)) continue;
            gameState.grid[keyFor(r, c)] = { tipo: 'base', dono: playerId, cor: cor };
        }
    }
}

function matarJogador(playerId, killerId = null) {
    const player = gameState.players[playerId];
    if (!player || !player.alive) return;

    player.alive = false;
    player.dRow = 0;
    player.dCol = 0;

    removerDadosDoJogador(playerId);

    if (killerId && gameState.players[killerId]) {
        gameState.players[killerId].score = (gameState.players[killerId].score || 0) + 10;
    }

    if (player.isBot) {
        gameState.pot += 2.5;
    } else {
        gameState.pot += 4.0;
    }
}

function criarBot(nome) {
    const r = Math.floor(Math.random() * (gameState.mapRows - 12)) + 6;
    const c = Math.floor(Math.random() * (gameState.mapCols - 12)) + 6;
    const cor = CORES[Math.floor(Math.random() * CORES.length)];

    const bot = {
        id: nome,
        name: nome,
        row: r,
        col: c,
        dRow: 1,
        dCol: 0,
        color: cor,
        alive: true,
        isBot: true,
        score: 0,
        trail: []
    };

    gameState.players[bot.id] = bot;
    criarAreaInicial(r, c, bot.id, cor, 4);
    atualizarPontuacao(bot.id);
}

function escolherDirecaoBot(player) {
    const opcoes = [
        { dRow: -1, dCol: 0 },
        { dRow: 1, dCol: 0 },
        { dRow: 0, dCol: -1 },
        { dRow: 0, dCol: 1 }
    ];

    let melhorOpcao = { dRow: player.dRow || 1, dCol: player.dCol || 0 };
    let melhorScore = -Infinity;

    for (const opcao of opcoes) {
        if (opcao.dRow === -player.dRow && opcao.dRow !== 0) continue;
        if (opcao.dCol === -player.dCol && opcao.dCol !== 0) continue;

        const nr = player.row + opcao.dRow;
        const nc = player.col + opcao.dCol;

        if (!inBounds(nr, nc)) continue;

        const celula = gameState.grid[keyFor(nr, nc)];
        let score = 8;

        if (celula && celula.dono === player.id && celula.tipo === 'rastro') score -= 50;
        if (celula && celula.dono === player.id && celula.tipo === 'base') score += 8;
        if (celula && celula.dono !== player.id) score -= 20;
        if (celula && celula.tipo === 'rastro' && celula.dono !== player.id) score -= 25;
        if (celula && celula.tipo === 'base' && celula.dono !== player.id) score -= 28;

        if (nr < 4 || nc < 4 || nr > gameState.mapRows - 5 || nc > gameState.mapCols - 5) score -= 10;
        if (Math.abs(nr - gameState.mapRows / 2) + Math.abs(nc - gameState.mapCols / 2) < 10) score += 6;

        if (score > melhorScore) {
            melhorScore = score;
            melhorOpcao = opcao;
        }
    }

    return melhorOpcao;
}

function registrarJogador(ws) {
    const playerId = gerarId();
    const r = Math.floor(Math.random() * (gameState.mapRows - 14)) + 7;
    const c = Math.floor(Math.random() * (gameState.mapCols - 14)) + 7;
    const cor = '#00ffcc';

    gameState.players[playerId] = {
        id: playerId,
        name: `Player_${playerId.slice(-4)}`,
        row: r,
        col: c,
        dRow: 0,
        dCol: 0,
        color: cor,
        alive: true,
        isBot: false,
        balance: 50.00,
        score: 0,
        trail: []
    };

    criarAreaInicial(r, c, playerId, cor, 4);
    atualizarPontuacao(playerId);
    ws.id = playerId;

    gameState.pot += 2;
    ws.send(JSON.stringify({ type: 'init', id: playerId, balance: gameState.players[playerId].balance }));
}

wss.on('connection', (ws) => {
    registrarJogador(ws);

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            const player = gameState.players[ws.id];
            if (!player || !player.alive || !data || data.type !== 'move') return;

            if (data.dRow === 0 && data.dCol === 0) {
                player.dRow = 0;
                player.dCol = 0;
                return;
            }

            if (player.dRow !== 0 && data.dRow === -player.dRow && data.dRow !== 0) return;
            if (player.dCol !== 0 && data.dCol === -player.dCol && data.dCol !== 0) return;

            player.dRow = data.dRow;
            player.dCol = data.dCol;
        } catch (e) {
            console.error('Erro ao processar mensagem do cliente:', e);
        }
    });

    ws.on('close', () => {
        const player = gameState.players[ws.id];
        if (player) {
            removerDadosDoJogador(ws.id);
            delete gameState.players[ws.id];
        }
    });
});

BOT_NAMES.forEach((nome) => criarBot(nome));

function atualizarEstadoJogo() {
    Object.values(gameState.players).forEach((player) => {
        if (!player || !player.alive) return;

        if (player.isBot) {
            const direcao = escolherDirecaoBot(player);
            player.dRow = direcao.dRow;
            player.dCol = direcao.dCol;
        }

        if (player.dRow === 0 && player.dCol === 0) return;

        const proximaLinha = player.row + player.dRow;
        const proximaColuna = player.col + player.dCol;

        if (!inBounds(proximaLinha, proximaColuna)) {
            if (player.isBot) {
                player.dRow *= -1;
                player.dCol *= -1;
            }
            return;
        }

        const destino = gameState.grid[keyFor(proximaLinha, proximaColuna)];

        if (destino && destino.dono === player.id && destino.tipo === 'rastro') {
            matarJogador(player.id, null);
            return;
        }

        if (destino && destino.dono !== player.id && (destino.tipo === 'rastro' || destino.tipo === 'base')) {
            matarJogador(player.id, destino.dono);
            return;
        }

        player.row = proximaLinha;
        player.col = proximaColuna;

        if (!destino || destino.dono !== player.id) {
            if (destino && destino.dono !== player.id && destino.dono) {
                const elemento = gameState.players[destino.dono];
                if (elemento && elemento.alive) {
                    matarJogador(destino.dono, player.id);
                }
            }

            gameState.grid[keyFor(player.row, player.col)] = { tipo: 'rastro', dono: player.id, cor: player.color };
            player.trail.push({ row: player.row, col: player.col });

            if (player.trail.length > 1200) {
                player.trail.shift();
            }
        }

        if (player.row >= 0 && player.col >= 0) {
            converterRastroEmBase(player.id);
        }

        atualizarPontuacao(player.id);
    });

    wss.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) return;

        const player = gameState.players[client.id];
        if (player && !player.alive) {
            client.send(JSON.stringify({ type: 'gameOver', id: player.id }));
        }

        client.send(JSON.stringify({ type: 'update', gameState: gameState, ranking: sortPlayersByScore().slice(0, 5) }));
    });
}

setInterval(atualizarEstadoJogo, gameState.tickRate);

server.listen(PORT, () => {
    console.log(`🚀 Motor ativo na porta ${PORT}`);
});

module.exports = { gameState, converterRastroEmBase, escolherDirecaoBot, matarJogador };
