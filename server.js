const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const MAP_ROWS = 60;
const MAP_COLS = 60;
const BLOCK_SIZE = 22;
const TICK_MS = 100;
const PLAYER_SPEED = 0.9;
const BOT_SPEED = 0.85;

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
const DIRECTIONS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
];

function keyFor(row, col) {
  return `${row},${col}`;
}

function inBounds(row, col) {
  return row >= 0 && row < gameState.mapRows && col >= 0 && col < gameState.mapCols;
}

function neighborsOf(row, col) {
  const list = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (inBounds(r, c)) list.push([r, c]);
    }
  }
  return list;
}

function setCell(row, col, type, ownerId, color) {
  gameState.grid[keyFor(row, col)] = { type, ownerId, color };
}

function clearOwnerCells(ownerId) {
  Object.keys(gameState.grid).forEach((key) => {
    const cell = gameState.grid[key];
    if (cell && cell.ownerId === ownerId) delete gameState.grid[key];
  });
}

function countOwnedCells(playerId) {
  let total = 0;
  Object.values(gameState.grid).forEach((cell) => {
    if (cell.ownerId === playerId && cell.type === 'base') total += 1;
  });
  return total;
}

function updateScore(playerId) {
  const player = gameState.players[playerId];
  if (!player) return;
  player.score = countOwnedCells(playerId);
}

function makeId() {
  return '_' + Math.random().toString(36).slice(2, 10);
}

function createInitialBase(playerId, color, x, y) {
  const centerRow = Math.floor(y);
  const centerCol = Math.floor(x);

  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const row = centerRow + dr;
      const col = centerCol + dc;
      if (!inBounds(row, col)) continue;
      setCell(row, col, 'base', playerId, color);
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
    speed: isBot ? BOT_SPEED : PLAYER_SPEED,
    trail: [],
    lastTrailKey: null,
    score: 0,
    balance: 50,
    lastDecision: Date.now()
  };

  gameState.players[id] = player;
  createInitialBase(id, color, x, y);
  updateScore(id);
  return player;
}

function createBot(name, color) {
  const x = 20 + Math.random() * (gameState.mapCols - 40);
  const y = 20 + Math.random() * (gameState.mapRows - 40);
  registerPlayer({ id: name, name, color, isBot: true, x, y });
}

function createSocketPlayer(ws) {
  const id = makeId();
  const x = 12 + Math.random() * (gameState.mapCols - 24);
  const y = 12 + Math.random() * (gameState.mapRows - 24);
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

function canConvertTrail(player) {
  const recent = player.trail.slice(-20);
  if (recent.length < 6) return false;

  let touch = 0;

  recent.forEach((key) => {
    const [row, col] = key.split(',').map(Number);
    const nearby = neighborsOf(row, col);
    nearby.forEach(([r, c]) => {
      const cell = gameState.grid[keyFor(r, c)];
      if (cell && cell.ownerId === player.id && cell.type === 'base') touch += 1;
    });
  });

  return touch >= Math.max(4, Math.ceil(recent.length * 0.35));
}

function convertTrailToBase(player) {
  const recent = player.trail.slice(-28);
  if (!recent.length) return;

  recent.forEach((key) => {
    const [row, col] = key.split(',').map(Number);
    const cell = gameState.grid[keyFor(row, col)];
    if (cell && cell.ownerId === player.id && cell.type === 'trail') {
      cell.type = 'base';
      cell.color = player.color;
    }
  });

  updateScore(player.id);
}

function evaluateDirection(bot, [dx, dy]) {
  const nextX = bot.x + dx * bot.speed;
  const nextY = bot.y + dy * bot.speed;

  if (nextX <= 0 || nextX >= gameState.mapCols || nextY <= 0 || nextY >= gameState.mapRows) {
    return -999;
  }

  const row = Math.floor(nextY);
  const col = Math.floor(nextX);
  const key = keyFor(row, col);
  const cell = gameState.grid[key];

  let score = 0;

  if (cell) {
    if (cell.ownerId === bot.id) {
      score -= 85;
      if (cell.type === 'base') score -= 15;
      if (cell.type === 'trail') score -= 40;
    } else {
      score -= 80;
      if (cell.type === 'base') score -= 25;
      if (cell.type === 'trail') score -= 35;
    }
  }

  const centralBias = Math.abs(row - gameState.mapRows / 2) + Math.abs(col - gameState.mapCols / 2);
  score += 20 - centralBias * 0.14;

  const borderPenalty = Math.min(nextX, nextY, gameState.mapCols - nextX, gameState.mapRows - nextY);
  if (borderPenalty < 3) score -= 30;

  Object.values(gameState.players).forEach((enemy) => {
    if (!enemy.alive || enemy.id === bot.id) return;
    const dist = Math.abs(enemy.x - nextX) + Math.abs(enemy.y - nextY);
    if (dist < 5) {
      score += 18;
    }
    if (dist < 2.2) {
      score += 35;
    }
  });

  return score;
}

function chooseBotDirection(bot) {
  let best = { dx: bot.vx || 1, dy: bot.vy || 0 };
  let bestScore = -Infinity;

  DIRECTIONS.forEach(([dx, dy]) => {
    const score = evaluateDirection(bot, [dx, dy]);
    if (score > bestScore) {
      bestScore = score;
      best = { dx, dy };
    }
  });

  return best;
}

function stepPlayer(player) {
  if (!player.alive) return;

  if (player.isBot) {
    const chosen = chooseBotDirection(player);
    player.vx = chosen.dx;
    player.vy = chosen.dy;
  }

  const moveX = player.x + player.vx * player.speed;
  const moveY = player.y + player.vy * player.speed;

  if (moveX <= 0 || moveX >= gameState.mapCols || moveY <= 0 || moveY >= gameState.mapRows) {
    killPlayer(player.id);
    return;
  }

  const nextRow = Math.floor(moveY);
  const nextCol = Math.floor(moveX);
  const nextKey = keyFor(nextRow, nextCol);
  const cell = gameState.grid[nextKey];

  if (cell && cell.ownerId !== player.id) {
    killPlayer(player.id, cell.ownerId || null);
    return;
  }

  if (player.lastTrailKey && player.trail.includes(nextKey) && nextKey !== player.lastTrailKey) {
    killPlayer(player.id);
    return;
  }

  player.x = moveX;
  player.y = moveY;
  player.trail.push(nextKey);
  player.lastTrailKey = nextKey;

  if (player.trail.length > 900) {
    player.trail.shift();
  }

  const headCell = gameState.grid[nextKey];
  if (!headCell || headCell.ownerId !== player.id) {
    setCell(nextRow, nextCol, 'trail', player.id, player.color);
  }

  if (canConvertTrail(player)) {
    convertTrailToBase(player);
  }

  updateScore(player.id);
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
  createSocketPlayer(ws);

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      const player = gameState.players[ws.id];
      if (!player || !player.alive || !data || data.type !== 'move') return;

      const dx = Number(data.dx || 0);
      const dy = Number(data.dy || 0);
      const len = Math.hypot(dx, dy);
      if (len === 0) return;

      player.vx = dx / len;
      player.vy = dy / len;
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
    createBot(name, COLORS[index % COLORS.length]);
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
  console.log(`🚀 Motor do Paper.io ativo em http://localhost:${PORT}`);
});

module.exports = { gameState, killPlayer, stepPlayer, convertTrailToBase };

