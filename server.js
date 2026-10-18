const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// 🚀 Servidor HTTP que entrega o arquivo index.html automaticamente
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

// Definição da malha do Grid profissional (Paper.io original)
let gameState = {
    players: {},
    pot: 0.00,
    grid: {}, // Armazena a matriz ocupada: {"linha,coluna": {tipo: "base/rastro", dono: "id", cor: "hex"}}
    mapRows: 75, // 75 blocos de altura
    mapCols: 75, // 75 blocos de largura
    blockSize: 40
};

const CORES = ['#FF3366', '#33FF66', '#3366FF', '#FFFF33', '#FF33FF', '#00FFFF', '#FF9900'];

function gerarId() {
    return '_' + Math.random().toString(36).substr(2, 9);
}

// Gera uma base quadrada inicial de 4x4 blocos perfeitos para o jogador
function conquistarAreaInicial(startRow, startCol, playerId, cor) {
    for (let r = startRow; r < startRow + 4; r++) {
        for (let c = startCol; c < startCol + 4; c++) {
            gameState.grid[`${r},${c}`] = { tipo: 'base', dono: playerId, cor: cor };
        }
    }
}

// Algoritmo de Limpeza: Apaga bases e rastros de quem foi eliminado
function removerDadosDoJogador(playerId) {
    Object.keys(gameState.grid).forEach(chave => {
        if (gameState.grid[chave].dono === playerId) {
            delete gameState.grid[chave];
        }
    });
}

// Converte rastro ativo em base conquistada ao fechar o circuito
function solidificarRastro(playerId) {
    Object.keys(gameState.grid).forEach(chave => {
        const bloco = gameState.grid[chave];
        if (bloco.dono === playerId && bloco.tipo === 'rastro') {
            bloco.tipo = 'base';
        }
    });
}

// Cria Bots automatizados no mapa
function criarBot(idNome) {
    const r = Math.floor(Math.random() * (gameState.mapRows - 10)) + 3;
    const c = Math.floor(Math.random() * (gameState.mapCols - 10)) + 3;
    const cor = CORES[Math.floor(Math.random() * CORES.length)];

    gameState.players[idNome] = {
        id: idNome,
        row: r, col: c,
        dRow: 1, dCol: 0, // Começa andando automático
        color: cor,
        alive: true,
        isBot: true
    };
    conquistarAreaInicial(r, c, idNome, cor);
}

// Inicializa Bots padrão ao rodar o servidor
criarBot('BOT_Mestre');
criarBot('BOT_Alvo');

// Evento de conexão do jogador real
wss.on('connection', (ws) => {
    const playerId = gerarId();
    const r = Math.floor(Math.random() * (gameState.mapRows - 15)) + 5;
    const c = Math.floor(Math.random() * (gameState.mapCols - 15)) + 5;
    const cor = '#00ffcc'; // Cor fixa neon pro jogador principal

    gameState.players[playerId] = {
        id: playerId,
        row: r, col: c,
        dRow: 0, dCol: 0, // Aguarda o primeiro comando do jogador
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
                // Impede virar diretamente para a direção exatamente oposta
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

// MOTOR DO JOGO: Processa física, conquistas e colisões em Grid (A cada 130ms)
setInterval(() => {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;

        // Lógica simples de IA do Bot: muda de direção aleatoriamente
        if (player.isBot && Math.random() < 0.12) {
            const opcoes = [{r:1,c:0}, {r:-1,c:0}, {r:0,c:1}, {r:0,c:-1}];
            const escolha = opcoes[Math.floor(Math.random() * opcoes.length)];
            if (!(escolha.r === -player.dRow && escolha.r !== 0) && !(escolha.c === -player.dCol && escolha.c !== 0)) {
                player.dRow = escolha.r; player.dCol = escolha.c;
            }
        }

        // Se o boneco estiver parado (início do jogo), pula o processamento
        if (player.dRow === 0 && player.dCol === 0) return;

        // Avança um bloco na malha do grid
        player.row += player.dRow;
        player.col += player.dCol;

        // Barreiras limitadoras externas do mapa
        if (player.row < 0) { player.row = 0; if(player.isBot) player.dRow *= -1; }
        if (player.row >= gameState.mapRows) { player.row = gameState.mapRows - 1; if(player.isBot) player.dRow *= -1; }
        if (player.col < 0) { player.col = 0; if(player.isBot) player.dCol *= -1; }
        if (player.col >= gameState.mapCols) { player.col = gameState.mapCols - 1; if(player.isBot) player.dCol *= -1; }

        const chavePosicao = `${player.row},${player.col}`;
        const blocoAtual = gameState.grid[chavePosicao];

        // LÓGICA DE CAPTURA E COLISÃO EM CÉLULAS
        if (!blocoAtual || blocoAtual.dono !== player.id) {
            // Se pisar no rastro ativo de outro jogador -> ELIMINAÇÃO!
            if (blocoAtual && blocoAtual.tipo === 'rastro') {
                const oponenteId = blocoAtual.dono;
                if (gameState.players[oponenteId]) {
                    gameState.players[oponenteId].alive = false;
                    removerDadosDoJogador(oponenteId);
                    gameState.pot += 5.00; // Incrementa bônus ao pote pelo abate
                }
            }
            
            // Cria a marcação de rastro por onde o jogador passa
            gameState.grid[chavePosicao] = { tipo: 'rastro', dono: player.id, cor: player.color };
        } else if (blocoAtual && blocoAtual.dono === player.id) {
            // Se colidir com o seu próprio rastro ativo -> Auto-morte
            if (blocoAtual.tipo === 'rastro') {
                player.alive = false;
                removerDadosDoJogador(player.id);
            } 
            // Se retornar em segurança para um bloco da sua base -> Solidifica e anexa o território
            else if (blocoAtual.tipo === 'base') {
                solidificarRastro(player.id);
            }
        }
    });

    // Envia a matriz de dados em tempo real para os clientes conectados
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'update', gameState: gameState }));
            
            // Dispara o alerta de fim de jogo especificamente para quem morreu
            Object.values(gameState.players).forEach(p => {
                if (!p.alive && p.id === client.id) {
                    client.send(JSON.stringify({ type: 'gameOver', id: p.id }));
                }
            });
        }
    });
}, 130);

server.listen(PORT, () => { 
    console.log(`🚀 Motor Profissional em Grid ativo e rodando na porta ${PORT}`); 
});
