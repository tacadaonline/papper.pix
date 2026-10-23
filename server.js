const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const MAP_ROWS = 60;
const MAP_COLS = 60;
const BLOCK_SIZE = 22;
const TICK_MS = 100;

const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Erro ao carregar index.html');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  });
});

const wss = new WebSocket.Server({ server });

const gameState = {
  players: {},
  grid: {},
  pot: 0,
  mapRows: MAP_ROWS,
  mapCols: MAP_COLS,
  blockSize: BLOCK_SIZE,
  tickRate: TICK_MS
};

const COLORS = ['#FF3366', '#33FF66', '#3366FF', '#FFFF33', '#FF33FF', '#00FFFF', '#FF9900'];
const BOT_NAMES = ['BOT_Fox', 'BOT_Zero', 'BOT_Apex', 'BOT_Hawk', 'BOT_Viper'];

function keyFor(row, col) {
  return `${row},${col}`;
}

function inBounds(row, col) {
  return row >= 0 && row < gameState.mapRows && col >= 0 && col < gameState.mapCols;
}

function neighborsOf(row, col) {
  return [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
    [row - 1, col - 1],
    [row - 1, col + 1],
    [row + 1, col - 1],
    [row + 1, col + 1]
  ].filter(([r, c]) => inBounds(r, c));
}

function countOwnedCells(playerId) {
  let count = 0;
  for (const cell of Object.values(gameState.grid)) {
    if (cell.ownerId === playerId && cell.type === 'base') count += 1;
  }
  return count;
}

function updatePlayerScore(playerId) {
  const player = gameState.players[playerId];
  if (!player) return;
  player.score = countOwnedCells(playerId);
}

function clearOwnerCells(playerId) {
  Object.keys(gameState.grid).forEach((key) => {
    const cell = gameState.grid[key];
    if (cell && cell.ownerId === playerId) delete gameState.grid[key];
  });
}

function makeId() {
  return '_' + Math.random().toString(36).slice(2, 10);
}

function setCell(row, col, type, ownerId, color) {
  const key = keyFor(row, col);
  gameState.grid[key] = { type, ownerId, color };
}

function createInitialBase(playerId, color, x, y) {
  const row = Math.floor(y);
  const col = Math.floor(x);

  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (!inBounds(r, c)) continue;
      setCell(r, c, 'base', playerId, color);
    }
  }
}

function registerPlayer({ id, name, color, isBot, x, y }) {
  const player = {
    id,
    name,
    color,
    isBot,
    alive: true,
    x,
    y,
    vx: 1,
    vy: 0,
    score: 0,
    balance: 50,
    trail: [],
    lastSafeCell: null,
    directionTimer: 0
  };

  gameState.players[id] = player;
  createInitialBase(id, color, x, y);
  updatePlayerScore(id);
  return player;
}

function createPlayerSocket(ws) {
  const id = makeId();
  const x = 10 + Math.random() * 18;
  const y = 10 + Math.random() * 18;
  const player = registerPlayer({
    id,
    name: `Player_${id.slice(-4)}`,
    color: '#00ffcc',
    isBot: false,
    x,
    y
  });

  ws.id = id;
  gameState.pot += 2;
  ws.send(JSON.stringify({ type: 'init', id: player.id, balance: player.balance }));
}

function createBot(name, color) {
  const x = 15 + Math.random() * (gameState.mapCols - 30);
  const y = 15 + Math.random() * (gameState.mapRows - 30);
  const id = name;

  registerPlayer({
    id,
    name,
    color,
    isBot: true,
    x,
    y
  });
}

function keyFromPosition(x, y) {
  return keyFor(Math.floor(y), Math.floor(x));
}

function isClosedTrail(player) {
  const recent = player.trail.slice(-24);
  if (recent.length < 12) return false;

  let adjacentOwned = 0;
  for (const key of recent) {
    const [row, col] = key.split(',').map(Number);
    const cells = neighborsOf(row, col);
    for (const [nr, nc] of cells) {
      const cell = gameState.grid[keyFor(nr, nc)];
      if (cell && cell.ownerId === player.id && cell.type === 'base') adjacentOwned += 1;
    }
  }

  return adjacentOwned >= Math.max(6, Math.ceil(recent.length * 0.35));
}

function convertTrailToBase(player) {
  const recent = player.trail.slice(-20);
  if (!recent.length) return;

  recent.forEach((key) => {
    const [row, col] = key.split(',').map(Number);
    const cell = gameState.grid[keyFor(row, col)];
    if (cell && cell.ownerId === player.id && cell.type === 'trail') {
      cell.type = 'base';
      cell.color = player.color;
    }
  });

  updatePlayerScore(player.id);
}

function killPlayer(playerId, killerId = null) {
  const player = gameState.players[playerId];
  if (!player || !player.alive) return;

  player.alive = false;
  player.vx = 0;
  player.vy = 0;
  player.trail = [];

  clearOwnerCells(playerId);

  if (killerId && gameState.players[killerId]) {
    const killer = gameState.players[killerId];
    killer.score = (killer.score || 0) + 12;
    killer.balance = Number((killer.balance + 8).toFixed(2));
  }

  gameState.pot += player.isBot ? 2.5 : 4;
}

function evaluateDirection(bot, candidate) {
  const nextX = bot.x + candidate.vx;
  const nextY = bot.y + candidate.vy;
  const row = Math.floor(nextY);
  const col = Math.floor(nextX);

  if (!inBounds(row, col)) return -999;

  const key = keyFor(row, col);
  const cell = gameState.grid[key];
  let score = 0;

  if (cell) {
    if (cell.ownerId === bot.id) {
      score -= 50;
      if (cell.type === 'base') score -= 10;
      if (cell.type === 'trail') score -= 35;
    } else {
      score -= 40;
      if (cell.type === 'base') score -= 25;
      if (cell.type === 'trail') score -= 30;
    }
  }

  const centerBias = Math.abs(row - gameState.mapRows / 2) + Math.abs(col - gameState.mapCols / 2);
  score += 20 - centerBias * 0.2;

  const nearEnemy = Object.values(gameState.players).some((player) => {
    if (player.id === bot.id || !player.alive) return false;
    const dist = Math.abs(player.x - nextX) + Math.abs(player.y - nextY);
    return dist < 5;
  });

  if (nearEnemy) score += 12;

  return score;
}

function chooseBotDirection(bot) {
  const directions = [
    { vx: 1, vy: 0 },
    { vx: -1, vy: 0 },
    { vx: 0, vy: 1 },
    { vx: 0, vy: -1 },
    { vx: 1, vy: 1 },
    { vx: 1, vy: -1 },
    { vx: -1, vy: 1 },
    { vx: -1, vy: -1 }
  ];

  let best = { vx: bot.vx || 1, vy: bot.vy || 0 };
  let bestScore = -Infinity;

  for (const dir of directions) {
    const score = evaluateDirection(bot, dir);
    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }

  return best;
}

function stepPlayer(player) {
  if (!player.alive) return;

  if (player.isBot) {
    const chosen = chooseBotDirection(player);
    player.vx = chosen.vx;
    player.vy = chosen.vy;
  }

  const nextX = player.x + player.vx;
  const nextY = player.y + player.vy;

  if (nextX <= 0 || nextX >= gameState.mapCols || nextY <= 0 || nextY >= gameState.mapRows) {
    killPlayer(player.id);
    return;
  }

  const row = Math.floor(nextY);
  const col = Math.floor(nextX);
  const headKey = keyFor(row, col);

  const currentCell = gameState.grid[headKey];
  const previousHead = player.trail[player.trail.length - 1];

  if (currentCell && currentCell.ownerId !== player.id) {
    killPlayer(player.id, currentCell.ownerId || null);
    return;
  }

  if (player.trail.includes(headKey) && headKey !== previousHead && headKey !== player.lastSafeCell) {
    killPlayer(player.id);
    return;
  }

  player.x = nextX;
  player.y = nextY;
  player.trail.push(headKey);
  player.lastSafeCell = headKey;

  if (player.trail.length > 700) {
    player.trail.shift();
  }

  const baseCell = gameState.grid[headKey];
  if (!baseCell || baseCell.ownerId !== player.id) {
    setCell(row, col, 'trail', player.id, player.color);
  }

  if (isClosedTrail(player)) {
    convertTrailToBase(player);
  }

  updatePlayerScore(player.id);
}

function broadcast() {
  const ranking = Object.values(gameState.players)
    .filter((player) => player.alive)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5)
    .map((player) => ({ id: player.id, name: player.name, score: player.score }));

  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;

    const player = gameState.players[client.id];
    if (player && !player.alive) {
      client.send(JSON.stringify({ type: 'gameOver', id: player.id }));
    }

    client.send(JSON.stringify({ type: 'update', gameState, ranking }));
  });
}

wss.on('connection', (ws) => {
  createPlayerSocket(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const player = gameState.players[ws.id];
      if (!player || !player.alive || !data || data.type !== 'move') return;

      const ax = Number(data.dx || 0);
      const ay = Number(data.dy || 0);
      const length = Math.hypot(ax, ay);

      if (length > 0) {
        player.vx = ax / length;
        player.vy = ay / length;
      }
    } catch (error) {
      console.error('Mensagem inválida recebida:', error);
    }
  });

  ws.on('close', () => {
    const player = gameState.players[ws.id];
    if (!player) return;
    clearOwnerCells(player.id);
    delete gameState.players[ws.id];
  });
});

function initBots() {
  BOT_NAMES.forEach((name, index) => {
    const color = COLORS[index % COLORS.length];
    createBot(name, color);
  });
}

initBots();

setInterval(() => {
  Object.values(gameState.players).forEach((player) => {
    if (!player.alive) return;
    stepPlayer(player);
  });

  broadcast();
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`🚀 Motor do papelio ativo em http://localhost:${PORT}`);
});

module.exports = { gameState, convertTrailToBase, killPlayer, stepPlayer };

