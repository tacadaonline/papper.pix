<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Paper.io</title>
    <style>
        body { margin: 0; background-color: #08080a; color: #fff; font-family: sans-serif; overflow: hidden; touch-action: none; }
        #painel { position: fixed; top: 15px; left: 50%; transform: translateX(-50%); display: flex; gap: 25px; font-size: 14px; background: rgba(12, 12, 14, 0.95); padding: 12px 25px; border-radius: 50px; box-shadow: 0 10px 30px rgba(0,0,0,0.6); border: 1px solid rgba(255, 255, 255, 0.1); z-index: 10; backdrop-filter: blur(8px); }
        canvas { display: block; width: 100vw; height: 100vh; }
        .destaque { color: #00ffcc; font-weight: bold; }
        .pote { color: #ffcc00; font-weight: bold; }
    </style>
</head>
<body>
    <div id="painel">
        <div>ID: <span id="meuId" class="destaque">-</span></div>
        <div>Saldo: <span id="saldo" class="destaque">R\$ 0,00</span></div>
        <div>💰 POTE: <span id="pote" class="pote">R\$ 0,00</span></div>
    </div>
    <canvas id="gameCanvas"></canvas>
    <script>
        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        
        function redimensionarCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
        window.addEventListener('resize', redimensionarCanvas);
        redimensionarCanvas();

        const local = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const wsUrl = local ? 'ws://localhost:8080' : window.location.origin.replace(/^http/, 'ws');
        const ws = new WebSocket(wsUrl);
        
        let meuId = null;
        let servidoresDados = { players: {}, pot: 0, grid: {}, mapRows: 75, mapCols: 75, blockSize: 40 };
        let renderDados = { players: {} };
        let particulas = [];

        function criarExplosao(x, y, cor) {
            for (let i = 0; i < 30; i++) {
                particulas.push({ x: x, y: y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, raio: Math.random() * 3 + 2, cor: cor, alfa: 1, vida: Math.random() * 0.04 + 0.02 });
            }
        }

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'init') {
                meuId = data.id;
                document.getElementById('meuId').innerText = meuId;
                document.getElementById('saldo').innerText = `R$ ${data.balance.toFixed(2)}`;
            }
            if (data.type === 'update') {
                Object.keys(servidoresDados.players).forEach(id => {
                    if (servidoresDados.players[id].alive && !data.gameState.players[id]?.alive) {
                        const p = servidoresDados.players[id];
                        criarExplosao(p.col * 40 + 20, p.row * 40 + 20, p.color);
                    }
                });
                servidoresDados = data.gameState;
                document.getElementById('pote').innerText = `R$ ${servidoresDados.pot.toFixed(2)}`;
            }
            if (data.type === 'gameOver' && data.id === meuId) {
                alert("💥 Fim de Jogo!"); location.reload();
            }
        };

        function gameLoop() {
            const size = servidoresDados.blockSize || 40;
            Object.keys(servidoresDados.players).forEach(id => {
                const sPlayer = servidoresDados.players[id];
                const alvoX = sPlayer.col * size + size / 2;
                const alvoY = sPlayer.row * size + size / 2;
                if (!renderDados.players[id]) {
                    renderDados.players[id] = { x: alvoX, y: alvoY, ...sPlayer };
                } else {
                    const rPlayer = renderDados.players[id];
                    rPlayer.x += (alvoX - rPlayer.x) * 0.35;
                    rPlayer.y += (alvoY - rPlayer.y) * 0.35;
                    rPlayer.color = sPlayer.color;
                    rPlayer.alive = sPlayer.alive;
                }
            });
            Object.keys(renderDados.players).forEach(id => { if (!servidoresDados.players[id]) delete renderDados.players[id]; });
            particulas.forEach((p, i) => { p.x += p.vx; p.y += p.vy; p.alfa -= p.vida; if (p.alfa <= 0) particulas.splice(i, 1); });
            desenharJogo();
            requestAnimationFrame(gameLoop);
        }

        function desenharJogo() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const size = servidoresDados.blockSize || 40;
            const meuJogador = renderDados.players[meuId];
            
            let camX = (servidoresDados.mapCols * size) / 2 - canvas.width / 2;
            let camY = (servidoresDados.mapRows * size) / 2 - canvas.height / 2;
            if (meuJogador) { camX = meuJogador.x - canvas.width / 2; camY = meuJogador.y - canvas.height / 2; }

            ctx.save(); ctx.translate(-camX, -camY);
            const totalWidth = servidoresDados.mapCols * size;
            const totalHeight = servidoresDados.mapRows * size;
            ctx.fillStyle = '#111116'; ctx.fillRect(0, 0, totalWidth, totalHeight);

            if (servidoresDados.grid) {
                Object.keys(servidoresDados.grid).forEach(chave => {
                    const [r, c] = chave.split(',').map(Number);
                    const bloco = servidoresDados.grid[chave];
                    if (bloco.tipo === 'base') { ctx.fillStyle = bloco.cor + "3A"; ctx.fillRect(c * size, r * size, size, size); }
                    else if (bloco.tipo === 'rastro') { ctx.fillStyle = bloco.cor + "AA"; ctx.fillRect(c * size + 4, r * size + 4, size - 8, size - 8); }
                });
            }
            ctx.strokeStyle = '#ff3344'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, totalWidth, totalHeight);

            Object.values(renderDados.players).forEach(player => {
                if (!player.alive) return;
                ctx.fillStyle = player.color; ctx.fillRect(player.x - 16, player.y - 16, 32, 32);
                if (player.id === meuId) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.strokeRect(player.x - 19, player.y - 19, 38, 38); }
            });
            particulas.forEach(p => { ctx.save(); ctx.globalAlpha = p.alfa; ctx.fillStyle = p.cor; ctx.beginPath(); ctx.arc(p.x, p.y, p.raio, 0, Math.PI * 2); ctx.fill(); ctx.restore(); });
            ctx.restore();
        }

        window.addEventListener('keydown', (e) => {
            let dRow = 0, dCol = 0;
            if (e.key === 'ArrowUp' || e.key === 'w') { dRow = -1; dCol = 0; }
            if (e.key === 'ArrowDown' || e.key === 's') { dRow = 1; dCol = 0; }
            if (e.key === 'ArrowLeft' || e.key === 'a') { dRow = 0; dCol = -1; }
            if (e.key === 'ArrowRight' || e.key === 'd') { dRow = 0; dCol = 1; }
            if (dRow !== 0 || dCol !== 0) ws.send(JSON.stringify({ type: 'move', dRow, dCol }));
        });

        let tStartX = 0, tStartY = 0;
        window.addEventListener('touchstart', (e) => { tStartX = e.touches[0].clientX; tStartY = e.touches[0].clientY; }, { passive: true });
        window.addEventListener('touchmove', (e) => {
            if (!tStartX || !tStartY) return;
            const diffX = e.touches[0].clientX - tStartX; const diffY = e.touches[0].clientY - tStartY;
            if (Math.abs(diffX) > 25 || Math.abs(diffY) > 25) {
                if (Math.abs(diffX) > Math.abs(diffY)) { ws.send(JSON.stringify({ type: 'move', dRow: 0, dCol: diffX > 0 ? 1 : -1 })); }
                else { ws.send(JSON.stringify({ type: 'move', dRow: diffY > 0 ? 1 : -1, dCol: 0 })); }
                tStartX = 0; tStartY = 0;
            }
        }, { passive: true });

        requestAnimationFrame(gameLoop);
    </script>
</body>
</html>
