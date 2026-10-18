const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
console.log("🚀 Servidor Multi-Salas com IA e Painel Adm rodando na porta 8080...");

// Configurações Globais do Jogo (Controladas pelo Administrador)
let CONFIG_ADM = {
    buyIn: 2.0,
    maxPlayers: 10,
    bancaTaxa: 0.10,
    dificuldadeBot: 'medio',
    tempoEsperaBot: 5000,
    chaveMestreAdm: "MINHA_SENHA_SECRETA_123"
};

let rooms = {};
const CORES = ['#FF5733', '#33FF57', '#3357FF', '#F3FF33', '#FF33F3', '#00FFFF', '#FF9900'];

function gerarId() {
    return '_' + Math.random().toString(36).substr(2, 9);
}

// ✅ CRIA UMA NOVA SALA
function criarNovaSala() {
    const roomId = 'room_' + gerarId();

    rooms[roomId] = {
        id: roomId,
        players: [],
        bots: [],
        status: "aguardando",
        createdAt: Date.now(),
        config: { ...CONFIG_ADM }
    };

    return roomId;
}

// ✅ ADICIONA JOGADOR NA SALA
function adicionarJogador(roomId, ws, nome) {
    if (!rooms[roomId]) return;

    const player = {
        id: gerarId(),
        nome,
        cor: CORES[Math.floor(Math.random() * CORES.length)],
        ws
    };

    rooms[roomId].players.push(player);
    broadcast(roomId, { tipo: "jogador_entrou", player });
}

// ✅ ENVIA MENSAGEM PARA TODOS DA SALA
function broadcast(roomId, data) {
    if (!rooms[roomId]) return;

    rooms[roomId].players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify(data));
        }
    });
}

// ✅ EVENTO PRINCIPAL DE CONEXÃO
wss.on('connection', (ws) => {
    console.log("Novo cliente conectado!");

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            // Criar sala
            if (data.tipo === "criar_sala") {
                const novaSala = criarNovaSala();
                ws.send(JSON.stringify({ tipo: "sala_criada", sala: novaSala }));
            }

            // Entrar na sala
            if (data.tipo === "entrar_sala") {
                adicionarJogador(data.sala, ws, data.nome);
            }

        } catch (e) {
            console.error("Erro ao processar mensagem:", e);
        }
    });

    ws.on('close', () => {
        console.log("Cliente desconectado.");
    });
});

console.log("✅ Servidor iniciado sem erros!");
