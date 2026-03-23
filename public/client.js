let ws;
let me = null;
let state = null;
let myName = "";
let selectedCardId = null;
let selectedRole = "spectator";

let prevPlayer = null;
let reconnecting = false;

/* -------------------------
   接続
------------------------- */
function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${location.host}`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnecting = false;
    statusEl.textContent = "接続しました";

    // ★ 再接続時に自動復帰
    if (myName) {
      ws.send(JSON.stringify({
        type: "setName",
        name: myName,
        role: selectedRole
      }));
    }
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === 'youAre') {
      me = msg.playerId;

      if (me === "spectator") {
        statusEl.textContent = "観戦者として接続";
      } else {
        statusEl.textContent = `あなたは ${me}`;
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
    if (!reconnecting) {
      reconnecting = true;
      statusEl.textContent = "切断されました…再接続中";

      setTimeout(() => {
        connect();
      }, 1000);
    }
  };

  ws.onerror = () => {
    ws.close();
  };
}

/* -------------------------
   初期化
------------------------- */
window.addEventListener("load", () => {
  connect();

  const roleBtns = document.querySelectorAll(".roleBtn");
  roleBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      roleBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedRole = btn.dataset.role;
    });
  });
});

/* -------------------------
   DOM
------------------------- */
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
    name: myName,
    role: selectedRole
  }));

  nameInputArea.style.display = "none";
  gameArea.style.display = "block";
});

/* -------------------------
   安全送信
------------------------- */
function safeSend(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(data));
}

/* -------------------------
   色
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

  // ステータス
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

  deckInfoEl.textContent = `山札: ${state.deck.length}枚`;

  /* フラッグ */
  flagsEl.innerHTML = '';

  state.flags.forEach(flag => {
    const div = document.createElement('div');
    div.className = 'flag';

    if (flag.winner === 'P1') div.classList.add('wP1');
    if (flag.winner === 'P2') div.classList.add('wP2');

    const header = document.createElement('div');
    header.className = 'flag-header';

    let text = flag.id;
    if (flag.winner) {
      const name = state.playerNames[flag.winner];
      const mark = flag.winner === "P1" ? "🟢" : "🔴";
      text += ` ${mark} ${name}`;
    }

    header.textContent = text;
    div.appendChild(header);

    function drawPile(cards) {
      const pile = document.createElement('div');
      pile.className = 'pile';

      cards.forEach(c => {
        const el = document.createElement('span');
        el.className = 'card';
        el.textContent = c.number;
        el.style.background = cardColorStyle(c.color);
        if (flag.lastCardId === c.id) el.classList.add('last');
        pile.appendChild(el);
      });

      return pile;
    }

    div.appendChild(drawPile(flag.cardsP1));
    div.appendChild(drawPile(flag.cardsP2));

    // 証明
    const proveBtn = document.createElement('button');
    proveBtn.textContent = "証明";

    const myCards = me === "P1" ? flag.cardsP1 : flag.cardsP2;

    proveBtn.disabled =
      me === "spectator" ||
      flag.winner ||
      myCards.length !== 3;

    proveBtn.onclick = () => {
      safeSend({
        type: 'prove',
        playerId: me,
        flagId: flag.id
      });
    };

    div.appendChild(proveBtn);

    // カード置く
    if (!flag.winner && state.currentPlayer === me && me !== "spectator") {
      div.onclick = () => {
        if (selectedCardId == null) return;

        safeSend({
          type: 'playCard',
          playerId: me,
          cardId: selectedCardId,
          flagId: flag.id
        });

        selectedCardId = null;
      };
    }

    flagsEl.appendChild(div);
  });

  /* 手札 */
  handEl.innerHTML = '';

  if (me === "spectator") {
    handEl.style.display = "none";
    return;
  }

  handEl.style.display = "flex";

  state.hands[me].forEach(c => {
    const el = document.createElement('span');
    el.className = 'card';
    el.textContent = c.number;
    el.style.background = cardColorStyle(c.color);

    if (selectedCardId === c.id) {
      el.classList.add('selected');
    }

    el.onclick = () => {
      selectedCardId = c.id;
      render();
    };

    handEl.appendChild(el);
  });

  // ボタン制御
  undoBtn.disabled = (me === "spectator");
  resetBtn.disabled = (me === "spectator");

  // ターン音
  if (state.currentPlayer === me && prevPlayer !== me) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.frequency.value = 800;
      gain.gain.value = 0.1;

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {}
  }

  prevPlayer = state.currentPlayer;
}

/* -------------------------
   ボタン
------------------------- */
undoBtn.onclick = () => {
  safeSend({ type: 'undo' });
};

resetBtn.onclick = () => {
  safeSend({ type: 'reset' });
};