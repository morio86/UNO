'use strict';
/*
 * Runs in the browser alongside script.js (loaded as a normal <script>,
 * so top-level let/const declarations like `players`, `deck`, etc. and
 * function declarations like `buildDeck`, `cardMatches` are visible here
 * via the shared global scope).
 */

const log = [];
let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    log.push('FAIL: ' + msg);
  }
}
function assertEqual(actual, expected, msg) {
  assert(actual === expected, `${msg} (expected ${expected}, got ${actual})`);
}

// ================= Unit tests =================

// --- buildDeck ---
(function testBuildDeck() {
  const d = buildDeck();
  assertEqual(d.length, 108, 'buildDeck: total card count');

  const counts = {};
  for (const c of d) {
    const key = c.type === 'number' ? `${c.color}-num-${c.value}` : `${c.color}-${c.type}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const colors = ['red', 'yellow', 'green', 'blue'];
  for (const color of colors) {
    assertEqual(counts[`${color}-num-0`], 1, `buildDeck: ${color} 0 count`);
    for (let n = 1; n <= 9; n++) {
      assertEqual(counts[`${color}-num-${n}`], 2, `buildDeck: ${color} ${n} count`);
    }
    for (const type of ['skip', 'reverse', 'draw2']) {
      assertEqual(counts[`${color}-${type}`], 2, `buildDeck: ${color} ${type} count`);
    }
  }
  assertEqual(d.filter(c => c.type === 'wild').length, 4, 'buildDeck: wild count');
  assertEqual(d.filter(c => c.type === 'wild_draw4').length, 4, 'buildDeck: wild_draw4 count');
})();

// --- cardScore ---
(function testCardScore() {
  assertEqual(cardScore({ type: 'number', value: 7 }), 7, 'cardScore: number');
  assertEqual(cardScore({ type: 'number', value: 0 }), 0, 'cardScore: zero');
  assertEqual(cardScore({ type: 'skip' }), 20, 'cardScore: skip');
  assertEqual(cardScore({ type: 'reverse' }), 20, 'cardScore: reverse');
  assertEqual(cardScore({ type: 'draw2' }), 20, 'cardScore: draw2');
  assertEqual(cardScore({ type: 'wild' }), 50, 'cardScore: wild');
  assertEqual(cardScore({ type: 'wild_draw4' }), 50, 'cardScore: wild_draw4');
})();

// --- cardMatches ---
(function testCardMatches() {
  startGame(2);
  window.__timerQueue.length = 0;

  discard.length = 0;
  discard.push({ color: 'red', type: 'number', value: 5 });
  currentColor = 'red';

  assert(cardMatches({ color: 'blue', type: 'number', value: 5 }) === true,
    'cardMatches: same number different color matches');
  assert(cardMatches({ color: 'green', type: 'number', value: 3 }) === false,
    'cardMatches: different color and number does not match');
  assert(cardMatches({ color: 'red', type: 'number', value: 9 }) === true,
    'cardMatches: same color matches');
  assert(cardMatches({ color: 'wild', type: 'wild' }) === true,
    'cardMatches: wild always matches');
  assert(cardMatches({ color: 'wild', type: 'wild_draw4' }) === true,
    'cardMatches: wild_draw4 always matches');

  discard.length = 0;
  discard.push({ color: 'green', type: 'skip' });
  currentColor = 'green';
  assert(cardMatches({ color: 'blue', type: 'skip' }) === true,
    'cardMatches: same action type different color matches');
  assert(cardMatches({ color: 'blue', type: 'reverse' }) === false,
    'cardMatches: different action type and color does not match');
})();

// --- nextPlayerIndex ---
(function testNextPlayerIndex() {
  startGame(3);
  window.__timerQueue.length = 0;

  direction = 1;
  assertEqual(nextPlayerIndex(0), 1, 'nextPlayerIndex: forward 0->1');
  assertEqual(nextPlayerIndex(2), 0, 'nextPlayerIndex: forward wrap 2->0');
  direction = -1;
  assertEqual(nextPlayerIndex(0), 2, 'nextPlayerIndex: reverse wrap 0->2');
  assertEqual(nextPlayerIndex(2), 1, 'nextPlayerIndex: reverse 2->1');
})();

// ================= Integration: full game simulation =================
function playFullGame(numPlayers) {
  // Reset house rules to defaults so tests are not affected by localStorage state
  houseRules.stackSameNumber = false;
  houseRules.drawStacking = false;
  houseRules.zeroRotate = false;
  houseRules.sevenSwap = false;
  startGame(numPlayers);
  let iterations = 0;
  const MAX = 5000;
  while (!gameOver && iterations < MAX) {
    iterations++;
    if (window.__timerQueue.length) {
      const fn = window.__timerQueue.shift();
      fn();
    } else if (pendingWildCard !== null && !players[currentPlayer].isCPU) {
      // Human wild card awaiting color choice — pick red
      const idx = pendingWildCard;
      pendingWildCard = null;
      playCardCommon(currentPlayer, idx, 'red');
    } else if (awaitingDrawPlay) {
      // Human drew a forced card; pass the turn without playing
      awaitingDrawPlay = false;
      passTurnAfterDraw();
    } else if (!players[currentPlayer].isCPU) {
      // Human's turn: play a card or force-draw
      const p = players[currentPlayer];
      const pi = p.hand.findIndex(c => cardMatches(c));
      if (pi >= 0) {
        onHandCardClick(pi);
      } else {
        handleNoPlayableTurn(currentPlayer);
      }
    } else {
      cpuTurn();
    }
  }
  return iterations;
}

(function testFullGames() {
  for (const numPlayers of [2, 3, 4]) {
    for (let trial = 0; trial < 10; trial++) {
      window.__timerQueue.length = 0;
      const iterations = playFullGame(numPlayers);

      assert(iterations < 5000, `game(${numPlayers}p,trial${trial}): finishes without runaway loop (iterations=${iterations})`);
      assert(gameOver === true, `game(${numPlayers}p,trial${trial}): gameOver becomes true`);

      const winners = players.filter(p => p.hand.length === 0);
      assertEqual(winners.length, 1, `game(${numPlayers}p,trial${trial}): exactly one winner`);

      const total = deck.length + discard.length +
        players.reduce((s, p) => s + p.hand.length, 0);
      assertEqual(total, 108, `game(${numPlayers}p,trial${trial}): total card count conserved`);

      for (const p of players) {
        assert(p.hand.length >= 0, `game(${numPlayers}p,trial${trial}): hand size non-negative for ${p.name}`);
      }
    }
  }
})();

// ================= New feature tests =================

// --- UNO declaration window (2 cards left, before playing down to 1) ---
(function testUnoDeclareAtTwo() {
  startGame(2);
  window.__timerQueue.length = 0;

  const me = players[0];
  me.hand = [
    { color: 'red', type: 'number', value: 1 },
    { color: 'red', type: 'number', value: 2 },
  ];
  discard.length = 0;
  discard.push({ color: 'red', type: 'number', value: 9 });
  currentColor = 'red';
  currentPlayer = 0;
  me.unoDeclared = false;

  assert(me.hand.length === 2 && !me.unoDeclared,
    'uno: starts un-declared with 2 cards');

  // Simulate pressing the UNO button while 2 cards remain.
  me.unoDeclared = true;

  playCardCommon(0, 0, null); // play one of the two cards -> hand becomes 1
  assertEqual(me.hand.length, 1, 'uno: hand reduced to 1 after playing');
  assert(me.unoDeclared === true,
    'uno: declaration made at 2 cards survives playing down to 1');
})();

// --- drawCards resets a stale UNO declaration once hand grows again ---
(function testUnoResetOnDraw() {
  startGame(2);
  window.__timerQueue.length = 0;

  const me = players[0];
  me.hand = [{ color: 'red', type: 'number', value: 1 }];
  me.unoDeclared = true;

  drawCards(0, 2);
  assertEqual(me.hand.length, 3, 'uno-reset: hand grew after drawing');
  assert(me.unoDeclared === false,
    'uno-reset: declaration cleared once hand has more than 1 card');
})();

// --- Auto-draw: no playable card draws one and ends turn ---
(function testAutoDrawNoPlay() {
  startGame(2);
  window.__timerQueue.length = 0;

  // Force a hand with nothing matching the discard.
  discard.length = 0;
  discard.push({ color: 'red', type: 'number', value: 5 });
  currentColor = 'red';

  const startingDeckSize = deck.length;
  players[0].hand = [{ color: 'blue', type: 'number', value: 1 }];
  // Ensure the top of the deck (which will be drawn) does not match either.
  deck.push({ color: 'green', type: 'number', value: 3 });
  currentPlayer = 0;

  handleNoPlayableTurn(0);

  // animateDrawCard queues timers before the draw callback; drain until draw has run.
  while (players[0].hand.length < 2 && window.__timerQueue.length > 0) {
    window.__timerQueue.shift()();
  }

  assertEqual(players[0].hand.length, 2, 'auto-draw: player receives exactly one drawn card');
  assertEqual(deck.length, startingDeckSize, 'auto-draw: deck shrinks by the drawn card');

  // At least one callback is queued: the turn-pass action.
  assert(window.__timerQueue.length >= 1, 'auto-draw: turn-pass callback is queued');
  window.__timerQueue.pop()(); // run the turn-pass callback (queued last)
  assertEqual(currentPlayer, 1, 'auto-draw: turn passes to next player when drawn card is unplayable');
})();

// --- Auto-draw: drawn card is playable, human awaits manual play ---
(function testAutoDrawHumanAwaits() {
  startGame(2);
  window.__timerQueue.length = 0;

  discard.length = 0;
  discard.push({ color: 'red', type: 'number', value: 5 });
  currentColor = 'red';

  players[0].hand = [{ color: 'blue', type: 'number', value: 1 }];
  // Top of deck matches by color -> human should await manual play.
  deck.push({ color: 'red', type: 'number', value: 8 });
  currentPlayer = 0;

  handleNoPlayableTurn(0);

  // animateDrawCard queues timers before the draw callback; drain until draw has run.
  while (players[0].hand.length < 2 && window.__timerQueue.length > 0) {
    window.__timerQueue.shift()();
  }

  assertEqual(players[0].hand.length, 2, 'auto-draw+human: card drawn into hand');
  assert(awaitingDrawPlay === true, 'auto-draw+human: awaitingDrawPlay set for human');
  assertEqual(window.__timerQueue.length, 0, 'auto-draw+human: no auto-play timer queued');

  // Human manually plays the drawn card (last in hand)
  const idx = players[0].hand.length - 1;
  onHandCardClick(idx);
  // Check immediately after click, before draining CPU timers
  assertEqual(players[0].hand.length, 1, 'auto-draw+human: card played manually');
  assert(awaitingDrawPlay === false, 'auto-draw+human: awaitingDrawPlay cleared after play');
})();

// --- Local 2-human pass-and-play mode ---
(function testLocalMultiplayerPassFlow() {
  startGame(2, 'local');

  assert(players.every(p => !p.isCPU), 'local: both players are human');
  assertEqual(players[0].name, 'プレイヤー1', 'local: player 1 name');
  assertEqual(players[1].name, 'プレイヤー2', 'local: player 2 name');
  assert(multiHuman() === true, 'local: multiHuman is true for 2-human mode');

  if (awaitingPass) {
    assert(passOverlay.classList.contains('hidden') === false,
      'local: pass overlay shown before a human player\'s turn');
    assert(handArea.children.length === 0,
      'local: hand is hidden behind the pass overlay');

    awaitingPass = false;
    advanceTurnFlow();
  }

  assert(passOverlay.classList.contains('hidden') === true,
    'local: pass overlay hidden after confirming');
})();

// --- Turn banner reflects whose turn it is ---
(function testTurnBanner() {
  startGame(2, 'local');
  window.__timerQueue.length = 0;
  awaitingPass = false;
  render();

  assert(turnBanner.textContent.includes(players[currentPlayer].name),
    'turn-banner: shows current player\'s name');
  assert(turnBanner.classList.contains('your-turn'),
    'turn-banner: marks a human player\'s turn distinctly');
})();

// ================= Summary =================
const summary = `${pass} passed, ${fail} failed`;
log.push('');
log.push('RESULT: ' + summary);

const resultsEl = document.getElementById('results');
resultsEl.textContent = log.join('\n');
if (fail > 0) resultsEl.classList.add('fail');
console.log(log.join('\n'));
document.title = (fail > 0 ? 'FAIL ' : 'PASS ') + summary;
