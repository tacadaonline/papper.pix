const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const MAP_ROWS = 80;
const MAP_COLS = 80;
const TICK_MS = 90;
const PLAYER_SPEED = 0.95;
const BOT_SPEED = 0.86;

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
  blockSize: 20,
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

function makeId() {
  return '_' + Math.random().toString(36).slice(2, 10);
}

function setCell(row, col, kind, ownerId, color) {
  if (!inBounds(row, col)) return;
  gameState.grid[keyFor(row, col)] = { kind, ownerId, color };
}

function clearOwnerCells(ownerId) {
  Object.keys(gameState.grid).forEach((key) => {
    const cell = gameState.grid[key];
    if (cell && cell.ownerId === ownerId) delete gameState.grid[key];
  });
}

function countOwnedBaseCells(playerId) {
  let total = 0;
  Object.values(gameState.grid).forEach((cell) => {
    if (cell.ownerId === playerId && cell.kind === 'base') total += 1;
  });
  return total;
}

function updatePlayerScore(playerId) {
  const player = gameState.players[playerId];
  if (!player) return;
  player.score = countOwnedBaseCells(playerId);
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
    score: 0,
    balance: 50,
    trail: [],
    lastDecisionAt: 0
  };

  gameState.players[id] = player;
  createInitialBase(id, color, x, y);
  updatePlayerScore(id);
  return player;
}

function createSocketPlayer(ws) {
  const id = makeId();
  const x = 15 + Math.random() * 20;
  const y = 15 + Math.random() * 20;
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
  const x = 20 + Math.random() * (gameState.mapCols - 40);
  const y = 20 + Math.random() * (gameState.mapRows - 40);
  registerPlayer({ id: name, name, color, isBot: true, x, y });
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function trailHitsPoint(trail, headX, headY, threshold = 0.82) {
  if (!trail || trail.length < 4) return false;

  for (let i = 1; i < trail.length; i++) {
    const prev = trail[i - 1];
    const next = trail[i];
    const dist = distToSegment(headX, headY, prev.x, prev.y, next.x, next.y);
    if (dist < threshold) return true;
  }

  return false;
}

function playerHitsOwnTrail(player, headX, headY) {
  if (player.trail.length < 6) return false;
  return trailHitsPoint(player.trail.slice(0, -1), headX, headY, 0.8);
}

function playerHitsEnemyTrail(player, headX, headY) {
  for (const other of Object.values(gameState.players)) {
    if (!other || other.id === player.id || !other.alive || other.trail.length < 6) continue;
    if (trailHitsPoint(other.trail.slice(0, -1), headX, headY, 0.82)) {
      return other.id;
    }
  }
  return null;
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
    killer.score = (killer.score || 0) + 10;
    killer.balance = Number((killer.balance + 6).toFixed(2));
  }

  gameState.pot += player.isBot ? 2.5 : 4;
}

function setTrailCell(player, x, y) {
  const row = Math.floor(y);
  const col = Math.floor(x);
  if (!inBounds(row, col)) return;

  const key = keyFor(row, col);
  const existing = gameState.grid[key];
  if (!existing || existing.ownerId !== player.id) {
    setCell(row, col, 'trail', player.id, player.color);
  }
}

function floodConvertConnectedTrail(player) {
  const queue = [];
  const visited = new Set();

  Object.keys(gameState.grid).forEach((key) => {
    const cell = gameState.grid[key];
    if (cell && cell.ownerId === player.id && cell.kind === 'base') {
      const [row, col] = key.split(',').map(Number);
      queue.push({ row, col });
    }
  });

  if (!queue.length) return;

  while (queue.length > 0) {
    const current = queue.shift();
    const key = keyFor(current.row, current.col);
    if (visited.has(key)) continue;
    visited.add(key);

    const neighbours = [
      [1, 0], [-1, 0], [0, 1], [0, -1]
    ];

    for (const [dr, dc] of neighbours) {
      const nr = current.row + dr;
      const nc = current.col + dc;
      if (!inBounds(nr, nc)) continue;

      const nKey = keyFor(nr, nc);
      const nextCell = gameState.grid[nKey];
      if (!nextCell || nextCell.ownerId !== player.id || nextCell.kind !== 'trail') continue;

      nextCell.kind = 'base';
      nextCell.color = player.color;
      queue.push({ row: nr, col: nc });
    }
  }

  updatePlayerScore(player.id);
}

function canConvertTrail(player) {
  if (player.trail.length < 12) return false;

  const recent = player.trail.slice(-18);
  let touchingBase = 0;

  for (const point of recent) {
    const row = Math.floor(point.y);
    const col = Math.floor(point.x);

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (!inBounds(r, c)) continue;
        const cell = gameState.grid[keyFor(r, c)];
        if (cell && cell.ownerId === player.id && cell.kind === 'base') touchingBase += 1;
      }
    }
  }

  return touchingBase >= 4;
}

function chooseBotDirection(bot) {
  const candidates = [
    [1,0], [-1,0], [0,1], [0,-1],
    [1,1], [1,-1], [-1,1], [-1,-1]
  ];

  let best = { dx: 1, dy: 0 };
  let bestScore = -Infinity;

  for (const [dx, dy] of candidates) {
    const nextX = bot.x + dx * bot.speed;
    const nextY = bot.y + dy * bot.speed;

    if (nextX <= 0 || nextX >= gameState.mapCols || nextY <= 0 || nextY >= gameState.mapRows) {
      continue;
    }

    let score = 0;
    const row = Math.floor(nextY);
    const col = Math.floor(nextX);
    const cell = gameState.grid[keyFor(row, col)];

    if (cell) {
      if (cell.ownerId === bot.id) score -= 70;
      else score -= 100;
    }

    Object.values(gameState.players).forEach((other) => {
      if (!other || other.id === bot.id || !other.alive) return;
      const dist = Math.hypot(other.x - nextX, other.y - nextY);
      if (dist < 5) score += 22;
      if (dist < 2.5) score += 32;
    });

    const centerBias = Math.abs(row - gameState.mapRows / 2) + Math.abs(col - gameState.mapCols / 2);
    score += 18 - centerBias * 0.12;

    if (score > bestScore) {
      bestScore = score;
      best = { dx, dy };
    }
  }

  return best;
}

function stepPlayer(player) {
  if (!player.alive) return;

  if (player.isBot) {
    const dir = chooseBotDirection(player);
    player.vx = dir.dx;
    player.vy = dir.dy;
  }

  const len = Math.hypot(player.vx, player.vy);
  if (len === 0) return;

  const nextX = player.x + (player.vx / len) * player.speed;
  const nextY = player.y + (player.vy / len) * player.speed;

  if (nextX <= 0 || nextX >= gameState.mapCols || nextY <= 0 || nextY >= gameState.mapRows) {
    killPlayer(player.id);
    return;
  }

  const row = Math.floor(nextY);
  const col = Math.floor(nextX);
  const headKey = keyFor(row, col);
  const cellAtHead = gameState.grid[headKey];

  if (cellAtHead && cellAtHead.ownerId !== player.id) {
    killPlayer(player.id, cellAtHead.ownerId || null);
    return;
  }

  if (playerHitsOwnTrail(player, nextX, nextY)) {
    killPlayer(player.id);
    return;
  }

  const enemyId = playerHitsEnemyTrail(player, nextX, nextY);
  if (enemyId) {
    killPlayer(player.id, enemyId);
    return;
  }

  player.x = nextX;
  player.y = nextY;
  player.trail.push({ x: player.x, y: player.y });

  if (player.trail.length > 1600) {
    player.trail.shift();
  }

  setTrailCell(player, player.x, player.y);

  if (canConvertTrail(player)) {
    floodConvertConnectedTrail(player);
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
  console.log(`🚀 Motor do jogo em http://localhost:${PORT}`);
});

module.exports = { gameState, killPlayer, stepPlayer, floodConvertConnectedTrail };

