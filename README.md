const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const statusEl = document.getElementById('status');

const WORLD = { width: 2200, height: 2200, cell: 28 };
const keys = {};
const palette = ['#7ef2c4', '#7cc7ff', '#ffd166', '#ff9f70', '#d6a5ff', '#ff6b6b'];

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

function playTone(frequency = 420, duration = 0.06, volume = 0.03) {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  if (!state.audioCtx) {
    state.audioCtx = new AudioCtx();
  }

  const ctxAudio = state.audioCtx;
  const oscillator = ctxAudio.createOscillator();
  const gain = ctxAudio.createGain();

  oscillator.type = 'triangle';
  oscillator.frequency.value = frequency;
  gain.gain.value = volume;

  oscillator.connect(gain);
  gain.connect(ctxAudio.destination);

  oscillator.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + duration);
  oscillator.stop(ctxAudio.currentTime + duration);
}

function createPlayer() {
  const player = {
    x: WORLD.width / 2,
    y: WORLD.height / 2,
    radius: 18,
    baseSpeed: 230,
    speed: 230,
    color: '#7ef2c4',
    trail: [{ x: WORLD.width / 2, y: WORLD.height / 2 }],
    alive: true,
    territory: new Set(),
    heading: { x: 1, y: 0 },
  };

  for (let x = 0; x < WORLD.width; x += WORLD.cell) {
    for (let y = 0; y < WORLD.height; y += WORLD.cell) {
      player.territory.add(`${x},${y}`);
    }
  }

  return player;
}

function createBot() {
  const validRadius = 15 + Math.random() * 11;
  return {
    x: rand(80, WORLD.width - 80),
    y: rand(80, WORLD.height - 80),
    radius: validRadius,
    color: palette[Math.floor(Math.random() * palette.length)],
    speed: rand(112, 164),
    target: null,
    alive: true,
    trail: [],
  };
}

function pelletAt(x, y, value = 1, type = 'normal') {
  return {
    x,
    y,
    radius: type === 'bonus' ? 9 : 6,
    value,
    type,
  };
}

function spawnPellet(type = 'normal') {
  let attempts = 0;
  while (attempts < 200) {
    const x = rand(40, WORLD.width - 40);
    const y = rand(40, WORLD.height - 40);
    const tooCloseToPlayer = state.player && distance({ x, y }, state.player) < 120;
    const tooCloseToBots = state.bots.some((bot) => distance({ x, y }, bot) < 90);
    if (!tooCloseToPlayer && !tooCloseToBots) {
      return pelletAt(x, y, type === 'bonus' ? 4 : 1, type);
    }
    attempts += 1;
  }
  return pelletAt(rand(40, WORLD.width - 40), rand(40, WORLD.height - 40), type === 'bonus' ? 4 : 1, type);
}

function resetPellets() {
  state.pellets = Array.from({ length: 180 }, () => spawnPellet('normal'));
  state.bonus = null;
}

function resetBots() {
  state.bots = Array.from({ length: 7 }, () => createBot());
}

function updateHud() {
  scoreEl.textContent = String(state.score);
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('paperpix-best', String(state.best));
  }
  bestEl.textContent = String(state.best);
}

function setStatus(text, color = '#7ef2c4') {
  statusEl.textContent = text;
  statusEl.style.color = color;
}

function resetGame() {
  state.player = createPlayer();
  state.score = 0;
  state.started = true;
  state.gameOver = false;
  state.pellets = [];
  state.bonus = null;
  resetPellets();
  resetBots();
  updateHud();
  setStatus('Em jogo', '#7ef2c4');
}

function endGame(reason) {
  state.gameOver = true;
  state.started = false;
  setStatus(reason, '#ff6b6b');
  playTone(140, 0.2, 0.08);
}

function cellKey(x, y) {
  const cx = Math.floor(x / WORLD.cell);
  const cy = Math.floor(y / WORLD.cell);
  return `${cx},${cy}`;
}

function updatePlayer(dt) {
  const player = state.player;
  const input = getInputVector();
  const speedBoost = player.radius > 32 ? 0.9 : 1;

  player.heading.x = input.x;
  player.heading.y = input.y;

  player.x += input.x * player.baseSpeed * speedBoost * dt;
  player.y += input.y * player.baseSpeed * speedBoost * dt;
  player.x = wrap(player.x, WORLD.width);
  player.y = wrap(player.y, WORLD.height);

  if (player.trail.length === 0 || distance(player, player.trail[player.trail.length - 1]) > 7) {
    player.trail.push({ x: player.x, y: player.y });
    if (player.trail.length > 2500) {
      player.trail.shift();
    }
  }

  for (let i = 0; i < player.trail.length - 10; i += 1) {
    if (distance(player, player.trail[i]) < player.radius + 7) {
      endGame('Você bateu no próprio rastro!');
      return;
    }
  }

  for (let i = state.pellets.length - 1; i >= 0; i -= 1) {
    const pellet = state.pellets[i];
    if (distance(player, pellet) < player.radius + pellet.radius + 1) {
      player.radius = clamp(player.radius + 0.16 * pellet.value * 1.6, 16, 52);
      state.score += pellet.value;
      state.pellets.splice(i, 1);
      state.pellets.push(spawnPellet('normal'));
      if (Math.random() < 0.12) {
        state.bonus = spawnPellet('bonus');
      }
      updateHud();
      playTone(760, 0.04, 0.04);
    }
  }

  if (state.bonus && distance(player, state.bonus) < player.radius + state.bonus.radius + 3) {
    state.score += state.bonus.value;
    player.radius = clamp(player.radius + 1.8, 16, 52);
    state.bonus = null;
    updateHud();
    playTone(980, 0.08, 0.05);
  }

  for (const bot of state.bots) {
    if (bot.alive && distance(player, bot) < player.radius + bot.radius) {
      endGame('Um rival te derrubou!');
      return;
    }
  }

  for (const bot of state.bots) {
    if (!bot.alive) continue;
    for (let i = 0; i < bot.trail.length; i += 1) {
      if (distance(player, bot.trail[i]) < player.radius + 7) {
        endGame('Você colidiu com um rastro!');
        return;
      }
    }
  }

  const territoryKey = cellKey(player.x, player.y);
  player.territory.add(territoryKey);
}

function getNearestPellet(entity) {
  let target = null;
  let bestDistance = Infinity;

  for (const pellet of state.pellets) {
    const d = distance(entity, pellet);
    if (d < bestDistance) {
      target = pellet;
      bestDistance = d;
    }
  }

  if (state.bonus) {
    const d = distance(entity, state.bonus);
    if (d < bestDistance * 0.75) {
      target = state.bonus;
    }
  }

  return target;
}

function updateBot(bot, dt) {
  if (!bot.alive) return;

  const target = getNearestPellet(bot) || { x: state.player.x, y: state.player.y };
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const length = Math.hypot(dx, dy) || 1;

  bot.x += (dx / length) * bot.speed * dt;
  bot.y += (dy / length) * bot.speed * dt;
  bot.x = wrap(bot.x, WORLD.width);
  bot.y = wrap(bot.y, WORLD.height);

  if (distance(bot, target) < bot.radius + 8) {
    for (let i = state.pellets.length - 1; i >= 0; i -= 1) {
      const pellet = state.pellets[i];
      if (distance(bot, pellet) < bot.radius + pellet.radius + 2) {
        state.pellets.splice(i, 1);
        state.pellets.push(spawnPellet('normal'));
        bot.radius = clamp(bot.radius + 0.22, 12, 48);
        break;
      }
    }
    if (state.bonus && distance(bot, state.bonus) < bot.radius + state.bonus.radius + 2) {
      bot.radius = clamp(bot.radius + 0.8, 12, 48);
      state.bonus = null;
    }
  }

  bot.trail.push({ x: bot.x, y: bot.y });
  if (bot.trail.length > 200) {
    bot.trail.shift();
  }

  if (state.player) {
    if (distance(bot, state.player) < bot.radius + state.player.radius + 6) {
      bot.alive = false;
      state.bots = state.bots.filter((item) => item.alive);
      if (state.bots.length < 7) {
        state.bots.push(createBot());
      }
    }
  }

  for (const ownPoint of bot.trail.slice(0, -8)) {
    if (distance(bot, ownPoint) < bot.radius + 8) {
      bot.alive = false;
      break;
    }
  }

  for (const otherBot of state.bots) {
    if (otherBot === bot || !otherBot.alive) continue;
    for (const point of otherBot.trail) {
      if (distance(bot, point) < bot.radius + 8) {
        bot.alive = false;
        break;
      }
    }
    if (!bot.alive) break;
  }
}

function updateBonus(dt) {
  if (state.bonus) return;
  state.bonus = spawnPellet('bonus');
}

function drawGrid() {
  const offsetX = state.cameraX;
  const offsetY = state.cameraY;

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;

  const startX = Math.floor(offsetX / WORLD.cell) * WORLD.cell;
  const startY = Math.floor(offsetY / WORLD.cell) * WORLD.cell;

  for (let x = startX; x < offsetX + canvas.width + WORLD.cell; x += WORLD.cell) {
    ctx.beginPath();
    ctx.moveTo(x - offsetX, 0);
    ctx.lineTo(x - offsetX, canvas.height);
    ctx.stroke();
  }

  for (let y = startY; y < offsetY + canvas.height + WORLD.cell; y += WORLD.cell) {
    ctx.beginPath();
    ctx.moveTo(0, y - offsetY);
    ctx.lineTo(canvas.width, y - offsetY);
    ctx.stroke();
  }
}

function drawTerritory() {
  const player = state.player;
  if (!player) return;

  ctx.fillStyle = 'rgba(126, 242, 196, 0.12)';
  for (const key of player.territory) {
    const [cellX, cellY] = key.split(',').map(Number);
    const x = cellX * WORLD.cell - state.cameraX;
    const y = cellY * WORLD.cell - state.cameraY;
    if (x < -WORLD.cell || y < -WORLD.cell || x > canvas.width + WORLD.cell || y > canvas.height + WORLD.cell) continue;
    ctx.fillRect(x, y, WORLD.cell, WORLD.cell);
  }
}

function drawPellet(pellet) {
  const x = pellet.x - state.cameraX;
  const y = pellet.y - state.cameraY;
  ctx.beginPath();
  ctx.fillStyle = pellet.type === 'bonus' ? '#ffd166' : '#f7f7d2';
  ctx.arc(x, y, pellet.radius, 0, Math.PI * 2);
  ctx.fill();

  if (pellet.type === 'bonus') {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.arc(x, y, pellet.radius + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawTrail(points, color, width) {
  if (points.length < 2) return;

  ctx.beginPath();
  const first = points[0];
  ctx.moveTo(first.x - state.cameraX, first.y - state.cameraY);

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
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
    ctx.fillStyle = '#dffdf6';
    ctx.arc(x + entity.radius * 0.35, y - entity.radius * 0.3, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function updateCamera() {
  const player = state.player;
  if (!player) return;

  state.cameraX = clamp(player.x - canvas.width / 2, 0, WORLD.width - canvas.width);
  state.cameraY = clamp(player.y - canvas.height / 2, 0, WORLD.height - canvas.height);
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
      drawTrail(bot.trail, bot.color, Math.max(12, bot.radius * 1.6));
    }
  }

  if (state.player.alive) {
    drawTrail(state.player.trail, '#7ef2c4', Math.max(12, state.player.radius * 1.9));
    drawEntity(state.player, true);
  }

  for (const bot of state.bots) {
    if (bot.alive) {
      drawEntity(bot, false);
    }
  }

  if (!state.started && !state.gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f3fffc';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px Arial';
    ctx.fillText('Paper Pix Arena', canvas.width / 2, canvas.height / 2 - 20);
    ctx.font = '22px Arial';
    ctx.fillText('Aperte espaço para começar', canvas.width / 2, canvas.height / 2 + 24);
  }

  if (state.gameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 46px Arial';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
    ctx.font = '22px Arial';
    ctx.fillText('Espaço para reiniciar', canvas.width / 2, canvas.height / 2 + 26);
  }
}

function tick(timestamp) {
  const dt = Math.min((timestamp - state.lastTime) / 1000 || 0.016, 0.033);
  state.lastTime = timestamp;

  if (state.started && !state.gameOver) {
    updatePlayer(dt);
    updateBonus(dt);
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

  if (event.key === ' ') {
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

function bindMobileButtons() {
  const buttons = document.querySelectorAll('.dir-btn');
  buttons.forEach((button) => {
    const direction = button.dataset.key;
    const key = direction.toLowerCase();

    button.addEventListener('pointerdown', () => {
      keys[key] = true;
    });

    const release = () => {
      keys[key] = false;
    };

    button.addEventListener('pointerup', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('pointercancel', release);
  });
}

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);
bindMobileButtons();
state.player = createPlayer();
resetPellets();
resetBots();
setStatus('Aguardando', '#7ef2c4');
requestAnimationFrame(tick);
