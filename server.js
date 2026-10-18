// Salve este arquivo como: server.js
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
console.log("🚀 Servidor Multi-Salas com IA e Painel Adm rodando na porta 8080...");

// Configurações Globais do Jogo (Controladas pelo Administrador)
let CONFIG_ADM = {
    buyIn: 2.0,
    maxPlayers: 10,
    bancaTaxa: 0.10, // 10% de taxa da casa
    // Dificuldade do Bot: 
    // 'facil' (reage a cada 800ms), 'medio' (400ms), 'dificil' (150ms), 'impossivel' (50ms)
    dificuldadeBot: 'medio', 
    tempoEsperaBot: 5000, // 5 segundos esperando jogador real antes de colocar bots
    chaveMestreAdm: "MINHA_SENHA_SECRETA_123" // Chave de segurança para o painel adm
};

let rooms = {};
const CORES = ['#FF5733', '#33FF57', '#3357FF', '#F3FF33', '#FF33F3', '#00FFFF', '#FF9900'];

function gerarId() { return '_' + Math.random().toString(36).substr(2, 9); }

function criarNovaSala() {
    const roomId = 'room_' + gerarId();
    rooms[roomId] = {
        id: roomId,
        players: {},
        pot: 0,
        status: 'waiting',
        width: 800,
        height: 600,
        timerBot: null
    };
    
    // Inicia o contador para preencher a sala com bots caso não lote com humanos a tempo
    rooms[roomId].timerBot = setTimeout(() => {
        preencherSalaComBots(roomId);
    }, CONFIG_ADM.tempoEsperaBot);

    console.log(`🏢 Nova sala criada: ${roomId}`);
    return roomId;
}

function buscarSalaDisponivel() {
    for (let id in rooms) {
        let qtdPlayers = Object.keys(rooms[id].players).length;
        if (rooms[id].status === 'waiting' && qtdPlayers < CONFIG_ADM.maxPlayers) {
            return id;
        }
    }
    return criarNovaSala();
}

// Lógica de Conexão WebSocket
wss.on('connection', (ws) => {
    
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        // ----------------- ROTA DO PAINEL ADM -----------------
        if (data.type === 'adm_update') {
            if (data.chaveSecret === CONFIG_ADM.chaveMestreAdm) {
                CONFIG_ADM.dificuldadeBot = data.novaDificuldade || CONFIG_ADM.dificuldadeBot;
                CONFIG_ADM.buyIn = data.novoBuyIn || CONFIG_ADM.buyIn;
                console.log(`⚙️ [ADMIN] Configurações atualizadas via Painel! Dificuldade do Bot agora é: ${CONFIG_ADM.dificuldadeBot.toUpperCase()}`);
                ws.send(JSON.stringify({ type: 'adm_success', configAtual: CONFIG_ADM }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Acesso negado: Chave mestra inválida.' }));
            }
            return;
        }

        // ----------------- ROTAS DO JOGADOR REAL -----------------
        if (data.type === 'join_game') {
            const playerId = 'user_' + gerarId();
            const targetRoomId = buscarSalaDisponivel();
            const sala = rooms[targetRoomId];

            sala.pot += CONFIG_ADM.buyIn;
            sala.players[playerId] = {
                id: playerId, ws: ws, isBot: false,
                x: Math.floor(Math.random() * (sala.width - 100)) + 50,
                y: Math.floor(Math.random() * (sala.height - 100)) + 50,
                dx: 0, dy: 0, color: CORES[Math.floor(Math.random() * CORES.length)],
                trail: [], alive: true
            };

            ws.send(JSON.stringify({ type: 'init', id: playerId, roomId: targetRoomId, buyIn: CONFIG_ADM.buyIn }));
            verificarStatusSala(targetRoomId);
            
            // Atribui o ID ao websocket para gerenciar no encerramento
            ws.playerId = playerId;
            ws.roomId = targetRoomId;
        }

        if (data.type === 'move' && ws.roomId && rooms[ws.roomId]) {
            const player = rooms[ws.roomId].players[ws.playerId];
            if (player && player.alive) {
                player.dx = data.dx;
                player.dy = data.dy;
            }
        }
    });

    ws.on('close', () => {
        if (ws.roomId && rooms[ws.roomId] && rooms[ws.roomId].players[ws.playerId]) {
            rooms[ws.roomId].players[ws.playerId].alive = false;
            delete rooms[ws.roomId].players[ws.playerId];
            verificarVencedor(ws.roomId);
        }
    });
});

// Preencher as vagas restantes da sala com Bots inteligentes
function preencherSalaComBots(roomId) {
    const sala = rooms[roomId];
    if (!sala || sala.status !== 'waiting') return;

    let qtdAtual = Object.keys(sala.players).length;
    let vagasRestantes = CONFIG_ADM.maxPlayers - qtdAtual;

    for (let i = 0; i < vagasRestantes; i++) {
        const botId = 'bot_' + gerarId();
        sala.pot += CONFIG_ADM.buyIn; // O Bot "simula" que colocou dinheiro para inflar o pote
        sala.players[botId] = {
            id: botId, ws: null, isBot: true,
            x: Math.floor(Math.random() * (sala.width - 100)) + 50,
            y: Math.floor(Math.random() * (sala.height - 100)) + 50,
            dx: 1, dy: 0, // Bots já nascem se movendo
            color: '#888888', // Cor padrão de bot (pode ser aleatória também)
            trail: [], alive: true,
            ultimoCalculoIA: 0
        };
    }
    
    sala.status = 'active';
    clearTimeout(sala.timerBot);
    broadcastParaSala(roomId, { type: 'matchStart', message: 'A partida começou com Bots adicionados!' });
}

function verificarStatusSala(roomId) {
    const sala = rooms[roomId];
    let total = Object.keys(sala.players).length;
    if (total === CONFIG_ADM.maxPlayers && sala.status === 'waiting') {
        sala.status = 'active';
        clearTimeout(sala.timerBot);
        broadcastParaSala(roomId, { type: 'matchStart', message: 'Partida iniciada com 10 jogadores!' });
    } else {
        broadcastParaSala(roomId, { type: 'waitingPlayers', count: total });
    }
}

// Inteligência Artificial do Bot (Executada sob demanda de tempo do ADM)
function processarIAdoBot(sala, bot, agora) {
    // Define o tempo de reação com base no painel ADM
    let intervaloReacao = 400; // Médio
    if (CONFIG_ADM.dificuldadeBot === 'facil') intervaloReacao = 800;
    if (CONFIG_ADM.dificuldadeBot === 'dificil') intervaloReacao = 150;
    if (CONFIG_ADM.dificuldadeBot === 'impossivel') intervaloReacao = 50;

    if (agora - bot.ultimoCalculoIA < intervaloReacao) return;
    bot.ultimoCalculoIA = agora;

    // IA Simples: Evitar bater nas paredes e mudar de direção aleatoriamente para caçar
    if (bot.x < 50)  { bot.dx = 1;  bot.dy = 0; return; }
    if (bot.x > sala.width - 50) { bot.dx = -1; bot.dy = 0; return; }
    if (bot.y < 50)  { bot.dy = 1;  bot.dx = 0; return; }
    if (bot.y > sala.height - 50) { bot.dy = -1; bot.dx = 0; return; }

    // Chance de mudar de direção do nada (para parecer humano)
    if (Math.random() < 0.15) {
        const direcoes = [{dx:1, dy:0}, {dx:-1, dy:0}, {dx:0, dy:1}, {dx:0, dy:-1}];
        // Filtra para não voltar direto para trás (suicídio)
        const escolhasValidas = direcoes.filter(d => !(d.dx === -bot.dx && d.dy === -bot.dy));
        const novaDir = escolhasValidas[Math.floor(Math.random() * escolhasValidas.length)];
        bot.dx = novaDir.dx;
        bot.dy = novaDir.dy;
    }
}

// LOOP PRINCIPAL DO JOGO (30 FPS)
setInterval(() => {
    const agora = Date.now();

    for (let roomId in rooms) {
        const sala = rooms[roomId];
        if (sala.status !== 'active') continue;

        let ativos = Object.values(sala.players).filter(p => p.alive);

        ativos.forEach(player => {
            // Se for bot, processa a tomada de decisão antes de andar
            if (player.isBot) {
                processarIAdoBot(sala, player, agora);
            }

            if (player.dx !== 0 || player.dy !== 0) {
                player.trail.push({ x: player.x, y: player.y });
            }

            player.x += player.dx * 4;
            player.y += player.dy * 4;

            // Colisões básicas (Paredes)
            if (player.x < 0 || player.x > sala.width || player.y < 0 || player.y > sala.height) {
                eliminarJogador(roomId, player.id, "Bateu na parede");
            }

            // Colisões com trilhas
            ativos.forEach(outroPlayer => {
                const limiteTrilha = outroPlayer.id === player.id ? player.trail.length - 3 : outroPlayer.trail.length;
                for (let i = 0; i < limiteTrilha; i++) {
                    const ponto = outroPlayer.trail[i];
                    if (ponto) {
                        if (Math.hypot(player.x - ponto.x, player.y - ponto.y) < 8) {
                            eliminarJogador(roomId, player.id, "Corte de rastro");
                        }
                    }
                }
            });
        });

        // Envia atualizações filtrando dados de conexão sensíveis
        const cleanPlayers = {};
        Object.keys(sala.players).forEach(id => {
            const p = sala.players[id];
            cleanPlayers[id] = { id: p.id, x: p.x, y: p.y, dx: p.dx, dy: p.dy, color: p.color, trail: p.trail, alive: p.alive, isBot: p.isBot };
        });

        broadcastParaSala(roomId, { type: 'update', gameState: { players: cleanPlayers, pot: sala.pot, status: sala.status } });
    }
}, 1000 / 30);

function eliminarJogador(roomId, playerId, motivo) {
    const sala = rooms[roomId];
    if (sala && sala.players[playerId] && sala.players[playerId].alive) {
        sala.players[playerId].alive = false;
        sala.players[playerId].trail = [];
        console.log(`💀 [${roomId}] ${playerId} eliminado (${motivo}).`);
        verificarVencedor(roomId);
    }
}

function verificarVencedor(roomId) {
    const sala = rooms[roomId];
    if (!sala || sala.status !== 'active') return;

    let ativos = Object.values(sala.players).filter(p => p.alive);
    let humanosAtivos = ativos.filter(p => !p.isBot);

    // Fim de jogo se sobrar apenas 1 jogador vivo (seja bot ou humano)
    if (ativos.length === 1) {
        const vencedor = ativos[0];
