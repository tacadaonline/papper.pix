const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const statusEl = document.getElementById('status');

const WORLD = { width: 2600, height: 1800 };
const keys = {};
const palette = ['#5ef2c2', '#ff9f43', '#c77dff', '#ff6b6b', '#ffd166', '#80ed99'];

const state = {
  player: null,
  bots: [],
  dots: [],
  lastTime: 0,
  score: 0,
  best: Number(localStorage.getItem('paperpix-best') || 0),
  gameOver: false,
  started: false,
};

bestEl.textContent = state.best;

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

function dotAt(x, y, radius = 5) {
  return { x, y, radius };
}

function createPlayer() {
  return {
    x: WORLD.width / 2,
    y: WORLD.height / 2,
    radius: 12,
    speed: 175,
    color: '#5ef2c2',
    trail: [],
    score: 0,
    alive: true,
    vx: 0,
    vy: 0,
  };
}

function createBot() {
  const x = rand(60, WORLD.width - 60);
  const y = rand(60, WORLD.height - 60);
  const color = palette[Math.floor(Math.random() * palette.length)];

  return {
    x,
    y,
    radius: 12,
    speed: rand(120, 150),
    color,
    trail: [],
    alive: true,
    target: null,
    owner: 'bot',
  };
}

function spawnDot() {
  const x = rand(30, WORLD.width - 30);
  const y = rand(30, WORLD.height - 30);
  return dotAt(x, y, 4 + Math.random() * 2);
}

function resetDots() {
  state.dots = Array.from({ length: 72 }, () => spawnDot());
}

function resetGame() {
  state.player = createPlayer();
  state.player.trail.push({ x: state.player.x, y: state.player.y });
  state.bots = Array.from({ length: 6 }, () => createBot());
  state.dots = Array.from({ length: 72 }, () => spawnDot());
  state.score = 0;
  state.gameOver = false;
  state.started = true;
  statusEl.textContent = 'Em jogo';
  statusEl.style.color = '#5ef2c2';
  scoreEl.textContent = '0';
}

function updateHud() {
  scoreEl.textContent = String(state.score);
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('paperpix-best', String(state.best));
    bestEl.textContent = String(state.best);
  }
}

function endGame(message) {
  state.gameOver = true;
  statusEl.textContent = message;
  statusEl.style.color = '#ff6b6b';
}

function getInputVector() {
  let x = 0;
  let y = 0;

  if (keys['arrowup'] || keys['w']) y -= 1;
  if (keys['arrowdown'] || keys['s']) y += 1;
  if (keys['arrowleft'] || keys['a']) x -= 1;
  if (keys['arrowright'] || keys['d']) x += 1;

  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function updatePlayer(dt) {
  const player = state.player;
  const direction = getInputVector();

  player.vx = direction.x * player.speed;
  player.vy = direction.y * player.speed;

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  player.x = wrap(player.x, WORLD.width);
  player.y = wrap(player.y, WORLD.height);

  const lastTrail = player.trail[player.trail.length - 1];
  if (!lastTrail || distance(player, lastTrail) > 5) {
    player.trail.push({ x: player.x, y: player.y });
    if (player.trail.length > 1000) {
      player.trail.shift();
    }
  }

  for (let i = 0; i < player.trail.length - 6; i += 1) {
    const point = player.trail[i];
    if (distance(player, point) < player.radius + 4) {
      endGame('Você bateu no próprio rastro!');
      return;
    }
  }

  for (let i = state.dots.length - 1; i >= 0; i -= 1) {
    const dot = state.dots[i];
    if (distance(player, dot) < player.radius + dot.radius + 2) {
      state.dots.splice(i, 1);
      state.dots.push(spawnDot());
      state.score += 1;
      updateHud();
    }
  }

  for (const bot of state.bots) {
    if (!bot.alive) continue;
    if (distance(player, bot) < player.radius + bot.radius) {
      endGame('Você foi atingido por um rival!');
      return;
    }
  }
}

function getNearestDot(entity) {
  let target = null;
  let shortest = Infinity;

  for (const dot of state.dots) {
    const d = distance(entity, dot);
    if (d < shortest) {
      shortest = d;
      target = dot;
    }
  }

  return target;
}

function updateBot(bot, dt) {
  if (!bot.alive) return;

  const target = bot.target || getNearestDot(bot);
  if (target) {
    bot.target = target;
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    const distTotal = Math.hypot(dx, dy) || 1;
    bot.x += (dx / distTotal) * bot.speed * dt;
    bot.y += (dy / distTotal) * bot.speed * dt;
  }

  bot.x = wrap(bot.x, WORLD.width);
  bot.y = wrap(bot.y, WORLD.height);

  const lastTrail = bot.trail[bot.trail.length - 1];
  if (!lastTrail || distance(bot, lastTrail) > 7) {
    bot.trail.push({ x: bot.x, y: bot.y });
    if (bot.trail.length > 900) {
      bot.trail.shift();
    }
  }

  for (const trail of state.player.trail) {
    if (distance(bot, trail) < bot.radius + 5) {
      bot.alive = false;
      return;
    }
  }

  for (const rival of state.bots) {
    if (rival === bot || !rival.alive) continue;
    for (const trail of rival.trail) {
      if (distance(bot, trail) < bot.radius + 5) {
        bot.alive = false;
        return;
      }
    }
  }

  for (const trail of bot.trail.slice(0, -4)) {
    if (distance(bot, trail) < bot.radius + 4) {
      bot.alive = false;
      return;
    }
  }
}

function drawWorldBackground() {
  const cameraX = state.player.x - canvas.width / 2;
  const cameraY = state.player.y - canvas.height / 2;

  ctx.fillStyle = '#0d2020';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;

  for (let x = Math.floor(cameraX / 60) * 60; x < cameraX + canvas.width + 60; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x - cameraX, 0);
    ctx.lineTo(x - cameraX, canvas.height);
    ctx.stroke();
  }

  for (let y = Math.floor(cameraY / 60) * 60; y < cameraY + canvas.height + 60; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y - cameraY);
    ctx.lineTo(canvas.width, y - cameraY);
    ctx.stroke();
  }
}

function renderTrail(trail, color) {
  if (trail.length < 2) return;

  ctx.beginPath();
  const firstPoint = trail[0];
  ctx.moveTo(firstPoint.x - state.player.x + canvas.width / 2, firstPoint.y - state.player.y + canvas.height / 2);

  for (let i = 1; i < trail.length; i += 1) {
    const point = trail[i];
    ctx.lineTo(point.x - state.player.x + canvas.width / 2, point.y - state.player.y + canvas.height / 2);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 20;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function renderDot(dot) {
  const x = dot.x - state.player.x + canvas.width / 2;
  const y = dot.y - state.player.y + canvas.height / 2;
  ctx.beginPath();
  ctx.fillStyle = '#f7f7d5';
  ctx.arc(x, y, dot.radius, 0, Math.PI * 2);
  ctx.fill();
}

function renderEntity(entity, isPlayer = false) {
  const x = entity.x - state.player.x + canvas.width / 2;
  const y = entity.y - state.player.y + canvas.height / 2;

  ctx.beginPath();
  ctx.fillStyle = entity.color;
  ctx.arc(x, y, entity.radius, 0, Math.PI * 2);
  ctx.fill();

  if (isPlayer) {
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(x + entity.radius * 0.35, y - entity.radius * 0.3, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function render() {
  if (!state.player) return;

  drawWorldBackground();

  for (const dot of state.dots) renderDot(dot);

  renderTrail(state.player.trail, '#5ef2c2');
  for (const bot of state.bots) {
    if (bot.alive) {
      renderTrail(bot.trail, bot.color);
    }
  }

  renderEntity(state.player, true);
  for (const bot of state.bots) {
    if (bot.alive) {
      renderEntity(bot, false);
    }
  }

  if (!state.started) {
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e8f6f3';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px Arial';
    ctx.fillText('Paper Pix', canvas.width / 2, canvas.height / 2 - 16);
    ctx.font = '22px Arial';
    ctx.fillText('Aperte espaço para começar', canvas.width / 2, canvas.height / 2 + 28);
  }
}

function loop(timestamp) {
  const dt = Math.min((timestamp - state.lastTime) / 1000 || 0.016, 0.033);
  state.lastTime = timestamp;

  if (state.started && !state.gameOver) {
    updatePlayer(dt);
    for (const bot of state.bots) {
      updateBot(bot, dt);
    }
  }

  render();
  requestAnimationFrame(loop);
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  keys[key] = true;

  if (event.code === 'Space' && (!state.started || state.gameOver)) {
    event.preventDefault();
    resetGame();
  }
});

window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  keys[key] = false;
});

resetGame();
requestAnimationFrame(loop);
