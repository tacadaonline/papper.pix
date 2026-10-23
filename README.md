const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const statusEl = document.getElementById('status');

const WORLD = { width: 2200, height: 2200, cellSize: 28 };
const keys = {};
const palette = ['#7cf0c4', '#7ec7ff', '#ffd166', '#ff9f70', '#d8b4ff', '#ff7a7a'];

const state = {
  started: false,
  gameOver: false,
  lastTime: 0,
  score: 0,
  best: Number(localStorage.getItem('paperpix-best') || 0),
  pellets: [],
  bonus: null,
  bots: [],
  player: null,
  cameraX: 0,
  cameraY: 0,
  audioCtx: null,
  messageTimer: 0,
};

bestEl.textContent = String(state.best);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function wrap(value, limit) {
  if (value < 0) return limit;
  if (value > limit) return 0;
  return value;
}

function setStatus(text, color = '#7cf0c4') {
  statusEl.textContent = text;
  statusEl.style.color = color;
}

function playTone(freq = 520, duration = 0.06, volume = 0.04) {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;

  if (!state.audioCtx) {
    state.audioCtx = new AudioCtor();
  }

  const audioCtx = state.audioCtx;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  oscillator.type = 'triangle';
  oscillator.frequency.value = freq;
  gain.gain.value = volume;

  oscillator.connect(gain);
  gain.connect(audioCtx.destination);

  oscillator.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  oscillator.stop(audioCtx.currentTime + duration);
}

function getInputVector() {
  let x = 0;
  let y = 0;

  if (keys.w || keys.arrowup) y -= 1;
  if (keys.s || keys.arrowdown) y += 1;
  if (keys.a || keys.arrowleft) x -= 1;
  if (keys.d || keys.arrowright) x += 1;

  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function createPlayer() {
  return {
    x: WORLD.width / 2,
    y: WORLD.height / 2,
    radius: 18,
    speed: 210,
    color: '#7cf0c4',
    trail: [{ x: WORLD.width / 2, y: WORLD.height / 2 }],
    alive: true,
    territory: new Set(),
    heading: { x: 1, y: 0 },
  };
}

function createBot() {
  const radius = 14 + Math.random() * 10;
  return {
    x: rand(80, WORLD.width - 80),
    y: rand(80, WORLD.height - 80),
    radius,
    color: palette[Math.floor(Math.random() * palette.length)],
    speed: rand(110, 165),
    alive: true,
    trail: [],
    target: null,
    drift: rand(0, Math.PI * 2),
  };
}

function pelletAt(x, y, value = 1, type = 'normal') {
  return {
    x,
    y,
    radius: type === 'bonus' ? 11 : 7,
    value,
    type,
  };
}

function spawnPellet(type = 'normal') {
  let attempts = 0;

  while (attempts < 220) {
    const x = rand(45, WORLD.width - 45);
    const y = rand(45, WORLD.height - 45);

    const tooCloseToPlayer = state.player && distance({ x, y }, state.player) < 150;
    const tooCloseToBot = state.bots.some((bot) => distance({ x, y }, bot) < 120);

    if (!tooCloseToPlayer && !tooCloseToBot) {
      return pelletAt(x, y, type === 'bonus' ? 4 : 1, type);
    }

    attempts += 1;
  }

  return pelletAt(rand(40, WORLD.width - 40), rand(40, WORLD.height - 40), type === 'bonus' ? 4 : 1, type);
}

function resetPellets() {
  state.pellets = Array.from({ length: 185 }, () => spawnPellet('normal'));
  state.bonus = null;
}

function resetBots() {
  state.bots = Array.from({ length: 8 }, () => createBot());
}

function updateHud() {
  scoreEl.textContent = String(state.score);
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('paperpix-best', String(state.best));
  }
  bestEl.textContent = String(state.best);
}

function resetGame() {
  state.player = createPlayer();
  state.score = 0;
  state.started = true;
  state.gameOver = false;
  state.messageTimer = 0;
  resetPellets();
  resetBots();
  updateHud();
  setStatus('Em jogo', '#7cf0c4');
}

function endGame(reason) {
  state.gameOver = true;
  state.started = false;
  setStatus(reason, '#ff6b6b');
  playTone(150, 0.22, 0.06);
}

function cellKey(x, y) {
  return `${Math.floor(x / WORLD.cellSize)},${Math.floor(y / WORLD.cellSize)}`;
}

function isInsidePlayerTrail(entity) {
  const trail = entity.trail || [];
  for (let i = 0; i < trail.length; i += 1) {
    if (distance(entity, trail[i]) < entity.radius + 7) {
      return true;
    }
  }
  return false;
}

function updatePlayer(dt) {
  const player = state.player;
  const input = getInputVector();
  const speedFactor = clamp(1.2 - player.radius / 120, 0.55, 1.0);

  player.heading.x = input.x;
  player.heading.y = input.y;

  player.x += input.x * player.speed * speedFactor * dt;
  player.y += input.y * player.speed * speedFactor * dt;
  player.x = wrap(player.x, WORLD.width);
  player.y = wrap(player.y, WORLD.height);

  if (player.trail.length === 0 || distance(player, player.trail[player.trail.length - 1]) > 8) {
    player.trail.push({ x: player.x, y: player.y });
    if (player.trail.length > 2200) {
      player.trail.shift();
    }
  }

  const territoryKey = cellKey(player.x, player.y);
  player.territory.add(territoryKey);

  for (let i = 0; i < player.trail.length - 12; i += 1) {
    if (distance(player, player.trail[i]) < player.radius + 7) {
      endGame('Você bateu no próprio rastro!');
      return;
    }
  }

  for (let i = state.pellets.length - 1; i >= 0; i -= 1) {
    const pellet = state.pellets[i];
    if (distance(player, pellet) < player.radius + pellet.radius + 2) {
      state.score += pellet.value;
      state.pellets.splice(i, 1);
      state.pellets.push(spawnPellet('normal'));
      player.radius = clamp(player.radius + 0.4 * pellet.value, 18, 54);
      updateHud();
      playTone(900, 0.05, 0.04);
    }
  }

  if (state.bonus && distance(player, state.bonus) < player.radius + state.bonus.radius + 3) {
    state.score += state.bonus.value;
    state.bonus = null;
    player.radius = clamp(player.radius + 2.6, 18, 54);
    updateHud();
    playTone(1200, 0.08, 0.06);
  }

  for (const bot of state.bots) {
    if (!bot.alive) continue;
    if (distance(player, bot) < player.radius + bot.radius + 4) {
      endGame('Um rival te derrubou!');
      return;
    }

    for (let i = 0; i < bot.trail.length; i += 1) {
      if (distance(player, bot.trail[i]) < player.radius + 7) {
        endGame('Você encostou em um rastro inimigo!');
        return;
      }
    }
  }
}

function getNearestObjective(entity) {
  let target = null;
  let bestDistance = Infinity;

  for (const pellet of state.pellets) {
    const d = distance(entity, pellet);
    if (d < bestDistance) {
      bestDistance = d;
      target = pellet;
    }
  }

  if (state.bonus) {
    const d = distance(entity, state.bonus);
    if (d < bestDistance * 0.7) {
      target = state.bonus;
    }
  }

  if (!target) {
    return { x: rand(100, WORLD.width - 100), y: rand(100, WORLD.height - 100) };
  }

  return target;
}

function updateBot(bot, dt) {
  if (!bot.alive) return;

  const objective = getNearestObjective(bot);
  const dx = objective.x - bot.x;
  const dy = objective.y - bot.y;
  const length = Math.hypot(dx, dy) || 1;

  bot.x += (dx / length) * bot.speed * dt;
  bot.y += (dy / length) * bot.speed * dt;
  bot.x = wrap(bot.x, WORLD.width);
  bot.y = wrap(bot.y, WORLD.height);

  const lastPoint = bot.trail[bot.trail.length - 1];
  if (!lastPoint || distance(bot, lastPoint) > 9) {
    bot.trail.push({ x: bot.x, y: bot.y });
    if (bot.trail.length > 1000) {
      bot.trail.shift();
    }
  }

  if (state.player && distance(bot, state.player) < bot.radius + state.player.radius + 5) {
    bot.alive = false;
    if (state.bots.every((opponent) => !opponent.alive)) {
      state.bots = Array.from({ length: 8 }, () => createBot());
    }
    return;
  }

  for (let i = 0; i < bot.trail.length - 8; i += 1) {
    if (distance(bot, bot.trail[i]) < bot.radius + 7) {
      bot.alive = false;
      return;
    }
  }

  for (const pellet of state.pellets) {
    if (distance(bot, pellet) < bot.radius + pellet.radius + 2) {
      state.pellets = state.pellets.filter((item) => item !== pellet);
      state.pellets.push(spawnPellet('normal'));
      bot.radius = clamp(bot.radius + 0.2, 14, 48);
      break;
    }
  }

  if (state.bonus && distance(bot, state.bonus) < bot.radius + state.bonus.radius + 2) {
    bot.radius = clamp(bot.radius + 0.8, 14, 48);
    state.bonus = null;
  }
}

function updateBonus() {
  if (!state.bonus && Math.random() < 0.012) {
    state.bonus = spawnPellet('bonus');
  }
}

function updateCamera() {
  const player = state.player;
  if (!player) return;

  state.cameraX = clamp(player.x - canvas.width / 2, 0, WORLD.width - canvas.width);
  state.cameraY = clamp(player.y - canvas.height / 2, 0, WORLD.height - canvas.height);
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;

  const startX = Math.floor(state.cameraX / WORLD.cellSize) * WORLD.cellSize;
  const startY = Math.floor(state.cameraY / WORLD.cellSize) * WORLD.cellSize;

  for (let x = startX; x < state.cameraX + canvas.width + WORLD.cellSize; x += WORLD.cellSize) {
    ctx.beginPath();
    ctx.moveTo(x - state.cameraX, 0);
    ctx.lineTo(x - state.cameraX, canvas.height);
    ctx.stroke();
  }

  for (let y = startY; y < state.cameraY + canvas.height + WORLD.cellSize; y += WORLD.cellSize) {
    ctx.beginPath();
    ctx.moveTo(0, y - state.cameraY);
    ctx.lineTo(canvas.width, y - state.cameraY);
    ctx.stroke();
  }
}

function drawTerritory() {
  if (!state.player) return;
  const player = state.player;

  ctx.fillStyle = 'rgba(124, 240, 196, 0.12)';
  for (const key of player.territory) {
    const [cellX, cellY] = key.split(',').map(Number);
    const x = cellX * WORLD.cellSize - state.cameraX;
    const y = cellY * WORLD.cellSize - state.cameraY;
    if (x < -WORLD.cellSize || x > canvas.width + WORLD.cellSize || y < -WORLD.cellSize || y > canvas.height + WORLD.cellSize) {
      continue;
    }
    ctx.fillRect(x, y, WORLD.cellSize, WORLD.cellSize);
  }
}

function drawPellet(pellet) {
  const x = pellet.x - state.cameraX;
  const y = pellet.y - state.cameraY;

  ctx.beginPath();
  ctx.fillStyle = pellet.type === 'bonus' ? '#ffd166' : '#f3f6d8';
  ctx.arc(x, y, pellet.radius, 0, Math.PI * 2);
  ctx.fill();

  if (pellet.type === 'bonus') {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.arc(x, y, pellet.radius + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawTrail(trail, color, width) {
  if (trail.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(trail[0].x - state.cameraX, trail[0].y - state.cameraY);

  for (let i = 1; i < trail.length; i += 1) {
    const point = trail[i];
    ctx.lineTo(point.x - state.cameraX, point.y - state.cameraY);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawEntity(entity, isPlayer = false) {
  const x = entity.x - state.cameraX;
  const y = entity.y - state.cameraY;

  ctx.beginPath();
  ctx.fillStyle = entity.color;
  ctx.arc(x, y, entity.radius, 0, Math.PI * 2);
  ctx.fill();

  if (isPlayer) {
    ctx.beginPath();
    ctx.fillStyle = '#e9fff8';
    ctx.arc(x + entity.radius * 0.32, y - entity.radius * 0.3, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!state.player) return;

  updateCamera();
  drawGrid();
  drawTerritory();

  for (const pellet of state.pellets) {
    drawPellet(pellet);
  }

  if (state.bonus) {
    drawPellet(state.bonus);
  }

  for (const bot of state.bots) {
    if (bot.alive) {
      drawTrail(bot.trail, bot.color, Math.max(10, bot.radius * 1.4));
    }
  }

  if (state.player.alive) {
    drawTrail(state.player.trail, '#7cf0c4', Math.max(10, state.player.radius * 1.7));
    drawEntity(state.player, true);
  }

  for (const bot of state.bots) {
    if (bot.alive) {
      drawEntity(bot, false);
    }
  }

  if (!state.started && !state.gameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f2fff9';
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px Arial';
    ctx.fillText('Paper Pix Premium', canvas.width / 2, canvas.height / 2 - 18);
    ctx.font = '22px Arial';
    ctx.fillText('Aperte espaço para começar', canvas.width / 2, canvas.height / 2 + 26);
  }

  if (state.gameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 46px Arial';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 18);
    ctx.font = '22px Arial';
    ctx.fillText('Espaço para reiniciar', canvas.width / 2, canvas.height / 2 + 24);
  }
}

function tick(timestamp) {
  const dt = Math.min((timestamp - state.lastTime) / 1000 || 0.016, 0.033);
  state.lastTime = timestamp;

  if (state.started && !state.gameOver) {
    updatePlayer(dt);
    updateBonus();
    for (const bot of state.bots) {
      updateBot(bot, dt);
    }
  }

  render();
  requestAnimationFrame(tick);
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase();
  keys[key] = true;

  if (event.code === 'Space') {
    event.preventDefault();
    if (!state.started || state.gameOver) {
      resetGame();
    }
  }
}

function handleKeyUp(event) {
  const key = event.key.toLowerCase();
  keys[key] = false;
}

function bindMobileControls() {
  const buttons = document.querySelectorAll('.dir-btn');
  buttons.forEach((button) => {
    const key = button.dataset.key.toLowerCase();

    const pointerDown = () => {
      keys[key] = true;
    };

    const release = () => {
      keys[key] = false;
    };

    button.addEventListener('pointerdown', pointerDown);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('pointercancel', release);
  });
}

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);
bindMobileControls();

state.player = createPlayer();
resetPellets();
resetBots();
setStatus('Pronto', '#7cf0c4');
requestAnimationFrame(tick);
