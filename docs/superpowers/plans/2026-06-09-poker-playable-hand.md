# Playable No-Limit Hold'em Hand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, playable single hand of No-Limit Texas Hold'em over Socket.io — deal to showdown with a real winner — replacing the current canvas skeleton.

**Architecture:** Server-authoritative. The backend owns a `PokerTable` state machine and a pure `handEvaluator`; clients receive a personalized game state (own hole cards only) and send action intents that the server validates. Frontend is full-DOM (HTML+CSS), no canvas.

**Tech Stack:** Node 20, Express, Socket.io, Node built-in test runner (`node:test` / `node:assert`), vanilla DOM on the client.

**Spec:** `docs/superpowers/specs/2026-06-09-poker-playable-hand-design.md`

**Commit discipline:** Commit after each task (each task is a coherent chunk). Commit messages are given per task.

---

## File Structure

**Create:**
- `game/cards.js` — `Card` shape, `Deck` (Fisher–Yates shuffle, draw). Pure, CommonJS.
- `game/handEvaluator.js` — `score5`, `compareScores`, `evaluateBest`. Pure.
- `game/PokerTable.js` — the hand state machine + betting engine.
- `test/cards.test.js`, `test/handEvaluator.test.js`, `test/pokerTable.test.js` — unit tests.
- `public/css/table.css` — table/seat/card/control styling.
- `public/js/render.js` — render the DOM table from a game-state object.

**Modify:**
- `backend.js` — replace deck-broadcast wiring with `PokerTable` + per-socket state.
- `public/index.html` — replace `<canvas>` with a DOM table; update script tags.
- `public/js/frontend.js` — socket connection + state handling + render dispatch.
- `public/js/eventListeners.js` — wire Start Hand + betting controls to emit intents.
- `package.json` — real `test` script.

**Delete (retired canvas approach):**
- `public/js/classes/Deck.js`, `public/js/classes/Player.js` — replaced by server authority + DOM render.

---

## Task 0: Test tooling

**Files:**
- Modify: `package.json:6-8`

- [ ] **Step 1: Set the test script**

In `package.json`, replace the `scripts` block:

```json
  "scripts": {
    "test": "node --test",
    "start": "node backend.js",
    "dev": "nodemon backend.js"
  },
```

- [ ] **Step 2: Verify the runner works (no tests yet)**

Run: `npm test`
Expected: exits 0 with "tests 0" (no test files found yet is fine).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add node:test runner and start/dev scripts"
```

---

## Task 1: Cards module

**Files:**
- Create: `game/cards.js`
- Test: `test/cards.test.js`

Card shape is a plain object `{ rank, suit }` (serializes cleanly over Socket.io). `rank` is 2–14 (11=J,12=Q,13=K,14=A); `suit` is one of `Hearts Diamonds Clubs Spades`.

- [ ] **Step 1: Write the failing tests**

Create `test/cards.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { makeDeck, Deck } = require('../game/cards')

test('makeDeck builds 52 unique cards', () => {
  const deck = makeDeck()
  assert.strictEqual(deck.length, 52)
  const keys = new Set(deck.map(c => `${c.rank}-${c.suit}`))
  assert.strictEqual(keys.size, 52)
})

test('Deck.draw removes and returns cards from the top', () => {
  const deck = new Deck()
  const drawn = deck.draw(2)
  assert.strictEqual(drawn.length, 2)
  assert.strictEqual(deck.cards.length, 50)
})

test('shuffle with a fixed rng is deterministic and preserves the multiset', () => {
  const seqRng = (() => { let i = 0; const xs = [0.1, 0.9, 0.3, 0.7, 0.5]
    return () => xs[(i++) % xs.length] })()
  const a = new Deck().shuffle(seqRng)
  const sig = a.cards.map(c => `${c.rank}-${c.suit}`).sort().join(',')
  const full = makeDeck().map(c => `${c.rank}-${c.suit}`).sort().join(',')
  assert.strictEqual(sig, full) // same 52 cards, just reordered
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../game/cards'`.

- [ ] **Step 3: Implement the module**

Create `game/cards.js`:

```js
const SUITS = ['Hearts', 'Diamonds', 'Clubs', 'Spades']
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

function makeDeck() {
  const cards = []
  for (const suit of SUITS) {
    for (const rank of RANKS) cards.push({ rank, suit })
  }
  return cards
}

// Fisher–Yates. rng() must return [0,1); injectable for deterministic tests.
function shuffle(cards, rng = Math.random) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}

class Deck {
  constructor(cards = makeDeck()) {
    this.cards = cards
  }
  shuffle(rng) {
    shuffle(this.cards, rng)
    return this
  }
  // Removes n cards from the top and returns them.
  draw(n = 1) {
    return this.cards.splice(0, n)
  }
}

module.exports = { SUITS, RANKS, makeDeck, shuffle, Deck }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add game/cards.js test/cards.test.js
git commit -m "feat: cards module with deck and injectable shuffle"
```

---

## Task 2: Hand evaluator — score a 5-card hand

**Files:**
- Create: `game/handEvaluator.js`
- Test: `test/handEvaluator.test.js`

`score5(cards)` returns `{ category, tiebreakers }` where `category` is 0 (high card) … 8 (straight flush) and `tiebreakers` is an array of ranks in descending priority for breaking ties within a category.

Helper used in tests: cards are `{rank, suit}`. Define a tiny builder so tests read cleanly.

- [ ] **Step 1: Write the failing tests**

Create `test/handEvaluator.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { score5 } = require('../game/handEvaluator')

const H = r => ({ rank: r, suit: 'Hearts' })
const S = r => ({ rank: r, suit: 'Spades' })
const D = r => ({ rank: r, suit: 'Diamonds' })
const C = r => ({ rank: r, suit: 'Clubs' })

test('straight flush', () => {
  const s = score5([H(9), H(8), H(7), H(6), H(5)])
  assert.deepStrictEqual(s, { category: 8, tiebreakers: [9] })
})

test('wheel straight flush (A-2-3-4-5) ranks as 5-high', () => {
  const s = score5([H(14), H(2), H(3), H(4), H(5)])
  assert.deepStrictEqual(s, { category: 8, tiebreakers: [5] })
})

test('four of a kind: quad rank then kicker', () => {
  const s = score5([H(7), S(7), D(7), C(7), H(10)])
  assert.deepStrictEqual(s, { category: 7, tiebreakers: [7, 10] })
})

test('full house: trip rank then pair rank', () => {
  const s = score5([H(4), S(4), D(4), C(9), H(9)])
  assert.deepStrictEqual(s, { category: 6, tiebreakers: [4, 9] })
})

test('flush: all five ranks high-to-low', () => {
  const s = score5([H(14), H(10), H(7), H(4), H(2)])
  assert.deepStrictEqual(s, { category: 5, tiebreakers: [14, 10, 7, 4, 2] })
})

test('straight (mixed suits): high card', () => {
  const s = score5([H(10), S(9), D(8), C(7), H(6)])
  assert.deepStrictEqual(s, { category: 4, tiebreakers: [10] })
})

test('three of a kind: trip then two kickers', () => {
  const s = score5([H(5), S(5), D(5), C(13), H(2)])
  assert.deepStrictEqual(s, { category: 3, tiebreakers: [5, 13, 2] })
})

test('two pair: high pair, low pair, kicker', () => {
  const s = score5([H(9), S(9), D(4), C(4), H(13)])
  assert.deepStrictEqual(s, { category: 2, tiebreakers: [9, 4, 13] })
})

test('one pair: pair then three kickers', () => {
  const s = score5([H(8), S(8), D(14), C(6), H(3)])
  assert.deepStrictEqual(s, { category: 1, tiebreakers: [8, 14, 6, 3] })
})

test('high card: five ranks high-to-low', () => {
  const s = score5([H(14), S(11), D(9), C(6), H(3)])
  assert.deepStrictEqual(s, { category: 0, tiebreakers: [14, 11, 9, 6, 3] })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../game/handEvaluator'`.

- [ ] **Step 3: Implement `score5`**

Create `game/handEvaluator.js`:

```js
const CATEGORY = {
  HIGH_CARD: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
}
const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
]

// Scores exactly 5 cards. Returns { category, tiebreakers }.
function score5(cards) {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a)
  const suits = cards.map(c => c.suit)
  const isFlush = suits.every(s => s === suits[0])

  const counts = new Map()
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1)
  // groups: [rank, count] sorted by count desc, then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])

  // straight detection over the distinct ranks
  const uniq = [...new Set(ranks)].sort((a, b) => b - a)
  let straightHigh = null
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0]
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5 // wheel
  }

  if (isFlush && straightHigh) return { category: CATEGORY.STRAIGHT_FLUSH, tiebreakers: [straightHigh] }
  if (groups[0][1] === 4) return { category: CATEGORY.QUADS, tiebreakers: [groups[0][0], groups[1][0]] }
  if (groups[0][1] === 3 && groups[1][1] >= 2) return { category: CATEGORY.FULL_HOUSE, tiebreakers: [groups[0][0], groups[1][0]] }
  if (isFlush) return { category: CATEGORY.FLUSH, tiebreakers: ranks }
  if (straightHigh) return { category: CATEGORY.STRAIGHT, tiebreakers: [straightHigh] }
  if (groups[0][1] === 3) return { category: CATEGORY.TRIPS, tiebreakers: groups.map(g => g[0]) }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return { category: CATEGORY.TWO_PAIR, tiebreakers: [groups[0][0], groups[1][0], groups[2][0]] }
  }
  if (groups[0][1] === 2) return { category: CATEGORY.PAIR, tiebreakers: groups.map(g => g[0]) }
  return { category: CATEGORY.HIGH_CARD, tiebreakers: ranks }
}

module.exports = { CATEGORY, CATEGORY_NAMES, score5 }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all `score5` tests).

- [ ] **Step 5: Commit**

```bash
git add game/handEvaluator.js test/handEvaluator.test.js
git commit -m "feat: score5 ranks any 5-card poker hand"
```

---

## Task 3: Hand evaluator — compare & best-of-seven

**Files:**
- Modify: `game/handEvaluator.js`
- Test: `test/handEvaluator.test.js`

- [ ] **Step 1: Add failing tests**

Append to `test/handEvaluator.test.js`:

```js
const { compareScores, evaluateBest } = require('../game/handEvaluator')

test('compareScores: higher category wins', () => {
  const flush = score5([H(14), H(10), H(7), H(4), H(2)])
  const straight = score5([H(10), S(9), D(8), C(7), H(6)])
  assert.ok(compareScores(flush, straight) > 0)
})

test('compareScores: same category breaks by tiebreakers', () => {
  const aceHigh = score5([H(14), S(11), D(9), C(6), H(3)])
  const kingHigh = score5([S(13), D(11), C(9), H(6), S(3)])
  assert.ok(compareScores(aceHigh, kingHigh) > 0)
})

test('compareScores: identical hands tie (0)', () => {
  const a = score5([H(9), S(9), D(4), C(4), H(13)])
  const b = score5([C(9), D(9), H(4), S(4), C(13)])
  assert.strictEqual(compareScores(a, b), 0)
})

test('evaluateBest picks the best 5 of 7 and names it', () => {
  // 2 hole + 5 board -> a flush in hearts is available
  const seven = [H(14), H(2), H(7), H(9), H(11), S(3), C(4)]
  const best = evaluateBest(seven)
  assert.strictEqual(best.category, 5) // flush
  assert.strictEqual(best.name, 'Flush')
  assert.deepStrictEqual(best.tiebreakers, [14, 11, 9, 7, 2])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `compareScores`/`evaluateBest` are not exported.

- [ ] **Step 3: Implement compare + evaluateBest**

In `game/handEvaluator.js`, add before `module.exports`:

```js
// Returns >0 if a beats b, <0 if b beats a, 0 if tied.
function compareScores(a, b) {
  if (a.category !== b.category) return a.category - b.category
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length)
  for (let i = 0; i < len; i++) {
    const diff = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function* combinations(arr, k) {
  const n = arr.length
  const idx = Array.from({ length: k }, (_, i) => i)
  while (true) {
    yield idx.map(i => arr[i])
    let i = k - 1
    while (i >= 0 && idx[i] === i + n - k) i--
    if (i < 0) return
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

// Best 5-card hand from 5,6, or 7 cards. Returns { category, tiebreakers, name }.
function evaluateBest(cards) {
  let best = null
  for (const combo of combinations(cards, 5)) {
    const s = score5(combo)
    if (!best || compareScores(s, best) > 0) best = s
  }
  return { ...best, name: CATEGORY_NAMES[best.category] }
}
```

Update the exports line:

```js
module.exports = { CATEGORY, CATEGORY_NAMES, score5, compareScores, evaluateBest }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS (all evaluator tests).

- [ ] **Step 5: Commit**

```bash
git add game/handEvaluator.js test/handEvaluator.test.js
git commit -m "feat: compareScores and evaluateBest (best 5 of 7)"
```

---

## Task 4: PokerTable — seating, startHand, blinds, deal

**Files:**
- Create: `game/PokerTable.js`
- Test: `test/pokerTable.test.js`

The engine is server-authoritative. Stacks reset to `startingStack` each hand (spec: makes side pots impossible). Tests inject a fixed `Deck` for determinism.

Per-player state: `{ id, username, stack, holeCards, bet, committed, folded, allIn, hasActed }`.
- `bet` = chips committed on the current street; `committed` = chips committed this whole hand.

- [ ] **Step 1: Write failing tests**

Create `test/pokerTable.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { PokerTable } = require('../game/PokerTable')
const { Deck } = require('../game/cards')

// Build a deck whose top cards are dealt in known order.
// Deal order for 3 players: seat-left-of-button gets cards 0 and 3, etc.
function fixedDeck(topCards) {
  const rest = new Deck().cards.filter(
    c => !topCards.some(t => t.rank === c.rank && t.suit === c.suit))
  return new Deck([...topCards, ...rest])
}

test('sit assigns the first empty seat; full table returns -1', () => {
  const t = new PokerTable()
  assert.strictEqual(t.sit('a', 'Alice'), 0)
  assert.strictEqual(t.sit('b', 'Bob'), 1)
})

test('startHand needs at least 2 players', () => {
  const t = new PokerTable()
  t.sit('a', 'Alice')
  assert.throws(() => t.startHand(), /at least 2/)
})

test('startHand posts blinds, deals 2 hole cards, sets preflop', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20, startingStack: 1500 })
  t.sit('a', 'Alice') // seat 0
  t.sit('b', 'Bob')   // seat 1
  t.sit('c', 'Carol') // seat 2
  t.startHand(new Deck().shuffle(() => 0)) // deterministic shuffle

  assert.strictEqual(t.phase, 'preflop')
  // 3-handed: button=seat0, SB=seat1, BB=seat2
  assert.strictEqual(t.buttonSeat, 0)
  assert.strictEqual(t.seats[1].bet, 10) // small blind
  assert.strictEqual(t.seats[2].bet, 20) // big blind
  assert.strictEqual(t.seats[1].stack, 1490)
  assert.strictEqual(t.seats[2].stack, 1480)
  assert.strictEqual(t.currentBet, 20)
  for (const s of t.seats.filter(Boolean)) assert.strictEqual(s.holeCards.length, 2)
  // first to act preflop is UTG = seat left of BB = seat 0
  assert.strictEqual(t.toActSeat, 0)
})

test('heads-up: button posts small blind and acts first preflop', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice') // seat 0
  t.sit('b', 'Bob')   // seat 1
  t.startHand(new Deck().shuffle(() => 0))
  assert.strictEqual(t.buttonSeat, 0)
  assert.strictEqual(t.seats[0].bet, 10) // button = SB heads-up
  assert.strictEqual(t.seats[1].bet, 20) // BB
  assert.strictEqual(t.toActSeat, 0)     // button acts first preflop heads-up
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `Cannot find module '../game/PokerTable'`.

- [ ] **Step 3: Implement seating + startHand**

Create `game/PokerTable.js`:

```js
const { Deck } = require('./cards')
const { evaluateBest, compareScores } = require('./handEvaluator')

const NUM_SEATS = 7

function newPlayer(id, username, stack) {
  return {
    id, username, stack,
    holeCards: [], bet: 0, committed: 0,
    folded: false, allIn: false, hasActed: false,
  }
}

class PokerTable {
  constructor({ smallBlind = 10, bigBlind = 20, startingStack = 1500 } = {}) {
    this.seats = Array(NUM_SEATS).fill(null)
    this.smallBlind = smallBlind
    this.bigBlind = bigBlind
    this.startingStack = startingStack
    this.phase = 'waiting'          // waiting|preflop|flop|turn|river|payout
    this.board = []
    this.pot = 0
    this.currentBet = 0
    this.minRaise = bigBlind
    this.buttonSeat = -1
    this.toActSeat = -1
    this.deck = null
    this.reveal = false             // true when the hand ended at showdown
    this.winners = []               // [{ id, username }]
  }

  // ---- seating ----
  sit(id, username) {
    const existing = this.findSeatById(id)
    if (existing !== -1) return existing
    const seat = this.seats.findIndex(s => s === null)
    if (seat === -1) return -1
    this.seats[seat] = newPlayer(id, username, this.startingStack)
    return seat
  }

  leave(id) {
    const seat = this.findSeatById(id)
    if (seat !== -1) this.seats[seat] = null
  }

  findSeatById(id) { return this.seats.findIndex(s => s && s.id === id) }
  occupiedSeats() { return this.seats.map((s, i) => (s ? i : -1)).filter(i => i >= 0) }

  // Occupied seats clockwise, starting just AFTER `seat` (exclusive).
  seatsClockwiseFrom(seat) {
    const out = []
    for (let k = 1; k <= NUM_SEATS; k++) {
      const i = (seat + k) % NUM_SEATS
      if (this.seats[i]) out.push(i)
    }
    return out
  }

  // ---- start a hand ----
  startHand(deck) {
    const occ = this.occupiedSeats()
    if (occ.length < 2) throw new Error('Need at least 2 players')

    for (const i of occ) {
      Object.assign(this.seats[i], {
        stack: this.startingStack, holeCards: [], bet: 0, committed: 0,
        folded: false, allIn: false, hasActed: false,
      })
    }
    this.board = []
    this.pot = 0
    this.winners = []
    this.reveal = false
    this.deck = deck || new Deck().shuffle()

    // advance / set the button
    this.buttonSeat = this.buttonSeat === -1
      ? occ[0]
      : this.seatsClockwiseFrom(this.buttonSeat)[0]

    const after = this.seatsClockwiseFrom(this.buttonSeat)
    let sbSeat, bbSeat, firstToAct
    if (occ.length === 2) {
      sbSeat = this.buttonSeat
      bbSeat = after[0]
      firstToAct = this.buttonSeat                    // button acts first preflop
    } else {
      sbSeat = after[0]
      bbSeat = after[1]
      firstToAct = this.seatsClockwiseFrom(bbSeat)[0] // UTG
    }

    this.postBlind(sbSeat, this.smallBlind)
    this.postBlind(bbSeat, this.bigBlind)
    this.currentBet = this.bigBlind
    this.minRaise = this.bigBlind

    // deal two rounds, starting left of the button
    for (let round = 0; round < 2; round++) {
      for (const i of this.seatsClockwiseFrom(this.buttonSeat)) {
        this.seats[i].holeCards.push(this.deck.draw(1)[0])
      }
    }

    this.phase = 'preflop'
    this.toActSeat = firstToAct
  }

  postBlind(seat, amount) {
    const p = this.seats[seat]
    const post = Math.min(amount, p.stack)
    p.stack -= post
    p.bet += post
    p.committed += post
    if (p.stack === 0) p.allIn = true
  }
}

module.exports = { PokerTable, NUM_SEATS }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS (seating + startHand tests).

- [ ] **Step 5: Commit**

```bash
git add game/PokerTable.js test/pokerTable.test.js
git commit -m "feat: PokerTable seating, blinds, and deal"
```

---

## Task 5: PokerTable — legal actions

**Files:**
- Modify: `game/PokerTable.js`
- Test: `test/pokerTable.test.js`

`legalActions(id)` returns `null` if it isn't that player's turn, else the menu the client renders. Raise amounts are expressed as "raise TO" totals (the player's new street bet).

- [ ] **Step 1: Add failing tests**

Append to `test/pokerTable.test.js`:

```js
test('legalActions for UTG facing the big blind', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startHand(new Deck().shuffle(() => 0))
  const la = t.legalActions('a') // seat 0, UTG, has bet 0, faces 20
  assert.strictEqual(la.canFold, true)
  assert.strictEqual(la.canCheck, false)   // facing a bet
  assert.strictEqual(la.canCall, true)
  assert.strictEqual(la.callAmount, 20)
  assert.strictEqual(la.canRaise, true)
  assert.strictEqual(la.minRaiseTo, 40)    // current 20 + minRaise 20
  assert.strictEqual(la.maxRaiseTo, 1500)  // whole stack all-in
})

test('legalActions returns null when it is not your turn', () => {
  const t = new PokerTable()
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startHand(new Deck().shuffle(() => 0))
  assert.strictEqual(t.legalActions('b'), null) // seat 1 is not to act
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `t.legalActions is not a function`.

- [ ] **Step 3: Implement legalActions**

In `game/PokerTable.js`, add inside the class (before the closing brace):

```js
  legalActions(id) {
    const seat = this.findSeatById(id)
    if (seat === -1 || seat !== this.toActSeat || this.phase === 'waiting' || this.phase === 'payout') {
      return null
    }
    const p = this.seats[seat]
    const toCall = this.currentBet - p.bet
    const maxRaiseTo = p.bet + p.stack            // total if all-in
    const minRaiseTo = Math.min(this.currentBet + this.minRaise, maxRaiseTo)
    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0 && p.stack > 0,
      callAmount: Math.min(toCall, p.stack),
      canRaise: p.stack > toCall,                 // must have more than a call
      minRaiseTo,
      maxRaiseTo,
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game/PokerTable.js test/pokerTable.test.js
git commit -m "feat: PokerTable.legalActions menu"
```

---

## Task 6: PokerTable — apply actions & advance the betting round

**Files:**
- Modify: `game/PokerTable.js`
- Test: `test/pokerTable.test.js`

`applyAction(id, action)` validates and applies an action, then advances: to the next actor, to the next street, or to an immediate win if everyone else folded. `action` is `{ type, amount? }` with `type` ∈ `fold|check|call|bet|raise`. For `bet`/`raise`, `amount` is the "raise TO" total.

- [ ] **Step 1: Add failing tests**

Append to `test/pokerTable.test.js`:

```js
test('everyone folds to one player -> immediate win, pot awarded', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startHand(new Deck().shuffle(() => 0))
  // seat0 UTG folds, seat1 (SB) folds -> seat2 (BB) wins
  t.applyAction('a', { type: 'fold' })
  t.applyAction('b', { type: 'fold' })
  assert.strictEqual(t.phase, 'payout')
  assert.deepStrictEqual(t.winners.map(w => w.id), ['c'])
  // BB posted 20 (stack 1480), wins the 10+20 pot -> 1510
  assert.strictEqual(t.seats[2].stack, 1480 + 30)
})

test('rejects a check when facing a bet, and a raise below the minimum', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startHand(new Deck().shuffle(() => 0))
  assert.throws(() => t.applyAction('a', { type: 'check' }), /check/i)
  assert.throws(() => t.applyAction('a', { type: 'raise', amount: 30 }), /minimum/i)
})

test('calling around preflop closes the round and deals the flop', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startHand(new Deck().shuffle(() => 0))
  t.applyAction('a', { type: 'call' })  // UTG calls 20
  t.applyAction('b', { type: 'call' })  // SB completes to 20
  t.applyAction('c', { type: 'check' }) // BB checks option
  assert.strictEqual(t.phase, 'flop')
  assert.strictEqual(t.board.length, 3)
  assert.strictEqual(t.pot, 60)
  assert.strictEqual(t.currentBet, 0)
  // postflop first to act is first seat left of button = SB seat 1
  assert.strictEqual(t.toActSeat, 1)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `t.applyAction is not a function`.

- [ ] **Step 3: Implement applyAction + advance + commit helper**

In `game/PokerTable.js`, add inside the class:

```js
  commit(p, amount) {
    const amt = Math.min(amount, p.stack)
    p.stack -= amt
    p.bet += amt
    p.committed += amt
    if (p.stack === 0) p.allIn = true
  }

  applyAction(id, action) {
    const seat = this.findSeatById(id)
    if (seat !== this.toActSeat) throw new Error('Not your turn')
    const p = this.seats[seat]
    const toCall = this.currentBet - p.bet

    switch (action.type) {
      case 'fold':
        p.folded = true
        break
      case 'check':
        if (toCall !== 0) throw new Error('Cannot check facing a bet')
        break
      case 'call':
        this.commit(p, Math.min(toCall, p.stack))
        break
      case 'bet':
      case 'raise': {
        const target = action.amount
        const maxTo = p.bet + p.stack
        if (typeof target !== 'number') throw new Error('Raise needs an amount')
        if (target > maxTo) throw new Error('Raise exceeds stack')
        if (target <= this.currentBet) throw new Error('Raise must exceed the current bet')
        const isAllIn = target === maxTo
        const minTo = this.currentBet + this.minRaise
        if (!isAllIn && target < minTo) throw new Error('Raise below the minimum')
        const raiseSize = target - this.currentBet
        this.commit(p, target - p.bet)
        this.minRaise = Math.max(this.minRaise, raiseSize)
        this.currentBet = target
        // a raise reopens action for everyone still live
        for (const i of this.occupiedSeats()) {
          const q = this.seats[i]
          if (i !== seat && !q.folded && !q.allIn) q.hasActed = false
        }
        break
      }
      default:
        throw new Error('Unknown action: ' + action.type)
    }

    p.hasActed = true
    this.advance()
  }

  advance() {
    const live = this.occupiedSeats().filter(i => !this.seats[i].folded)
    if (live.length === 1) {
      this.awardToLastPlayer(live[0])
      return
    }
    if (this.bettingRoundComplete()) {
      this.nextStreet()
      return
    }
    this.toActSeat = this.nextToAct(this.toActSeat)
  }

  bettingRoundComplete() {
    const live = this.occupiedSeats().map(i => this.seats[i]).filter(p => !p.folded)
    const actionable = live.filter(p => !p.allIn)
    return actionable.every(p => p.hasActed && p.bet === this.currentBet)
  }

  nextToAct(fromSeat) {
    for (const i of this.seatsClockwiseFrom(fromSeat)) {
      const p = this.seats[i]
      if (!p.folded && !p.allIn) return i
    }
    return -1
  }
```

`nextStreet`, `awardToLastPlayer`, `showdown`, and `payout` are implemented in Task 7. To make this task's tests pass, add **temporary** minimal versions now (they are replaced in Task 7):

```js
  // --- replaced in Task 7 ---
  nextStreet() {
    for (const i of this.occupiedSeats()) {
      this.pot += this.seats[i].bet
      this.seats[i].bet = 0
      this.seats[i].hasActed = false
    }
    this.currentBet = 0
    this.minRaise = this.bigBlind
    const order = ['preflop', 'flop', 'turn', 'river', 'showdown']
    const next = order[order.indexOf(this.phase) + 1]
    this.phase = next
    if (next === 'flop') this.board.push(...this.deck.draw(3))
    else if (next === 'turn' || next === 'river') this.board.push(...this.deck.draw(1))
    if (next !== 'showdown') this.toActSeat = this.nextToAct(this.buttonSeat)
  }

  awardToLastPlayer(seat) {
    for (const i of this.occupiedSeats()) { this.pot += this.seats[i].bet; this.seats[i].bet = 0 }
    const w = this.seats[seat]
    w.stack += this.pot
    this.winners = [{ id: w.id, username: w.username }]
    this.pot = 0
    this.phase = 'payout'
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS (fold-to-win, validation, call-around-to-flop).

- [ ] **Step 5: Commit**

```bash
git add game/PokerTable.js test/pokerTable.test.js
git commit -m "feat: PokerTable applyAction and betting-round advance"
```

---

## Task 7: PokerTable — street progression, showdown, payout & chop

**Files:**
- Modify: `game/PokerTable.js`
- Test: `test/pokerTable.test.js`

Replace the temporary `nextStreet`/`awardToLastPlayer` with full versions that reach showdown, evaluate hands, handle all-in run-outs (no more betting → deal remaining streets), and chop ties.

- [ ] **Step 1: Add failing tests**

Append to `test/pokerTable.test.js`:

```js
// Helper: deal specific hole cards + board by stacking the deck.
// Dealing starts LEFT of the button, no burn cards. Heads-up (seats 0=button/SB,
// 1=BB), seatsClockwiseFrom(button) = [seat1, seat0], so:
//   round 1: seat1 <- top[0], seat0 <- top[1]
//   round 2: seat1 <- top[2], seat0 <- top[3]
//   flop = top[4..6], turn = top[7], river = top[8]
test('showdown awards the pot to the best hand', () => {
  const c = (rank, suit) => ({ rank, suit })
  // seat0 (Alice) = A♠ A♥ ; seat1 (Bob) = K♦ K♣
  // board A♦ 7♣ 2♠ 9♥ 3♦ -> Alice trip aces beats Bob's pair of kings
  const top = [
    c(13, 'Diamonds'), c(14, 'Spades'),   // round 1: seat1=K♦, seat0=A♠
    c(13, 'Clubs'),    c(14, 'Hearts'),   // round 2: seat1=K♣, seat0=A♥
    c(14, 'Diamonds'), c(7, 'Clubs'), c(2, 'Spades'), // flop
    c(9, 'Hearts'),                        // turn
    c(3, 'Diamonds'),                      // river
  ]
  const { Deck } = require('../game/cards')
  const rest = new Deck().cards.filter(x => !top.some(tt => tt.rank === x.rank && tt.suit === x.suit))
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob')
  t.startHand(new Deck([...top, ...rest]))
  // play check/call to showdown: preflop button calls, BB checks
  t.applyAction('a', { type: 'call' })   // button completes to 20
  t.applyAction('b', { type: 'check' })  // -> flop, seat1 first to act postflop
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' }) // -> turn
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' }) // -> river
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' }) // -> showdown
  assert.strictEqual(t.phase, 'payout')
  assert.deepStrictEqual(t.winners.map(w => w.id), ['a'])
  assert.strictEqual(t.reveal, true)
})

test('a tie chops the pot evenly', () => {
  const c = (rank, suit) => ({ rank, suit })
  // both players hold irrelevant low cards and play the board's broadway straight
  // (seat1 <- top[0],[2]; seat0 <- top[1],[3]) -> both make the same A-high straight
  // board: T♠ J♥ Q♦ K♣ A♠
  const top = [
    c(2, 'Spades'), c(2, 'Diamonds'),
    c(3, 'Hearts'), c(3, 'Clubs'),
    c(10, 'Spades'), c(11, 'Hearts'), c(12, 'Diamonds'),
    c(13, 'Clubs'),
    c(14, 'Spades'),
  ]
  const { Deck } = require('../game/cards')
  const rest = new Deck().cards.filter(x => !top.some(tt => tt.rank === x.rank && tt.suit === x.suit))
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob')
  t.startHand(new Deck([...top, ...rest]))
  t.applyAction('a', { type: 'call' }); t.applyAction('b', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  assert.strictEqual(t.winners.length, 2)
  assert.strictEqual(t.seats[0].stack, 1500) // each got their 20 back
  assert.strictEqual(t.seats[1].stack, 1500)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — current `nextStreet` does not run to showdown/payout (phase never becomes `payout`, `reveal` stays false).

- [ ] **Step 3: Replace street/showdown/payout logic**

In `game/PokerTable.js`, replace the temporary `nextStreet` and `awardToLastPlayer` (from Task 6) with:

```js
  nextStreet() {
    // sweep street bets into the pot
    for (const i of this.occupiedSeats()) {
      this.pot += this.seats[i].bet
      this.seats[i].bet = 0
      this.seats[i].hasActed = false
    }
    this.currentBet = 0
    this.minRaise = this.bigBlind

    const order = ['preflop', 'flop', 'turn', 'river', 'showdown']
    const next = order[order.indexOf(this.phase) + 1]
    this.phase = next

    if (next === 'flop') this.board.push(...this.deck.draw(3))
    else if (next === 'turn' || next === 'river') this.board.push(...this.deck.draw(1))

    if (next === 'showdown') { this.showdown(); return }

    // if at most one player can still act (rest all-in), deal out the rest
    const actionable = this.occupiedSeats()
      .map(i => this.seats[i])
      .filter(p => !p.folded && !p.allIn)
    if (actionable.length <= 1) { this.nextStreet(); return }

    this.toActSeat = this.nextToAct(this.buttonSeat)
  }

  showdown() {
    this.phase = 'showdown'
    this.reveal = true
    const live = this.occupiedSeats()
      .map(i => this.seats[i])
      .filter(p => !p.folded)
    const scored = live.map(p => ({ p, score: evaluateBest([...p.holeCards, ...this.board]) }))
    let best = scored[0].score
    for (const s of scored) if (compareScores(s.score, best) > 0) best = s.score
    const winners = scored.filter(s => compareScores(s.score, best) === 0).map(s => s.p)
    this.payout(winners)
  }

  awardToLastPlayer(seat) {
    for (const i of this.occupiedSeats()) { this.pot += this.seats[i].bet; this.seats[i].bet = 0 }
    this.reveal = false
    this.payout([this.seats[seat]])
  }

  payout(winners) {
    const share = Math.floor(this.pot / winners.length)
    let remainder = this.pot - share * winners.length
    // pay in seat order from left of button so the odd chip goes to the
    // first winner left of the button
    const ordered = this.seatsClockwiseFrom(this.buttonSeat)
      .map(i => this.seats[i])
      .filter(p => winners.includes(p))
    for (const w of ordered) {
      w.stack += share
      if (remainder > 0) { w.stack += 1; remainder-- }
    }
    this.winners = ordered.map(w => ({ id: w.id, username: w.username }))
    this.pot = 0
    this.phase = 'payout'
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS (showdown winner + chop), and all earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add game/PokerTable.js test/pokerTable.test.js
git commit -m "feat: PokerTable street run-out, showdown, payout, chop"
```

---

## Task 8: PokerTable — personalized state view

**Files:**
- Modify: `game/PokerTable.js`
- Test: `test/pokerTable.test.js`

`getStateFor(id)` returns the view a specific client may see: own hole cards always; opponents' hole cards only at showdown (and only if not folded); plus pot, board, whose turn, and that player's legal-action menu.

- [ ] **Step 1: Add failing tests**

Append to `test/pokerTable.test.js`:

```js
test('getStateFor hides opponent hole cards before showdown', () => {
  const t = new PokerTable()
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startHand(new Deck().shuffle(() => 0))
  const view = t.getStateFor('a')
  const self = view.seats.find(s => s && s.isSelf)
  const other = view.seats.find(s => s && !s.isSelf)
  assert.strictEqual(self.holeCards.length, 2)
  assert.ok(Array.isArray(self.holeCards) && typeof self.holeCards[0] === 'object')
  assert.strictEqual(other.holeCards, 'hidden')
  assert.ok(view.legalActions) // it's Alice's turn (UTG)
})

test('getStateFor reveals live opponents at showdown', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob')
  t.startHand(new Deck().shuffle(() => 0))
  t.applyAction('a', { type: 'call' }); t.applyAction('b', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  const view = t.getStateFor('a')
  const other = view.seats.find(s => s && !s.isSelf)
  assert.ok(Array.isArray(other.holeCards) && other.holeCards.length === 2)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `t.getStateFor is not a function`.

- [ ] **Step 3: Implement getStateFor**

In `game/PokerTable.js`, add inside the class:

```js
  getStateFor(id) {
    const liveBets = this.occupiedSeats().reduce((sum, i) => sum + this.seats[i].bet, 0)
    return {
      phase: this.phase,
      board: this.board,
      pot: this.pot + liveBets,
      currentBet: this.currentBet,
      buttonSeat: this.buttonSeat,
      toActSeat: this.toActSeat,
      winners: this.winners,
      numSeats: NUM_SEATS,
      seats: this.seats.map((p, idx) => {
        if (!p) return null
        const isSelf = p.id === id
        const revealOpponent = this.reveal && !p.folded
        let holeCards
        if (p.holeCards.length === 0) holeCards = []
        else if (isSelf || revealOpponent) holeCards = p.holeCards
        else holeCards = 'hidden'
        return {
          seat: idx,
          username: p.username,
          stack: p.stack,
          bet: p.bet,
          folded: p.folded,
          allIn: p.allIn,
          isSelf,
          holeCards,
        }
      }),
      legalActions: this.legalActions(id),
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game/PokerTable.js test/pokerTable.test.js
git commit -m "feat: PokerTable.getStateFor personalized view"
```

---

## Task 9: Backend wiring

**Files:**
- Modify: `backend.js` (full rewrite)

Replace the deck-broadcast skeleton with `PokerTable` + per-socket personalized state. Remove the 15ms ticker and the broken `./public/js/classes/Deck` require.

- [ ] **Step 1: Rewrite backend.js**

Replace the entire contents of `backend.js`:

```js
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const { PokerTable } = require('./game/PokerTable')

const app = express()
const server = http.createServer(app)
const io = new Server(server)
const PORT = process.env.PORT || 3000

app.use(express.static('public'))

const table = new PokerTable()

// Push each connected client its own personalized view.
function broadcast() {
  for (const [id, socket] of io.of('/').sockets) {
    socket.emit('gameState', table.getStateFor(id))
  }
}

io.on('connection', (socket) => {
  console.log(`connected: ${socket.id}`)

  socket.on('initGame', ({ username }) => {
    table.sit(socket.id, (username || 'Player').slice(0, 16))
    broadcast()
  })

  socket.on('startHand', () => {
    try {
      table.startHand()
      broadcast()
    } catch (err) {
      socket.emit('errorMsg', err.message)
    }
  })

  socket.on('action', (action) => {
    try {
      table.applyAction(socket.id, action)
      broadcast()
    } catch (err) {
      socket.emit('errorMsg', err.message)
    }
  })

  socket.on('disconnect', () => {
    table.leave(socket.id)
    broadcast()
  })
})

server.listen(PORT, () => console.log(`Poker app listening on port ${PORT}`))
```

- [ ] **Step 2: Smoke-test the server boots**

Run: `node -e "require('./backend.js')" & sleep 1 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ ; kill %1`
Expected: prints `200` (static index served). (If `index.html` not yet updated, still 200.)

- [ ] **Step 3: Commit**

```bash
git add backend.js
git commit -m "feat: wire backend to PokerTable with per-socket state"
```

---

## Task 10: Frontend — DOM skeleton & styling

**Files:**
- Modify: `public/index.html` (full rewrite)
- Create: `public/css/table.css`

The page has a username overlay (kept), a `#table` container the renderer fills, a `#community`/`#pot` center, and a `#controls` bar. No `<canvas>`.

- [ ] **Step 1: Rewrite index.html**

Replace the entire contents of `public/index.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Express Poker</title>
    <link rel="stylesheet" href="./css/table.css" />
  </head>
  <body>
    <div id="table">
      <div id="center">
        <div id="pot"></div>
        <div id="community"></div>
        <div id="result"></div>
      </div>
      <div id="seats"></div>
    </div>

    <div id="controls"></div>

    <!-- username overlay -->
    <div id="overlay">
      <form id="usernameForm">
        <input id="usernameInput" type="text" placeholder="Username" autocomplete="off" />
        <button type="submit">Sit Down</button>
      </form>
    </div>

    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    <script src="./js/render.js"></script>
    <script src="./js/frontend.js"></script>
    <script src="./js/eventListeners.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the stylesheet**

Create `public/css/table.css`:

```css
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #0b132b;
  color: #e7ecef;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}

#table {
  position: relative;
  width: 100vw;
  height: 100vh;
}

#center {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 46%; height: 44%;
  background: #157347;
  border: 12px solid #6b4423;
  border-radius: 50% / 50%;
  box-shadow: inset 0 0 80px rgba(0,0,0,.45);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 10px;
}
#pot { color: #ffd166; font-weight: 700; letter-spacing: .5px; }
#community { display: flex; gap: 6px; }
#result { color: #ffd166; font-weight: 700; min-height: 20px; text-align: center; }

/* seats are absolutely positioned by JS via --x/--y custom props */
.seat {
  position: absolute;
  left: var(--x); top: var(--y);
  transform: translate(-50%, -50%);
  text-align: center;
  width: 120px;
}
.seat.active .nameplate { box-shadow: 0 0 14px #ffd166; background: #ffd166; color: #111; }
.seat.folded { opacity: .4; }
.nameplate {
  background: #1c2541; padding: 4px 10px; border-radius: 12px;
  font-size: 12px; font-weight: 600;
}
.seat .hole { display: flex; gap: 3px; justify-content: center; margin-bottom: 4px; }
.seat .bet { color: #9bf6ff; font-size: 12px; min-height: 14px; }
.button-chip {
  display: inline-block; width: 16px; height: 16px; line-height: 16px;
  background: #fff; color: #111; border-radius: 50%; font-size: 10px; font-weight: 700;
}

.card {
  width: 34px; height: 48px; background: #fff; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font: 700 15px serif; color: #111;
}
.card.red { color: #c00; }
.card.back { background: #1d4ed8; border: 2px solid #fff; }
#community .card { width: 42px; height: 60px; font-size: 18px; }

#controls {
  position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 10px; align-items: center;
}
#controls button {
  padding: 10px 18px; border: none; border-radius: 100px;
  color: #fff; font-weight: 700; cursor: pointer;
}
.btn-fold { background: #dc3545; }
.btn-check, .btn-call { background: #6c757d; }
.btn-raise, .btn-start { background: #198754; }
#controls input[type=range] { width: 140px; }
#raiseAmount { min-width: 48px; text-align: center; font-weight: 700; }

#overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(11,19,43,.85);
}
#usernameForm { display: flex; flex-direction: column; gap: 10px; }
#usernameInput {
  padding: 12px; border-radius: 20px; border: none; background: #1c2541; color: #e7ecef;
}
#usernameForm button {
  padding: 10px 20px; border: none; border-radius: 100px; cursor: pointer;
  color: #fff; background-image: linear-gradient(to right, #06b6d4, #3b82f6);
}
.hidden { display: none !important; }
```

- [ ] **Step 3: Verify the page loads without console errors (manual)**

Run: `npm start` then open `http://localhost:3000`.
Expected: the username overlay shows on a dark background; no 404s for `table.css`. (`render.js`/`frontend.js` may be empty/missing — created next; remove this expectation once those tasks land.) Stop the server with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/css/table.css
git commit -m "feat: DOM table layout and styling"
```

---

## Task 11: Frontend — render from game state

**Files:**
- Create: `public/js/render.js`

Pure-ish DOM rendering: given a `state` object (the shape from `getStateFor`) and the `selfSeat`, paint seats, community cards, pot, and result. Seat positions are computed on an ellipse. No socket logic here.

- [ ] **Step 1: Create render.js**

Create `public/js/render.js`:

```js
const SUIT_SYMBOL = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }
const SUIT_RED = { Hearts: true, Diamonds: true, Clubs: false, Spades: false }
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

function rankLabel(r) { return RANK_LABEL[r] || String(r) }

function cardEl(card) {
  const el = document.createElement('div')
  if (card === 'back') { el.className = 'card back'; return el }
  el.className = 'card' + (SUIT_RED[card.suit] ? ' red' : '')
  el.textContent = rankLabel(card.rank) + SUIT_SYMBOL[card.suit]
  return el
}

// Position seat `idx` around the table, rotated so the viewer (selfSeat)
// sits at the bottom-center.
function seatPosition(idx, selfSeat, numSeats) {
  const rel = ((idx - selfSeat) % numSeats + numSeats) % numSeats
  const angle = Math.PI / 2 + (2 * Math.PI * rel) / numSeats // self at bottom
  const cx = 50, cy = 52, rx = 38, ry = 40 // percentages
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }
}

function renderTable(state) {
  const selfSeatObj = state.seats.find(s => s && s.isSelf)
  const selfSeat = selfSeatObj ? selfSeatObj.seat : 0

  // community
  const community = document.getElementById('community')
  community.replaceChildren(...state.board.map(c => cardEl(c)))

  // pot + result
  document.getElementById('pot').textContent = state.pot ? `POT $${state.pot}` : ''
  const result = document.getElementById('result')
  if (state.phase === 'payout' && state.winners.length) {
    const names = state.winners.map(w => w.username).join(' & ')
    result.textContent = `${names} win${state.winners.length > 1 ? '' : 's'} the pot`
  } else {
    result.textContent = ''
  }

  // seats
  const seatsRoot = document.getElementById('seats')
  seatsRoot.replaceChildren()
  for (const seat of state.seats) {
    if (!seat) continue
    const { x, y } = seatPosition(seat.seat, selfSeat, state.numSeats)
    const el = document.createElement('div')
    el.className = 'seat'
      + (seat.seat === state.toActSeat ? ' active' : '')
      + (seat.folded ? ' folded' : '')
    el.style.setProperty('--x', x + '%')
    el.style.setProperty('--y', y + '%')

    const hole = document.createElement('div')
    hole.className = 'hole'
    if (seat.holeCards === 'hidden') hole.append(cardEl('back'), cardEl('back'))
    else hole.append(...seat.holeCards.map(c => cardEl(c)))

    const nameplate = document.createElement('div')
    nameplate.className = 'nameplate'
    const dealer = seat.seat === state.buttonSeat ? ' <span class="button-chip">D</span>' : ''
    nameplate.innerHTML = `${seat.username} · $${seat.stack}${dealer}`

    const bet = document.createElement('div')
    bet.className = 'bet'
    bet.textContent = seat.bet ? `$${seat.bet}` : (seat.allIn ? 'ALL-IN' : '')

    el.append(hole, nameplate, bet)
    seatsRoot.append(el)
  }
}

window.renderTable = renderTable
```

- [ ] **Step 2: Verify it parses (manual, no test runner for DOM)**

Run: `node --check public/js/render.js`
Expected: no output, exit 0 (syntax valid).

- [ ] **Step 3: Commit**

```bash
git add public/js/render.js
git commit -m "feat: DOM renderer for table, seats, cards, pot"
```

---

## Task 12: Frontend — socket glue & controls

**Files:**
- Modify: `public/js/frontend.js` (full rewrite)
- Modify: `public/js/eventListeners.js` (full rewrite)

`frontend.js` owns the socket and the latest state and re-renders on update, including the controls bar. `eventListeners.js` wires the username form. (Action buttons are created dynamically in `frontend.js` because they depend on `legalActions`.)

- [ ] **Step 1: Rewrite frontend.js**

Replace the entire contents of `public/js/frontend.js`:

```js
const socket = io()
let latestState = null

socket.on('gameState', (state) => {
  latestState = state
  renderTable(state)
  renderControls(state)
})

socket.on('errorMsg', (msg) => {
  const result = document.getElementById('result')
  result.textContent = msg
})

function emitAction(action) { socket.emit('action', action) }

function renderControls(state) {
  const bar = document.getElementById('controls')
  bar.replaceChildren()

  const seated = state.seats.some(s => s && s.isSelf)
  const handLive = state.phase !== 'waiting' && state.phase !== 'payout'

  // Start Hand button: shown when seated and no hand in progress
  if (seated && !handLive) {
    const start = document.createElement('button')
    start.className = 'btn-start'
    start.textContent = 'Start Hand'
    start.onclick = () => socket.emit('startHand')
    bar.append(start)
  }

  const la = state.legalActions
  if (!la) return // not our turn (or not seated)

  const fold = document.createElement('button')
  fold.className = 'btn-fold'; fold.textContent = 'Fold'
  fold.onclick = () => emitAction({ type: 'fold' })
  bar.append(fold)

  if (la.canCheck) {
    const check = document.createElement('button')
    check.className = 'btn-check'; check.textContent = 'Check'
    check.onclick = () => emitAction({ type: 'check' })
    bar.append(check)
  }
  if (la.canCall) {
    const call = document.createElement('button')
    call.className = 'btn-call'; call.textContent = `Call $${la.callAmount}`
    call.onclick = () => emitAction({ type: 'call' })
    bar.append(call)
  }
  if (la.canRaise) {
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(la.minRaiseTo)
    slider.max = String(la.maxRaiseTo)
    slider.value = String(la.minRaiseTo)

    const amount = document.createElement('span')
    amount.id = 'raiseAmount'
    amount.textContent = `$${la.minRaiseTo}`
    slider.oninput = () => { amount.textContent = `$${slider.value}` }

    const raise = document.createElement('button')
    raise.className = 'btn-raise'
    raise.textContent = state.currentBet > 0 ? 'Raise' : 'Bet'
    raise.onclick = () => emitAction({
      type: state.currentBet > 0 ? 'raise' : 'bet',
      amount: Number(slider.value),
    })
    bar.append(slider, amount, raise)
  }
}

window.renderControls = renderControls
```

- [ ] **Step 2: Rewrite eventListeners.js**

Replace the entire contents of `public/js/eventListeners.js`:

```js
document.querySelector('#usernameForm').addEventListener('submit', (event) => {
  event.preventDefault()
  const username = document.querySelector('#usernameInput').value.trim() || 'Player'
  socket.emit('initGame', { username })
  document.querySelector('#overlay').classList.add('hidden')
})
```

- [ ] **Step 3: Verify both parse**

Run: `node --check public/js/frontend.js && node --check public/js/eventListeners.js`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add public/js/frontend.js public/js/eventListeners.js
git commit -m "feat: socket glue, betting controls, and seat-in flow"
```

---

## Task 13: Remove retired canvas files & final manual verification

**Files:**
- Delete: `public/js/classes/Deck.js`, `public/js/classes/Player.js`

- [ ] **Step 1: Delete the retired files**

```bash
git rm public/js/classes/Deck.js public/js/classes/Player.js
```

- [ ] **Step 2: Confirm nothing references them**

Run: `grep -rn "classes/Deck\|classes/Player\|new Player\|getContext" public backend.js`
Expected: no matches (the canvas/Player approach is fully gone).

- [ ] **Step 3: Full unit-test pass**

Run: `npm test`
Expected: PASS — all `cards`, `handEvaluator`, and `pokerTable` tests green.

- [ ] **Step 4: Manual two-player hand (the real verification)**

Run: `npm start`. Open `http://localhost:3000` in **two browser tabs** (or one normal + one private window).
- In each tab, enter a username and click **Sit Down**.
- In either tab, click **Start Hand**.
- Verify: each tab sees only its own hole cards (the other seat shows blue card backs); blinds posted; the dealer **D** chip shows; the active seat is highlighted.
- Play the hand: use Fold/Check/Call/Bet+slider/Raise. Verify the turn moves correctly, community cards appear on flop/turn/river, the pot grows, and at showdown the winner is announced and chips move.
- Click **Start Hand** again → a fresh hand deals (stacks reset to 1500).

Expected: a full No-Limit hand plays start to finish with correct private cards and a real winner.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove retired canvas Deck/Player files"
```

---

## Self-Review notes (coverage check)

- Manual start, 2–7 players → Task 4 (`startHand`, `sit`), Task 12 (Start Hand button).
- No-Limit betting incl. all-in → Tasks 5–7 (legal actions, raise validation, all-in run-out).
- Server-authoritative + private hole cards → Tasks 8–9 (`getStateFor`, per-socket broadcast).
- Hand evaluation + tie/chop → Tasks 2–3, 7.
- Full-DOM UI → Tasks 10–12; canvas removed in Task 13.
- Stacks reset each hand / side-pot-free → Task 4 `startHand` reset.
- Everyone-folds shortcut → Task 6 (`advance` → `awardToLastPlayer`).
- Commit-in-chunks → every task ends in a commit.
- `/init` (CLAUDE.md) → intentionally deferred per spec; not in this plan.

**Known follow-ups (out of scope, per spec):** action timers, bots, side pots, persistent stacks, dealer rotation across hands.
```
