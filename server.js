const http = require('http'); // Adicionado nativo do Node
const WebSocket = require('ws');

// 1. Usa a porta dinâmica do Render ou a 8080 caso esteja rodando localmente
const PORT = process.env.PORT || 8080;

// 2. Cria um servidor HTTP básico exigido pelo Render para fazer o roteamento
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Servidor WebSocket ativo.');
});

// 3. Vincula o servidor WebSocket diretamente ao servidor HTTP principal
const wss = new WebSocket.Server({ server });

console.log(`🚀 Servidor Multi-Salas com IA e Painel Adm configurado para a porta ${PORT}...`);

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

// 4. Inicia o servidor escutando a porta correta
server.listen(PORT, () => {
    console.log(`✅ Servidor iniciado com sucesso na porta ${PORT}!`);
});
