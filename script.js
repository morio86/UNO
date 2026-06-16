'use strict';

// ============ State ============
const COLORS = ['red', 'yellow', 'green', 'blue'];

let players = [];      // [{id, name, isCPU, hand:[card], unoDeclared:bool}]
let deck = [];
let discard = [];
let currentColor = null;
let currentPlayer = 0;
let direction = 1;          // 1 = clockwise, -1 = reverse
let pendingWildCard = null; // index of wild card awaiting color choice
let pendingPlay = [];       // indices of number cards staged for multi-card play
let pendingWild4Challenge = null; // set when CPU plays wild_draw4 targeting human
let gameOver = false;
let awaitingPass = false;   // true while waiting for the next human player to tap "see hand"
let awaitingDrawPlay = false; // true after human drew forced card that is playable
let gamePaused = false;

// Draw stacking state
let pendingDrawCount = 0;
let pendingDrawType = null;

// ============ House Rules ============
const houseRules = {
  stackSameNumber: false,
  drawStacking:    false,
  zeroRotate:      false,
  sevenSwap:       false,
};

(function initHouseRules() {
  const saved = localStorage.getItem('uno-houseRules');
  if (saved) {
    try { Object.assign(houseRules, JSON.parse(saved)); } catch (e) {}
  }
})();

function saveHouseRules() {
  localStorage.setItem('uno-houseRules', JSON.stringify(houseRules));
}

// ============ DOM ============
const titleScreen = document.getElementById('title-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');
const turnBanner = document.getElementById('turn-banner');
const otherPlayersArea = document.getElementById('other-players');
const drawCountEl = document.getElementById('draw-count');
const discardPileEl = document.getElementById('discard-pile');
const directionIndicator = document.getElementById('direction-indicator');
const handArea = document.getElementById('hand-area');
const unoBtn = document.getElementById('uno-btn');
const colorDialog = document.getElementById('color-dialog');
const colorBackBtn = document.getElementById('color-back');
const challengeDialog = document.getElementById('challenge-dialog');
const challengeText = document.getElementById('challenge-text');
const challengeYesBtn = document.getElementById('challenge-yes');
const challengeNoBtn = document.getElementById('challenge-no');
const playBtn = document.getElementById('play-btn');
const passOverlay = document.getElementById('pass-overlay');
const passText = document.getElementById('pass-text');
const passOkBtn = document.getElementById('pass-ok');
const toastEl = document.getElementById('toast');
const resultTitle = document.getElementById('result-title');
const resultList = document.getElementById('result-list');
const restartBtn = document.getElementById('restart-btn');
const pauseOverlay = document.getElementById('pause-overlay');
const swapDialog = document.getElementById('swap-dialog');

// ============ Deck Building ============
function buildDeck() {
  const cards = [];
  for (const color of COLORS) {
    cards.push({ color, type: 'number', value: 0 });
    for (let n = 1; n <= 9; n++) {
      cards.push({ color, type: 'number', value: n });
      cards.push({ color, type: 'number', value: n });
    }
    for (const type of ['skip', 'reverse', 'draw2']) {
      cards.push({ color, type });
      cards.push({ color, type });
    }
  }
  for (let i = 0; i < 4; i++) {
    cards.push({ color: 'wild', type: 'wild' });
    cards.push({ color: 'wild', type: 'wild_draw4' });
  }
  return cards;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ============ Setup ============
function startGame(numPlayers, mode) {
  deck = buildDeck();
  shuffle(deck);
  discard = [];
  gameOver = false;
  gamePaused = false;
  direction = 1;
  pendingWildCard = null;
  pendingPlay = [];
  pendingWild4Challenge = null;
  awaitingPass = false;
  awaitingDrawPlay = false;
  pendingDrawCount = 0;
  pendingDrawType = null;

  players = [];
  if (mode === 'local') {
    for (let i = 0; i < numPlayers; i++) {
      players.push({ id: i, name: `プレイヤー${i + 1}`, isCPU: false, hand: [], unoDeclared: false });
    }
  } else {
    players.push({ id: 0, name: 'あなた', isCPU: false, hand: [], unoDeclared: false });
    for (let i = 1; i < numPlayers; i++) {
      players.push({ id: i, name: `CPU${i}`, isCPU: true, hand: [], unoDeclared: false });
    }
  }

  for (let r = 0; r < 7; r++) {
    for (const p of players) {
      p.hand.push(deck.pop());
    }
  }

  // First discard: cannot be wild, redraw if so
  let first;
  do {
    first = deck.pop();
    if (first.type.startsWith('wild')) {
      deck.unshift(first);
      shuffle(deck);
    }
  } while (first.type.startsWith('wild'));
  discard.push(first);
  currentColor = first.color;

  currentPlayer = 0;
  applyInitialCardEffect(first);
  awaitingPass = multiHuman() && !players[currentPlayer].isCPU;

  titleScreen.classList.add('hidden');
  resultScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');

  advanceTurnFlow();
}

function applyInitialCardEffect(card) {
  if (card.type === 'skip' || card.type === 'reverse') {
    if (card.type === 'reverse') {
      direction *= -1;
    }
    currentPlayer = nextPlayerIndex(currentPlayer);
  } else if (card.type === 'draw2') {
    const target = nextPlayerIndex(currentPlayer);
    drawCards(target, 2);
    currentPlayer = nextPlayerIndex(target);
  }
}

// ============ Helpers ============
function nextPlayerIndex(from) {
  const n = players.length;
  return (from + direction + n) % n;
}

function multiHuman() {
  return players.filter(p => !p.isCPU).length > 1;
}

function viewerIndex() {
  return multiHuman() ? currentPlayer : 0;
}

function topCard() {
  return discard[discard.length - 1];
}

function cardMatches(card) {
  const top = topCard();
  if (card.type === 'wild' || card.type === 'wild_draw4') return true;
  if (card.color === currentColor) return true;
  if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
  if (card.type !== 'number' && card.type === top.type) return true;
  return false;
}

function isDrawResponse(card) {
  if (!houseRules.drawStacking || pendingDrawCount === 0) return false;
  if (card.type === 'wild_draw4') return true;
  if (card.type === 'draw2' && pendingDrawType === 'draw2') return true;
  return false;
}

function drawCards(playerIndex, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (deck.length === 0) reshuffleDiscardIntoDeck();
    if (deck.length === 0) break;
    const c = deck.pop();
    players[playerIndex].hand.push(c);
    drawn.push(c);
  }
  if (players[playerIndex].hand.length > 1) {
    players[playerIndex].unoDeclared = false;
  }
  return drawn;
}

function reshuffleDiscardIntoDeck() {
  if (discard.length <= 1) return;
  const top = discard.pop();
  deck = discard.splice(0, discard.length);
  discard = [top];
  for (const c of deck) {
    if (c.type === 'wild' || c.type === 'wild_draw4') c.color = 'wild';
  }
  shuffle(deck);
}

function cardLabel(card) {
  switch (card.type) {
    case 'number': return String(card.value);
    case 'skip': return '🚫';
    case 'reverse': return '🔁';
    case 'draw2': return '+2';
    case 'wild': return 'WILD';
    case 'wild_draw4': return 'WILD+4';
    default: return '?';
  }
}

// ============ Rendering ============
function render() {
  renderTurnBanner();
  renderOtherPlayers();
  renderDiscard();
  renderDrawPile();
  renderHand();
  renderStatus();
  renderPassOverlay();
  renderRuleIndicators();
  renderPendingDrawBanner();
}

function renderTurnBanner() {
  const player = players[currentPlayer];
  let text;
  if (gameOver) {
    text = '';
  } else if (awaitingPass) {
    text = `${player.name} の番です`;
  } else if (player.isCPU) {
    text = `${player.name} が考え中…`;
  } else {
    text = `${player.name} のターン`;
  }
  turnBanner.textContent = text;
  turnBanner.className = 'turn-banner color-' + (currentColor || 'wild');
  turnBanner.classList.toggle('cpu-turn', !awaitingPass && player.isCPU);
  turnBanner.classList.toggle('your-turn', !awaitingPass && !player.isCPU);
}

function renderOtherPlayers() {
  otherPlayersArea.innerHTML = '';
  const viewer = viewerIndex();
  players.forEach((p, i) => {
    if (i === viewer) return;
    const wrap = document.createElement('div');
    wrap.className = 'cpu-player';
    const nameEl = document.createElement('div');
    nameEl.textContent = `${p.name} (${p.hand.length}枚)` + (p.unoDeclared ? ' UNO!' : '');
    wrap.appendChild(nameEl);
    const handEl = document.createElement('div');
    handEl.className = 'cpu-hand';
    const showCount = Math.min(p.hand.length, 7);
    for (let j = 0; j < showCount; j++) {
      const c = document.createElement('div');
      c.className = 'card card-back';
      handEl.appendChild(c);
    }
    wrap.appendChild(handEl);
    otherPlayersArea.appendChild(wrap);
  });
}

function renderDiscard() {
  discardPileEl.innerHTML = '';
  const top = topCard();
  if (!top) return;
  const el = makeCardElement(top, true);
  discardPileEl.appendChild(el);
}

function renderDrawPile() {
  drawCountEl.textContent = String(deck.length);
}

function makeCardElement(card, isOnPile) {
  const el = document.createElement('div');
  let colorClass = card.color;
  if (card.type.startsWith('wild')) {
    colorClass = isOnPile && currentColor && currentColor !== 'wild' ? currentColor : 'wild';
  }
  el.className = `card ${colorClass}`;
  const label = document.createElement('span');
  label.className = 'label' + (card.type !== 'number' && !card.type.startsWith('wild') ? ' symbol' : '');
  label.textContent = cardLabel(card);
  el.appendChild(label);
  el.setAttribute('data-label', cardLabel(card));
  return el;
}

function renderHand() {
  handArea.innerHTML = '';
  handArea.classList.remove('uno-active');
  if (gameOver || awaitingPass) return;

  const viewer = viewerIndex();
  const player = players[viewer];
  if (player.unoDeclared) handArea.classList.add('uno-active');
  const isMyTurn = viewer === currentPlayer;
  const firstSelected = pendingPlay.length > 0 ? player.hand[pendingPlay[0]] : null;

  // When draw stacking is pending, only draw-response cards are playable
  const inDrawStack = houseRules.drawStacking && pendingDrawCount > 0 && isMyTurn;

  player.hand.forEach((card, idx) => {
    const el = makeCardElement(card, false);

    if (pendingPlay.includes(idx)) {
      el.classList.add('selected-card');
    } else if (firstSelected) {
      const canAdd = card.type === 'number' && card.value === firstSelected.value && cardMatches(card);
      if (canAdd) el.classList.add('addable');
    }

    // Desktop click
    el.addEventListener('click', () => onHandCardClick(idx));

    // Touch: hold to preview (enlarge), swipe up to play
    let touchStartY = 0;
    let touchStartX = 0;
    el.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      el.classList.add('touch-active');
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      el.classList.remove('touch-active');
      const dy = e.changedTouches[0].clientY - touchStartY;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (dy < -40 && Math.abs(dx) < 70) {
        onHandCardClick(idx);
      }
    });

    handArea.appendChild(el);
  });
}

function renderStatus() {
  directionIndicator.textContent = direction === 1 ? '→' : '←';

  if (gameOver) {
    unoBtn.disabled = true;
    playBtn.classList.add('hidden');
    return;
  }

  const player = players[currentPlayer];
  const canDeclare = !awaitingPass && !player.isCPU && !player.unoDeclared &&
    (player.hand.length === 1 || player.hand.length === 2);
  unoBtn.disabled = !canDeclare;
  unoBtn.classList.toggle('uno-declared', !!player.unoDeclared);

  const unoReach = document.getElementById('uno-reach');
  if (unoReach) {
    const viewerDeclared = !awaitingPass && !players[viewerIndex()].isCPU && players[viewerIndex()].unoDeclared;
    unoReach.classList.toggle('hidden', !viewerDeclared);
  }

  if (pendingPlay.length > 0) {
    playBtn.classList.remove('hidden');
    playBtn.textContent = `出す (${pendingPlay.length}枚)`;
  } else {
    playBtn.classList.add('hidden');
  }
}

function renderPassOverlay() {
  if (!gameOver && awaitingPass) {
    passText.textContent = `${players[currentPlayer].name} の番です。タップして手札を表示します。`;
    passOverlay.classList.remove('hidden');
  } else {
    passOverlay.classList.add('hidden');
  }
}

function renderRuleIndicators() {
  const el = document.getElementById('rule-indicators');
  if (!el) return;
  const active = [];
  if (houseRules.stackSameNumber) active.push({ icon: '🔢', label: '複数出し' });
  if (houseRules.drawStacking)    active.push({ icon: '➕', label: 'ドロー重ね' });
  if (houseRules.zeroRotate)      active.push({ icon: '🔄', label: '0回転' });
  if (houseRules.sevenSwap)       active.push({ icon: '🔃', label: '7交換' });
  if (active.length === 0) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = active.map(r => `<span class="rule-badge">${r.icon} ${r.label}</span>`).join('');
}

function renderPendingDrawBanner() {
  const banner = document.getElementById('pending-draw-banner');
  const numEl = document.getElementById('pending-draw-num');
  if (!banner || !numEl) return;
  if (pendingDrawCount > 0) {
    numEl.textContent = String(pendingDrawCount);
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

// ============ Pause / Quit ============
function pauseGame() {
  gamePaused = true;
  pauseOverlay.classList.remove('hidden');
}

function resumeGame() {
  gamePaused = false;
  pauseOverlay.classList.add('hidden');
  advanceTurnFlow();
}

function quitToTitle() {
  gameOver = true;
  gamePaused = false;
  pendingWildCard = null;
  pendingPlay = [];
  pendingWild4Challenge = null;
  pendingDrawCount = 0;
  pendingDrawType = null;
  pauseOverlay.classList.add('hidden');
  gameScreen.classList.add('hidden');
  titleScreen.classList.remove('hidden');
}

document.getElementById('pause-btn').addEventListener('click', pauseGame);
document.getElementById('pause-resume').addEventListener('click', resumeGame);
document.getElementById('pause-quit').addEventListener('click', quitToTitle);

// ============ Turn flow ============
function advanceTurnFlow() {
  if (gamePaused) return;
  pendingPlay = [];
  render();
  if (gameOver) return;

  if (awaitingPass) return; // wait for pass-overlay tap

  // Handle pending draw from stacking rule
  if (houseRules.drawStacking && pendingDrawCount > 0) {
    const player = players[currentPlayer];
    const canRespond = player.hand.some(c => isDrawResponse(c));
    if (!player.isCPU && !canRespond) {
      handlePendingDraw(currentPlayer);
      return;
    } else if (!player.isCPU && canRespond) {
      render();
      return;
    } else if (player.isCPU) {
      setTimeout(cpuTurn, 700);
      return;
    }
  }

  const player = players[currentPlayer];
  if (player.isCPU) {
    setTimeout(cpuTurn, 700);
  } else if (!awaitingDrawPlay && !player.hand.some(c => cardMatches(c))) {
    setTimeout(() => handleNoPlayableTurn(currentPlayer), 600);
  }
}

passOkBtn.addEventListener('click', () => {
  awaitingPass = false;
  advanceTurnFlow();
});

// ============ Player Actions ============
function onHandCardClick(idx) {
  if (gameOver || pendingWildCard !== null || awaitingPass) return;
  const viewer = viewerIndex();
  if (viewer !== currentPlayer) return;
  const player = players[viewer];
  if (player.isCPU) return;
  const card = player.hand[idx];

  // In draw stacking mode, only draw-response cards are clickable
  if (houseRules.drawStacking && pendingDrawCount > 0) {
    if (!isDrawResponse(card)) return;
    // Play the draw response card immediately
    if (card.type === 'wild_draw4') {
      pendingPlay = [];
      pendingWildCard = idx;
      colorDialog.classList.remove('hidden');
    } else {
      // draw2 response: play immediately
      pendingPlay = [];
      playCardCommon(currentPlayer, idx, null);
    }
    return;
  }

  if (!cardMatches(card)) return;

  if (card.type === 'wild' || card.type === 'wild_draw4') {
    pendingPlay = [];
    pendingWildCard = idx;
    colorDialog.classList.remove('hidden');
    return;
  }

  if (card.type !== 'number') {
    pendingPlay = [];
    playCardCommon(currentPlayer, idx, null);
    return;
  }

  // Number card: if stackSameNumber rule is OFF, play immediately on single click
  if (!houseRules.stackSameNumber) {
    pendingPlay = [];
    playCardCommon(currentPlayer, idx, null);
    return;
  }

  // Multi-select logic (only when stackSameNumber is ON)
  if (pendingPlay.length === 0) {
    pendingPlay = [idx];
  } else {
    const firstCard = player.hand[pendingPlay[0]];
    if (card.value === firstCard.value) {
      const pos = pendingPlay.indexOf(idx);
      if (pos >= 0) {
        pendingPlay.splice(pos, 1);
      } else {
        pendingPlay.push(idx);
      }
    } else {
      pendingPlay = [idx];
    }
  }

  render();
}

playBtn.addEventListener('click', () => {
  if (pendingPlay.length === 0) return;
  playSelectedCards();
});

function playSelectedCards() {
  const player = players[currentPlayer];
  const sorted = [...pendingPlay].sort((a, b) => b - a);
  const cards = sorted.map(i => player.hand[i]);
  for (const i of sorted) player.hand.splice(i, 1);
  for (let i = cards.length - 1; i >= 0; i--) discard.push(cards[i]);
  currentColor = topCard().color;
  pendingPlay = [];

  if (player.hand.length !== 1) player.unoDeclared = false;

  if (player.hand.length === 0) {
    render();
    endGame(currentPlayer);
    return;
  }

  currentPlayer = nextPlayerIndex(currentPlayer);
  awaitingPass = multiHuman() && !players[currentPlayer].isCPU;
  advanceTurnFlow();
}

colorDialog.addEventListener('click', (e) => {
  if (e.target.id === 'color-back') {
    colorDialog.classList.add('hidden');
    pendingWildCard = null;
    render();
    return;
  }
  const btn = e.target.closest('.color-btn');
  if (!btn) return;
  const color = btn.dataset.color;
  colorDialog.classList.add('hidden');
  if (pendingWildCard !== null) {
    const idx = pendingWildCard;
    pendingWildCard = null;
    playCardCommon(currentPlayer, idx, color);
  }
});

challengeYesBtn.addEventListener('click', () => {
  challengeDialog.classList.add('hidden');
  const { target, attackerIndex, hadMatch } = pendingWild4Challenge;
  pendingWild4Challenge = null;
  if (hadMatch) {
    drawCards(attackerIndex, 4);
    currentPlayer = target;
    showToast('チャレンジ成功！相手が4枚引きました');
  } else {
    drawCards(target, 6);
    currentPlayer = nextPlayerIndex(target);
    showToast('チャレンジ失敗... 6枚引きます');
  }
  awaitingPass = multiHuman() && !players[currentPlayer].isCPU;
  advanceTurnFlow();
});

challengeNoBtn.addEventListener('click', () => {
  challengeDialog.classList.add('hidden');
  const { target } = pendingWild4Challenge;
  pendingWild4Challenge = null;
  drawCards(target, 4);
  currentPlayer = nextPlayerIndex(target);
  awaitingPass = multiHuman() && !players[currentPlayer].isCPU;
  advanceTurnFlow();
});

unoBtn.addEventListener('click', () => {
  const player = players[currentPlayer];
  if (gameOver || awaitingPass || player.isCPU) return;
  if (player.hand.length === 1 || player.hand.length === 2) {
    player.unoDeclared = true;
    showUnoEffect();
    render();
  }
});

function showUnoEffect() {
  const el = document.createElement('div');
  el.className = 'uno-effect';
  el.textContent = 'UNO!';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function showConfetti() {
  const emojis = ['🎉', '⭐', '🏆', '✨', '🌟', '🎊', '💫', '🃏'];
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    el.style.left = (Math.random() * 100) + 'vw';
    el.style.animationDelay = (Math.random() * 1.8) + 's';
    el.style.fontSize = (16 + Math.random() * 22) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }
}

// ============ Draw card animation ============
function animateDrawCard(callback) {
  const pileEl = document.getElementById('draw-pile');
  const pileRect = pileEl.getBoundingClientRect();
  const handRect = handArea.getBoundingClientRect();

  // If element has no size (e.g. test environment), skip animation
  if (pileRect.width === 0 && pileRect.height === 0) {
    callback();
    return;
  }

  // Pulse the draw pile
  pileEl.classList.add('draw-pulse');
  setTimeout(() => pileEl.classList.remove('draw-pulse'), 300);

  const anim = document.createElement('div');
  anim.className = 'card card-back';
  anim.style.cssText = `position:fixed;left:${pileRect.left}px;top:${pileRect.top}px;width:${pileRect.width}px;height:${pileRect.height}px;z-index:200;pointer-events:none;transition:none;`;
  document.body.appendChild(anim);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const dx = handRect.left + handRect.width / 2 - pileRect.left - pileRect.width / 2;
    const dy = handRect.top + 10 - pileRect.top;
    anim.style.transition = 'transform 0.42s cubic-bezier(0.3,0,0.2,1), opacity 0.15s ease 0.35s';
    anim.style.transform = `translate(${dx}px,${dy}px) scale(0.88)`;
    anim.style.opacity = '0';
  }));
  setTimeout(() => { anim.remove(); callback(); }, 500);
}

// ============ Pass visual effect ============
function showPassEffect(playerIndex) {
  const isViewer = playerIndex === viewerIndex();
  const el = document.createElement('div');
  el.className = 'pass-effect ' + (isViewer ? 'pass-bottom' : 'pass-top');
  el.textContent = (isViewer ? '' : players[playerIndex].name + ' ') + 'パス';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

// ============ Auto-draw when no playable card ============
function handleNoPlayableTurn(playerIndex) {
  if (gamePaused) return;
  const player = players[playerIndex];

  animateDrawCard(() => {
    const drawn = drawCards(playerIndex, 1)[0];
    render();

    if (drawn && cardMatches(drawn)) {
      if (player.isCPU) {
        // CPU auto-plays the drawn card
        const idx = player.hand.length - 1;
        const chosenColor = drawn.type.startsWith('wild') ? chooseCpuColor(player) : null;
        setTimeout(() => playCardCommon(playerIndex, idx, chosenColor), 700);
      } else {
        // Human: highlight drawn card, let them play it manually (swipe up)
        const cards = handArea.querySelectorAll('.card');
        if (cards.length > 0) cards[cards.length - 1].classList.add('just-drawn');
        awaitingDrawPlay = true;
      }
    } else {
      setTimeout(passTurnAfterDraw, 700);
    }
  });
}

function passTurnAfterDraw() {
  if (gamePaused) return;
  showPassEffect(currentPlayer);
  awaitingDrawPlay = false;
  currentPlayer = nextPlayerIndex(currentPlayer);
  awaitingPass = multiHuman() && !players[currentPlayer].isCPU;
  advanceTurnFlow();
}

// ============ Draw Stacking helpers ============
function handlePendingDraw(playerIndex) {
  const count = pendingDrawCount;
  pendingDrawCount = 0;
  pendingDrawType = null;
  showToast(`${players[playerIndex].name}：${count}枚引きます！`);
  drawCards(playerIndex, count);
  render();
  setTimeout(() => {
    currentPlayer = nextPlayerIndex(playerIndex);
    awaitingPass = multiHuman() && !players[currentPlayer].isCPU;
    advanceTurnFlow();
  }, 800);
}

// ============ Play Card ============
function playCardCommon(playerIndex, handIdx, chosenColor) {
  awaitingDrawPlay = false;
  const player = players[playerIndex];
  const card = player.hand.splice(handIdx, 1)[0];
  discard.push(card);

  currentColor = card.type.startsWith('wild') ? chosenColor : card.color;

  if (player.hand.length !== 1) player.unoDeclared = false;

  if (player.hand.length === 0) {
    render();
    endGame(playerIndex);
    return;
  }

  let target = nextPlayerIndex(currentPlayer);

  switch (card.type) {
    case 'skip':
      currentPlayer = nextPlayerIndex(target);
      break;
    case 'reverse':
      direction *= -1;
      if (players.length === 2) {
        currentPlayer = nextPlayerIndex(nextPlayerIndex(currentPlayer));
      } else {
        currentPlayer = nextPlayerIndex(currentPlayer);
      }
      break;
    case 'draw2':
      if (houseRules.drawStacking) {
        pendingDrawCount += 2;
        if (!pendingDrawType) pendingDrawType = 'draw2';
        currentPlayer = nextPlayerIndex(currentPlayer); // target's turn to respond or draw
      } else {
        drawCards(target, 2);
        currentPlayer = nextPlayerIndex(target);
      }
      break;
    case 'wild_draw4':
      // When drawStacking is ON, skip challenge dialog and just stack
      if (houseRules.drawStacking) {
        pendingDrawCount += 4;
        pendingDrawType = 'wild_draw4';
        currentPlayer = nextPlayerIndex(currentPlayer);
      } else if (pendingWild4Challenge) {
        const { target: chalTarget, attackerIndex, hadMatch } = pendingWild4Challenge;
        challengeText.textContent = `${players[attackerIndex].name} が WILD+4 を出しました。チャレンジしますか？（${players[attackerIndex].name}が出せるカードを持っていた場合は成功）`;
        render();
        challengeDialog.classList.remove('hidden');
        return;
      } else {
        drawCards(target, 4);
        currentPlayer = nextPlayerIndex(target);
      }
      break;
    default:
      // Handle zero rotate
      if (card.type === 'number' && card.value === 0 && houseRules.zeroRotate) {
        executeZeroRotate();
      }
      // Handle seven swap
      if (card.type === 'number' && card.value === 7 && houseRules.sevenSwap) {
        handleSevenSwap(playerIndex);
        return; // handleSevenSwap calls advanceTurnFlow after swap
      }
      currentPlayer = target;
  }

  awaitingPass = multiHuman() && !players[currentPlayer].isCPU;
  advanceTurnFlow();
}

// ============ Zero Rotate ============
function executeZeroRotate() {
  const n = players.length;
  const savedHands = players.map(p => p.hand.slice());
  // Rotate hands in the direction of play
  // direction=1: player i gets hand from player (i - 1 + n) % n
  // direction=-1: player i gets hand from player (i + 1) % n
  for (let i = 0; i < n; i++) {
    const fromIdx = (i - direction + n) % n;
    players[i].hand = savedHands[fromIdx];
  }
  players.forEach(p => { p.unoDeclared = false; });
  showToast('0で手札がローテーション！');
}

// ============ Seven Swap ============
function handleSevenSwap(playerIndex) {
  const player = players[playerIndex];
  if (player.isCPU) {
    // CPU: swap with the player who has fewest cards (excluding self)
    const target = players
      .filter((_, i) => i !== playerIndex)
      .reduce((min, p) => p.hand.length < min.hand.length ? p : min);
    executeSwap(playerIndex, target.id);
    return;
  }

  const others = players.filter((_, i) => i !== playerIndex);
  if (others.length === 1) {
    executeSwap(playerIndex, others[0].id);
  } else {
    const choicesEl = document.getElementById('swap-choices');
    choicesEl.innerHTML = '';
    others.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'swap-btn';
      btn.textContent = `${p.name}（${p.hand.length}枚）`;
      btn.addEventListener('click', () => {
        swapDialog.classList.add('hidden');
        executeSwap(playerIndex, p.id);
      });
      choicesEl.appendChild(btn);
    });
    swapDialog.classList.remove('hidden');
  }
}

function executeSwap(p1Idx, p2Idx) {
  const tmp = players[p1Idx].hand;
  players[p1Idx].hand = players[p2Idx].hand;
  players[p2Idx].hand = tmp;
  players[p1Idx].unoDeclared = false;
  players[p2Idx].unoDeclared = false;
  showToast(`${players[p1Idx].name}と${players[p2Idx].name}が手札を交換！`);
  currentPlayer = nextPlayerIndex(p1Idx);
  awaitingPass = multiHuman() && !players[currentPlayer].isCPU;
  advanceTurnFlow();
}

// ============ CPU Logic ============
function cpuTurn() {
  if (gameOver || gamePaused) return;
  const player = players[currentPlayer];

  // Handle draw stacking when CPU must respond or draw
  if (houseRules.drawStacking && pendingDrawCount > 0) {
    const responses = player.hand.filter(c => isDrawResponse(c));
    if (responses.length > 0) {
      const choice = responses.find(c => c.type === 'wild_draw4') || responses[0];
      const idx = player.hand.indexOf(choice);
      const color = choice.type === 'wild_draw4' ? chooseCpuColor(player) : null;
      setTimeout(() => playCardCommon(currentPlayer, idx, color), 500);
    } else {
      handlePendingDraw(currentPlayer);
    }
    return;
  }

  const playable = player.hand
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => cardMatches(c));

  if (playable.length === 0) {
    handleNoPlayableTurn(currentPlayer);
    return;
  }

  const choice = chooseCpuCard(playable, player);
  const card = player.hand[choice.i];
  let chosenColor = null;
  if (card.type.startsWith('wild')) {
    chosenColor = chooseCpuColor(player);
  }

  if (player.hand.length === 2) {
    player.unoDeclared = true;
  }

  if (card.type === 'wild_draw4' && !houseRules.drawStacking) {
    const target = nextPlayerIndex(currentPlayer);
    if (!players[target].isCPU) {
      const hadMatch = player.hand
        .filter((c, i) => i !== choice.i)
        .some(c => c.color === currentColor);
      pendingWild4Challenge = { target, attackerIndex: currentPlayer, hadMatch };
    }
  }

  setTimeout(() => {
    playCardCommon(currentPlayer, choice.i, chosenColor);
  }, 500);
}

function chooseCpuCard(playable, player) {
  // Avoid wild_draw4 unless it's the only option
  const nonWild4 = playable.filter(p => p.c.type !== 'wild_draw4');
  const pool = nonWild4.length > 0 ? nonWild4 : playable;

  // Prefer action cards (skip, reverse, draw2) first
  const actions = pool.filter(p => ['skip', 'reverse', 'draw2'].includes(p.c.type));
  if (actions.length > 0) return actions[0];

  // Prefer same-color numbers over wild
  const nonWild = pool.filter(p => p.c.color !== 'wild');
  if (nonWild.length > 0) return nonWild[0];

  return pool[0];
}

function chooseCpuColor(player) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of player.hand) {
    if (counts[c.color] !== undefined) counts[c.color]++;
  }
  let best = COLORS[0];
  for (const col of COLORS) {
    if (counts[col] > counts[best]) best = col;
  }
  return best;
}

// ============ Game End ============
function endGame(winnerIndex) {
  gameOver = true;
  render();
  gameScreen.classList.add('hidden');
  resultScreen.classList.remove('hidden');

  const humanPlayer = players.find(p => !p.isCPU) || players[0];
  const humanWon = winnerIndex === humanPlayer.id;

  resultTitle.textContent = humanWon ? '🏆 あなたの勝ち！' : `😢 ${players[winnerIndex].name} の勝ち`;
  resultTitle.className = humanWon ? 'win-title' : 'lose-title';

  resultList.innerHTML = '';
  const sorted = [...players].sort((a, b) => {
    if (a.id === winnerIndex) return -1;
    if (b.id === winnerIndex) return 1;
    return a.hand.reduce((s, c) => s + cardScore(c), 0) - b.hand.reduce((s, c) => s + cardScore(c), 0);
  });

  sorted.forEach((p, rank) => {
    const row = document.createElement('div');
    row.className = 'result-row' + (p.id === winnerIndex ? ' result-winner' : '');
    const score = p.hand.reduce((sum, c) => sum + cardScore(c), 0);
    const medal = ['🥇', '🥈', '🥉'][rank] || '　';
    row.innerHTML = `<span class="result-name">${medal} ${p.name}</span><span class="result-score">${p.id === winnerIndex ? '0点（勝者！）' : `${score}点（${p.hand.length}枚）`}</span>`;
    resultList.appendChild(row);
  });

  if (humanWon) showConfetti();
}

function cardScore(card) {
  switch (card.type) {
    case 'number': return card.value;
    case 'skip':
    case 'reverse':
    case 'draw2':
      return 20;
    case 'wild':
    case 'wild_draw4':
      return 50;
    default: return 0;
  }
}

// ============ Toast ============
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ============ Init ============
document.querySelectorAll('.player-select button').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    const num = parseInt(btn.dataset.num, 10);
    if (mode === 'local') {
      startGame(num, 'local');
    } else {
      startGame(num + 1, 'cpu');
    }
  });
});

restartBtn.addEventListener('click', () => {
  resultScreen.classList.add('hidden');
  titleScreen.classList.remove('hidden');
});

// ============ Background theme ============
function applyBackground(name) {
  document.body.className = 'bg-' + name;
  localStorage.setItem('uno-bg', name);
}

document.querySelectorAll('.bg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    applyBackground(btn.dataset.bg);
    document.querySelectorAll('.bg-btn').forEach(b => b.classList.toggle('selected', b === btn));
  });
});

(function initBackground() {
  const saved = localStorage.getItem('uno-bg') || 'purple';
  applyBackground(saved);
  document.querySelectorAll('.bg-btn').forEach(b => b.classList.toggle('selected', b.dataset.bg === saved));
})();

// ============ House Rules UI ============
['stackSameNumber', 'drawStacking', 'zeroRotate', 'sevenSwap'].forEach(key => {
  const el = document.getElementById('rule-' + key);
  if (!el) return;
  el.checked = houseRules[key];
  el.addEventListener('change', () => {
    houseRules[key] = el.checked;
    saveHouseRules();
  });
});

document.getElementById('rules-btn').addEventListener('click', () => {
  document.getElementById('rules-panel').classList.remove('hidden');
});
document.getElementById('rules-close').addEventListener('click', () => {
  document.getElementById('rules-panel').classList.add('hidden');
});
