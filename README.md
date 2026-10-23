# Paper Pix

Um jogo estilo Paper.io com jogabilidade em navegador, inspirado em território, pontos e evasão de rastros.

## Como jogar

1. Abra o arquivo `index.html` em um navegador, ou rode um servidor local:
   ```bash
   python3 -m http.server 8000
   ```
2. Acesse: `http://localhost:8000`
3. Use `WASD` ou as setas para mover.
4. Coma os pontos e evite bater em qualquer rastro.

## Objetivo

- Capturar pontos para aumentar a pontuação.
- Não encoste no seu próprio rastro nem nos rastros dos rivais.
- Tente manter o melhor recorde.

## Arquivos principais

- `index.html` — estrutura da página
- `styles.css` — visual do jogo
- `game.js` — lógica da mecânica e IA básica
