// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function heartbeat() {
  this.isAlive = true;
}

// ★ここに追加（connectionの外！）
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    if (ws.isAlive === false) {
      console.log("タイムアウト切断");
      ws.terminate();
      return;
    }

    ws.isAlive = false;

    try {
      ws.ping();
    } catch (e) {
      console.log("ping error:", e);
    }
  });
}, 30000);

app.use(express.static(path.join(__dirname, 'public')));

let history = [];
let clients = [];
let gameState = null;

/* -------------------------
   履歴
------------------------- */
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/* -------------------------
   役名
------------------------- */
function rankName(rank) {
  return ["", "ハイカード", "ストレート", "フラッシュ", "スリーカード", "ストレートフラッシュ"][rank];
}

/* -------------------------
   ゲーム初期化
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
   役判定
------------------------- */
function evaluateFormation(cards) {
  const nums = cards.map(c => c.number).sort((a,b)=>a-b);
  const colors = cards.map(c => c.color);

  const sameColor = colors.every(c => c === colors[0]);
  const consecutive = nums[1] === nums[0] + 1 && nums[2] === nums[1] + 1;
  const sameNumber = nums[0] === nums[1] && nums[1] === nums[2];
  const sum = nums.reduce((a,b)=>a+b,0);

  let rank;
  if (sameColor && consecutive) rank = 5;
  else if (sameNumber) rank = 4;
  else if (sameColor) rank = 3;
  else if (consecutive) rank = 2;
  else rank = 1;

  return { rank, sum };
}

/* -------------------------
   フラッグ勝敗判定（ログ強化版）
------------------------- */
function resolveFlag(flag) {
  if (flag.winner) return flag.winner;
  if (flag.cardsP1.length < 3 || flag.cardsP2.length < 3) return null;

  const f1 = evaluateFormation(flag.cardsP1);
  const f2 = evaluateFormation(flag.cardsP2);

  let winner = null;
  let reason = "";

  if (f1.rank > f2.rank) {
    winner = 'P1';
    reason = `役の強さで勝利：${rankName(f1.rank)} > ${rankName(f2.rank)}`;
  }
  else if (f2.rank > f1.rank) {
    winner = 'P2';
    reason = `役の強さで勝利：${rankName(f2.rank)} > ${rankName(f1.rank)}`;
  }
  else {
    if (f1.sum > f2.sum) {
      winner = 'P1';
      reason = `役は同じ（${rankName(f1.rank)}）、合計値で勝利：${f1.sum} > ${f2.sum}`;
    }
    else if (f2.sum > f1.sum) {
      winner = 'P2';
      reason = `役は同じ（${rankName(f1.rank)}）、合計値で勝利：${f2.sum} > ${f1.sum}`;
    }
    else {
      winner = flag.completedOrder;
      reason = `役も合計値も同じ、先に3枚揃えたため ${winner} の勝利`;
    }
  }

  flag.winner = winner;

  console.log(`フラッグ ${flag.id} 決着 → ${winner} 勝利（${reason}）`);

  return winner;
}

/* -------------------------
   ゲーム勝利判定
------------------------- */
function checkGameWinner(state) {
  const owners = Array(9).fill(null);
  state.flags.forEach(f => {
    if (f.winner === 'P1') owners[f.id] = 'P1';
    if (f.winner === 'P2') owners[f.id] = 'P2';
  });

  state.capturedP1 = state.flags.filter(f => f.winner === 'P1').map(f => f.id);
  state.capturedP2 = state.flags.filter(f => f.winner === 'P2').map(f => f.id);

  if (state.capturedP1.length >= 5) return 'P1';
  if (state.capturedP2.length >= 5) return 'P2';

  function hasThreeInRow(player) {
    for (let i = 0; i <= 6; i++) {
      if (owners[i] === player && owners[i+1] === player && owners[i+2] === player) {
        return true;
      }
    }
    return false;
  }

  if (hasThreeInRow('P1')) return 'P1';
  if (hasThreeInRow('P2')) return 'P2';

  return null;
}

/* -------------------------
   未消費カード（手札＋山札）
------------------------- */
function getUnusedCards(state) {
  const used = new Set();

  state.flags.forEach(f => {
    f.cardsP1.forEach(c => used.add(c.id));
    f.cardsP2.forEach(c => used.add(c.id));
  });

  const unused = [];

  ['P1','P2'].forEach(p => {
    state.hands[p].forEach(c => {
      if (!used.has(c.id)) unused.push(c);
    });
  });

  state.deck.forEach(c => {
    if (!used.has(c.id)) unused.push(c);
  });

  return unused;
}

/* -------------------------
   組み合わせ生成
------------------------- */
function combinations(arr, k) {
  const result = [];
  function dfs(start, path) {
    if (path.length === k) {
      result.push(path.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      path.push(arr[i]);
      dfs(i+1, path);
      path.pop();
    }
  }
  if (k <= 0) return [[]];
  if (k > arr.length) return [];
  dfs(0, []);
  return result;
}

/* -------------------------
   相手が勝てる可能性を探索
------------------------- */
function canOpponentWin(myFormation, oppCards, unusedCards) {
  const need = 3 - oppCards.length;

  if (need === 0) {
    const f = evaluateFormation(oppCards);
    if (f.rank > myFormation.rank ||
        (f.rank === myFormation.rank && f.sum > myFormation.sum)) {
      return { win: true, combo: oppCards, formation: f };
    }
    return { win: false };
  }

  const combos = combinations(unusedCards, need);

  for (const add of combos) {
    const full = oppCards.concat(add);
    const f = evaluateFormation(full);

    if (f.rank > myFormation.rank ||
        (f.rank === myFormation.rank && f.sum > myFormation.sum)) {
      return { win: true, combo: full, formation: f };
    }
  }

  return { win: false };
}

/* -------------------------
   全員に state を送信
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
   両プレイヤーの名前が揃ったらゲーム開始
------------------------- */
function tryStartGame() {
  if (gameState) return;

  const p1 = clients.find(c => c.role === "P1" && c.name);
  const p2 = clients.find(c => c.role === "P2" && c.name);

  if (!p1 || !p2) return;

  gameState = createInitialGameState();
  gameState.playerNames.P1 = p1.name;
  gameState.playerNames.P2 = p2.name;

  broadcastState();
}

/* -------------------------
   接続処理
------------------------- */
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  let role = "spectator"; // 最初は仮

  clients.push({ ws, role, name: "" });

  ws.send(JSON.stringify({ type: 'youAre', playerId: role }));

  /* -------------------------
     メッセージ受信
  ------------------------- */
  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); }
    catch { return; }

    const sender = clients.find(c => c.ws === ws);
    if (!sender) return;
    // ★ここに入れる！！！
  if (data.type === "setName") {
    sender.name = data.name;

    if (data.role === "P1" || data.role === "P2") {
      if (clients.some(c => c.role === data.role)) {
        ws.send(JSON.stringify({
          type: "error",
          message: "その席は埋まってます"
        }));
        return;
      }
      sender.role = data.role;
    } else {
      sender.role = "spectator";
    }

    ws.send(JSON.stringify({
      type: 'youAre',
      playerId: sender.role
    }));

    if (sender.role === "P1" || sender.role === "P2") {
      if (gameState) {
        gameState.playerNames[sender.role] = sender.name;
        broadcastState();
      } else {
        tryStartGame();
      }
    }

    return;
  }
    
  /* -------------------------
       一手戻す
  ------------------------- */
  if (data.type === 'undo') {
    if (sender.role === "spectator") return;
    if (history.length === 0) return;

    gameState = history.pop();
    broadcastState();
    return;
  }

  /* -------------------------
       リセット
  ------------------------- */
if (data.type === 'reset') {
  if (sender.role === "spectator") return;
  gameState = createInitialGameState();

  // プレイヤー名は維持（消したくないなら）
  clients.forEach(c => {
    if (c.role === "P1" || c.role === "P2") {
      gameState.playerNames[c.role] = c.name;
    }
  });

  // 履歴もリセット（undo対策）
  history = [];
  broadcastState();
  return;
}

    if (!gameState) return;
    if (sender.role === "spectator") return;

    /* -------------------------
       playCard
    ------------------------- */
    if (data.type === 'playCard') {
       // ★追加（この1行が命）
       
      if (gameState.winner) return;
      history.push(cloneState(gameState));
      if (history.length > 50) history.shift();
      
      const { playerId, cardId, flagId } = data;

      if (gameState.currentPlayer !== playerId) return;

      const flag = gameState.flags.find(f => f.id === flagId);
      if (!flag || flag.winner) return;

      const hand = gameState.hands[playerId];
      const card = hand.find(c => c.id === cardId);
      if (!card) return;

      const pile = playerId === 'P1' ? flag.cardsP1 : flag.cardsP2;
      if (pile.length >= 3) return;

      const idx = hand.findIndex(c => c.id === cardId);
      const placed = hand.splice(idx,1)[0];
      pile.push(placed);

      gameState.flags.forEach(f => {
        f.lastCardId = (f.id === flagId ? placed.id : null);
      });

      if (pile.length === 3 && !flag.completedOrder) {
        flag.completedOrder = playerId;
      }

      /* ★ 3枚揃えた瞬間の役ログ */
      if (pile.length === 3) {
        const f = evaluateFormation(pile);
        console.log(`フラッグ ${flagId}: ${playerId} が3枚揃えた → ${rankName(f.rank)}（sum=${f.sum}）`);
      }

      if (gameState.deck.length > 0) {
        hand.push(gameState.deck.pop());
      }

      gameState.currentPlayer = (playerId === 'P1' ? 'P2' : 'P1');

      /* -------------------------
         ★ 自動勝敗判定（3枚 vs 3枚）
      ------------------------- */
      if (flag.cardsP1.length === 3 && flag.cardsP2.length === 3 && !flag.winner) {
        const w = resolveFlag(flag);
        if (w) {
          const gw = checkGameWinner(gameState);
          if (gw) gameState.winner = gw;
        }
      }

      broadcastState();
      return;
    }

    /* -------------------------
       証明（強化版）
    ------------------------- */
    if (data.type === 'prove') {
      if (gameState.winner) return;
      const { playerId, flagId } = data;

      const flag = gameState.flags.find(f => f.id === flagId);
      if (!flag || flag.winner) return;

      const myCards = playerId === 'P1' ? flag.cardsP1 : flag.cardsP2;
      const oppCards = playerId === 'P1' ? flag.cardsP2 : flag.cardsP1;

      if (myCards.length < 3) return;

      const myFormation = evaluateFormation(myCards);

      if (myFormation.rank === 5 && myFormation.sum === 27) {
        flag.winner = playerId;
        console.log(`フラッグ ${flagId}: 証明成功 → 8-9-10 ストレートフラッシュで即勝利`);
      } else {
        const unused = getUnusedCards(gameState);
        const result = canOpponentWin(myFormation, oppCards, unused);

        if (!result.win) {
          flag.winner = playerId;
          console.log(`フラッグ ${flagId}: 証明成功 → 相手に勝ち目なし（自分の役：${rankName(myFormation.rank)} sum=${myFormation.sum}）`);
        } else {
          console.log(`フラッグ ${flagId}: 証明失敗 → 相手が勝てる可能性あり`);
          console.log(`勝てる組み合わせ: ${result.combo.map(c=>c.color+c.number).join(', ')}`);
          console.log(`その役: ${rankName(result.formation.rank)}（sum=${result.formation.sum}）`);
        }
      }

      if (flag.winner) {
        const gw = checkGameWinner(gameState);
        if (gw) gameState.winner = gw;
      }

      broadcastState();
      return;
    }
  });



  /* -------------------------
     切断
  ------------------------- */
  ws.on('close', () => {
    console.log('切断されました');

    // クライアント削除
    const index = clients.findIndex(c => c.ws === ws);
    if (index !== -1) {
      clients.splice(index, 1);
    }

    // ★P1とP2が両方いないかチェック
    const hasP1 = clients.some(c => c.role === "P1");
    const hasP2 = clients.some(c => c.role === "P2");

    if (!hasP1 && !hasP2) {
      console.log("全プレイヤー切断 → 自動リセット");

      gameState = createInitialGameState();
      history = [];

      return;
    }
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running");
});