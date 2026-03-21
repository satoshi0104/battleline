let ws;
let me = null;       // "P1" | "P2" | "spectator"
let state = null;
let myName = "";
let selectedCardId = null; 
let winnerPopupShown = false;

const nameInputArea = document.getElementById("nameInputArea");
const gameArea = document.getElementById("gameArea");
const startBtn = document.getElementById("startBtn");
const nameInput = document.getElementById("playerNameInput");

const statusEl = document.getElementById('status');
const flagsEl = document.getElementById('flags');
const handEl = document.getElementById('hand');
const deckInfoEl = document.getElementById('deckInfo');
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");

/* -------------------------
   ページロード時に接続
------------------------- */
window.addEventListener("load", () => {
  connect();
});

/* -------------------------
   名前送信
------------------------- */
startBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) {
    alert("名前を入力してください");
    return;
  }
  myName = name;

  ws.send(JSON.stringify({
    type: "setName",
    name: myName
    role: document.getElementById("roleSelect").value
  }));

  nameInputArea.style.display = "none";
  gameArea.style.display = "block";
});

/* -------------------------
   WebSocket 接続
------------------------- */
function connect() {
  const loc = window.location;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${location.host}`;
  /*const url = `ws://${loc.hostname}:${loc.port}`;*/
  ws = new WebSocket(url);

  ws.onopen = () => {
    statusEl.textContent = "サーバーに接続しました。名前を入力してください。";
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === 'youAre') {
      me = msg.playerId;

      if (me === "spectator") {
        statusEl.textContent = "観戦者として接続しました";
      } else {
        statusEl.textContent = `あなたは ${me} です（名前入力待ち）`;
      }
    }

    if (msg.type === 'state') {
      state = msg.state;
      render();
    }

    if (msg.type === 'error') {
      alert(msg.message);
    }
  };

  ws.onclose = () => {
    statusEl.textContent = '切断されました。';
  };
}

/* -------------------------
   カード色
------------------------- */
function cardColorStyle(c) {
  const map = {
    R:'#f44336',
    G:'#4caf50',
    B:'#2196f3',
    Y:'#ffeb3b',
    P:'#e91e63',
    O:'#ff9800'
  };
  return map[c] || '#999';
}

/* -------------------------
   描画
------------------------- */
function render() {
  if (!state || !me) return;
     const myDisplayName = state.playerNames[me];
     const opponent = me === "P1" ? "P2" : "P1";
     const opponentName = state.playerNames[opponent];
  /* -------------------------
     勝敗ポップアップ
  ------------------------- */
if (state.winner) {
  statusEl.textContent = `勝者: ${state.winner}（リセットするまで盤面を確認できます）`;
}

  deckInfoEl.textContent = `山札: ${state.deck.length}枚`;

if (state.winner) {
  statusEl.textContent = `勝者: ${state.playerNames[state.winner]}`;
} else {
  if (me === "spectator") {
    statusEl.textContent = "観戦中";
  } else {
    statusEl.textContent =
      `${myDisplayName} vs ${opponentName} / 手番: ${state.playerNames[state.currentPlayer]}`;
  }
}

  /* -------------------------
     フラッグ描画
------------------------- */
  flagsEl.innerHTML = '';

state.flags.forEach(flag => {
  const div = document.createElement('div');
  div.className = 'flag';

  if (flag.winner === 'P1') div.classList.add('wP1');
  if (flag.winner === 'P2') div.classList.add('wP2');

  // ✅ ヘッダー（番号＋勝者）
  const header = document.createElement('div');
  header.className = 'flag-header';

  let text = flag.id; // ←番号だけ

  if (flag.winner) {
    const name = state.playerNames[flag.winner] || flag.winner;
    const mark = flag.winner === "P1" ? "🟢" : "🔴";
    text += ` ${mark} ${name}`;
  }

  header.textContent = text;
  div.appendChild(header);

  // P1 pile
  const p1 = document.createElement('div');
  p1.className = 'pile';
  flag.cardsP1.forEach(c => {
    const el = document.createElement('span');
    el.className = 'card';
    el.textContent = `${c.number}`;
    el.style.background = cardColorStyle(c.color);
    if (flag.lastCardId === c.id) el.classList.add('last');
    p1.appendChild(el);
  });
  div.appendChild(p1);

  // P2 pile
  const p2 = document.createElement('div');
  p2.className = 'pile';
  flag.cardsP2.forEach(c => {
    const el = document.createElement('span');
    el.className = 'card';
    el.textContent = `${c.number}`;
    el.style.background = cardColorStyle(c.color);
    if (flag.lastCardId === c.id) el.classList.add('last');
    p2.appendChild(el);
  });
  div.appendChild(p2);

  // 証明ボタン
  const proveBtn = document.createElement('button');
  proveBtn.textContent = "証明";

  const myCards = me === "P1" ? flag.cardsP1 : flag.cardsP2;
  const canProve =
    me !== "spectator" &&
    !flag.winner &&
    myCards.length === 3;

  proveBtn.disabled = !canProve;

  proveBtn.addEventListener('click', () => {
    if (!canProve) return;
    ws.send(JSON.stringify({
      type: 'prove',
      playerId: me,
      flagId: flag.id
    }));
  });

  div.appendChild(proveBtn);

  // カード置く
  if (!flag.winner && state.currentPlayer === me && me !== "spectator") {
    div.addEventListener('click', () => {
      if (selectedCardId == null) return;

      ws.send(JSON.stringify({
        type: 'playCard',
        playerId: me,
        cardId: selectedCardId,
        flagId: flag.id
      }));

      selectedCardId = null;
      render();
    });
  }

  flagsEl.appendChild(div);
});

  /* -------------------------
     手札描画
------------------------- */
  handEl.innerHTML = '';

  if (me === "spectator") {
    handEl.style.display = "none";
    return;
  } else {
    handEl.style.display = "flex";
  }

  const myHand = state.hands[me];

  myHand.forEach(c => {
    const el = document.createElement('span');
    el.className = 'card';
    el.textContent = `${c.number}`;
    el.style.background = cardColorStyle(c.color);
    el.dataset.id = c.id;

    if (selectedCardId === c.id) {
      el.classList.add('selected');
    }

    el.addEventListener('click', () => {
      selectedCardId = c.id;
      render();
    });

    handEl.appendChild(el);
  });
  
  // 👇ここに入れる
  if (me === "spectator") {
    undoBtn.disabled = true;
    resetBtn.disabled = true;
  } else {
    undoBtn.disabled = false;
    resetBtn.disabled = false;
  }
  
  
  // 🔊 ここに追加
  if (state.currentPlayer === me && prevPlayer !== me) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 800;

    gain.gain.value = 0.1;

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }

    prevPlayer = state.currentPlayer;
    
  }

function sendUndo() {
  ws.send(JSON.stringify({
    type: 'undo'
  }));
}

window.addEventListener("load", () => {
  const btn = document.getElementById("resetBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      ws.send(JSON.stringify({
  type: 'reset'
}));
    });
  }
});

document.getElementById("undoBtn").addEventListener("click", () => {
  sendUndo();
});

