// ===== server.js（完全安定＋復元版） =====

process.on('uncaughtException', (err) => {
  console.log('例外クラッシュ:', err);
});

process.on('unhandledRejection', (err) => {
  console.log('Promiseエラー:', err);
});

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const SAVE_FILE = './game.json';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

let history = [];
let clients = [];
let gameState = null;
let resetTimer = null;

/* -------------------------
   保存・復元
------------------------- */
function loadGame() {
  try {
    if (fs.existsSync(SAVE_FILE)) {
      gameState = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf-8'));
      console.log("ゲーム復元成功");
    }
  } catch (e) {
    console.log("復元失敗:", e);
  }
}

function saveGame() {
  try {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(gameState));
  } catch (e) {
    console.log("保存失敗:", e);
  }
}

/* -------------------------
   ping管理
------------------------- */
function heartbeat() {
  this.isAlive = true;
}

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30000);

/* -------------------------
   ゲーム生成
------------------------- */
function createInitialGameState() {
  const colors = ['R','G','B','Y','P','O'];
  let deck = [];
  let id = 0;

  for (const c of colors) {
    for (let n = 1; n <= 10; n++) {
      deck.push({ id: id++, color: c, number: n });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const flags = [];
  for (let i = 0; i < 9; i++) {
    flags.push({
      id: i,
      cardsP1: [],
      cardsP2: [],
      winner: null,
      completedOrder: null,
      lastCardId: null
    });
  }

  const hands = { P1: [], P2: [] };
  for (let i = 0; i < 7; i++) {
    hands.P1.push(deck.pop());
    hands.P2.push(deck.pop());
  }

  return {
    deck,
    flags,
    hands,
    currentPlayer: 'P1',
    capturedP1: [],
    capturedP2: [],
    winner: null,
    playerNames: { P1: "", P2: "" }
  };
}

/* -------------------------
   送信
------------------------- */
function broadcastState() {
  if (!gameState) return;
  const payload = JSON.stringify({ type: 'state', state: gameState });

  clients.forEach(c => {
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(payload);
    }
  });
}

/* -------------------------
   接続
------------------------- */
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('error', (err) => {
    console.log('WSエラー:', err.message);
  });

  let role = "spectator";
  clients.push({ ws, role, name: "" });

  ws.send(JSON.stringify({ type: 'youAre', playerId: role }));

  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    if (data.type === "ping") return;

    const sender = clients.find(c => c.ws === ws);
    if (!sender) return;

    /* 名前設定 */
    if (data.type === "setName") {
      sender.name = data.name;

      if (data.role === "P1" || data.role === "P2") {
        sender.role = data.role;
      }

      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }

      ws.send(JSON.stringify({
        type: 'youAre',
        playerId: sender.role
      }));

      if (gameState) {
        gameState.playerNames[sender.role] = sender.name;
        broadcastState();
      } else {
        gameState = createInitialGameState();
        gameState.playerNames[sender.role] = sender.name;
        saveGame();
        broadcastState();
      }

      return;
    }

    if (!gameState) return;

    /* カード配置 */
    if (data.type === 'playCard') {
      history.push(JSON.parse(JSON.stringify(gameState)));

      const { playerId, cardId, flagId } = data;

      const flag = gameState.flags.find(f => f.id === flagId);
      const hand = gameState.hands[playerId];

      const idx = hand.findIndex(c => c.id === cardId);
      const card = hand.splice(idx,1)[0];

      const pile = playerId === 'P1' ? flag.cardsP1 : flag.cardsP2;
      pile.push(card);

      if (gameState.deck.length > 0) {
        hand.push(gameState.deck.pop());
      }

      gameState.currentPlayer = (playerId === 'P1' ? 'P2' : 'P1');

      broadcastState();
      saveGame();
      return;
    }

    if (data.type === 'reset') {
      gameState = createInitialGameState();
      history = [];
      broadcastState();
      saveGame();
      return;
    }

    if (data.type === 'undo') {
      if (history.length === 0) return;
      gameState = history.pop();
      broadcastState();
      saveGame();
      return;
    }
  });

  ws.on('close', () => {
    const index = clients.findIndex(c => c.ws === ws);
    if (index !== -1) clients.splice(index, 1);

    if (clients.length === 0) {
      resetTimer = setTimeout(() => {
        console.log("全切断 → リセット");
        gameState = createInitialGameState();
        history = [];
        saveGame();
      }, 10000);
    }
  });

});

/* 起動時復元 */
loadGame();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running");
});
