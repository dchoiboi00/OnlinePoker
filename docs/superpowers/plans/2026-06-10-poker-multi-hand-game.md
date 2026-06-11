# Multi-Hand Tournament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single playable hand into a tournament — chips persist across hands, players bust out, and the game runs until one winner remains.

**Architecture:** A game-level state machine (`gamePhase: lobby → playing → over`) wraps the existing per-hand engine. `startHand` splits into `startGame` (assign stacks once) and `dealHand` (carry stacks over). Eliminated/waiting players are marked `folded` during a hand so all existing within-hand logic skips them unchanged; only button/blinds/dealing use an active-only seat iterator. The DOM gains per-pot display, "OUT" seats, and a game-over screen.

**Tech Stack:** Node 20, `node:test`, vanilla DOM, Playwright smoke harness.

**Spec:** `docs/superpowers/specs/2026-06-10-poker-multi-hand-game-design.md`

**Commit discipline:** one commit per task, exact messages given. **No Claude/AI attribution in commit messages.**

---

## Key design mechanic (read first)

Eliminated and waiting players keep their seat but are **inert**: at the start of every hand they're set `folded = true` with `committed = 0`, `bet = 0`. Because every within-hand method already filters `!folded` (`nextToAct`, `bettingRoundComplete`, `advance`, `settlePots`, `nextStreet`, `awardToLastPlayer`), they are skipped automatically — **no changes to those methods are needed.** Only the per-hand *setup* (button placement, blinds, dealing, first-to-act) must skip them, via a new `activeSeatsFrom` iterator.

`committed` equals a busted player's pre-hand stack exactly (to bust you go all-in and lose everything you put in), so it's used to order simultaneous busts by finishing place.

---

## File Structure

**Modify:**
- `game/PokerTable.js` — `gamePhase`; `startGame`/`dealHand`/`_setupHand`; `activeSeats`/`activeSeatsFrom`; elimination + `_finishHand`; `newGame`; `getStateFor` additions; new player fields.
- `test/pokerTable.test.js` — update existing `startHand` calls to `startGame`/`dealHand`; add tournament tests.
- `backend.js` — replace the `startHand` socket event with `startGame`/`dealHand`/`newGame`.
- `public/index.html` — add a `#gameover` overlay element.
- `public/css/table.css` — styles for per-pot chips, eliminated/waiting seats, game-over overlay.
- `public/js/render.js` — per-pot display, OUT/waiting seats, game-over overlay.
- `public/js/frontend.js` — context-aware button (Start Game / Deal Next Hand / New Game).
- `scripts/smoke.mjs` — extend to two hands.

---

## Task 1: Game lifecycle — `gamePhase`, `startGame`/`dealHand` split

**Files:**
- Modify: `game/PokerTable.js`
- Modify: `test/pokerTable.test.js`

Add the game-level state and split the hand-start into `startGame` (assign stacks) and `dealHand` (carry over), sharing a private `_setupHand`. Add active-only seat iteration. Existing behavior for a first hand is preserved, so existing tests pass after a mechanical rename.

- [ ] **Step 1: Add new player fields and `gamePhase`**

In `game/PokerTable.js`, update `newPlayer`:

```js
function newPlayer(id, username, stack) {
  return {
    id, username, stack,
    holeCards: [], bet: 0, committed: 0,
    folded: false, allIn: false, hasActed: false,
    eliminated: false, finishPlace: null, waiting: false,
  }
}
```

In the constructor, add `gamePhase` (after `this.phase = 'waiting'`):

```js
    this.gamePhase = 'lobby'         // lobby|playing|over
```

- [ ] **Step 2: Add active-seat iterators**

In `game/PokerTable.js`, add these methods right after `seatsClockwiseFrom`:

```js
  // Seated and able to play this game (not eliminated, not waiting to join).
  activeSeats() {
    return this.occupiedSeats().filter(i => {
      const p = this.seats[i]
      return !p.eliminated && !p.waiting
    })
  }

  // Active seats clockwise, starting just AFTER `seat` (exclusive).
  activeSeatsFrom(seat) {
    return this.seatsClockwiseFrom(seat).filter(i => {
      const p = this.seats[i]
      return !p.eliminated && !p.waiting
    })
  }
```

- [ ] **Step 3: Write the failing tests for `startGame`/`dealHand`**

Append to `test/pokerTable.test.js`:

```js
test('startGame assigns stacks, sets gamePhase playing, deals hand 1', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20, startingStack: 1500 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  assert.strictEqual(t.gamePhase, 'lobby')
  t.startGame(new Deck().shuffle(() => 0))
  assert.strictEqual(t.gamePhase, 'playing')
  assert.strictEqual(t.phase, 'preflop')
  assert.strictEqual(t.buttonSeat, 0)
  for (const s of t.seats.filter(Boolean)) assert.strictEqual(s.holeCards.length, 2)
})

test('startGame twice throws (game already in progress)', () => {
  const t = new PokerTable()
  t.sit('a', 'A'); t.sit('b', 'B')
  t.startGame(new Deck().shuffle(() => 0))
  assert.throws(() => t.startGame(), /already in progress/)
})

test('dealHand carries stacks over and moves the button', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startGame(new Deck().shuffle(() => 0))
  // hand 1, 3-handed (button seat0): UTG=seat0, SB=seat1(Bob), BB=seat2(Carol).
  // Alice (UTG) and Bob (SB) fold -> Carol (BB) wins. Bob posted SB 10 -> stack 1490.
  t.applyAction('a', { type: 'fold' })
  t.applyAction('b', { type: 'fold' })
  assert.strictEqual(t.phase, 'payout')
  const button1 = t.buttonSeat
  assert.strictEqual(t.seats[1].stack, 1490) // Bob lost his SB this hand

  t.dealHand(new Deck().shuffle(() => 0))
  assert.strictEqual(t.phase, 'preflop')
  assert.notStrictEqual(t.buttonSeat, button1)      // button advanced 0 -> 1
  // Bob is now the button (posts no blind), so his carried stack stays 1490.
  // If dealHand had wrongly reset stacks, he would be back at 1500.
  assert.strictEqual(t.buttonSeat, 1)
  assert.strictEqual(t.seats[1].stack, 1490)
})

test('dealHand before payout throws', () => {
  const t = new PokerTable()
  t.sit('a', 'A'); t.sit('b', 'B')
  t.startGame(new Deck().shuffle(() => 0))
  assert.throws(() => t.dealHand(), /in progress/)
})
```

- [ ] **Step 4: Run to verify failure**

Run: `npm test`
Expected: FAIL — `t.startGame is not a function`.

- [ ] **Step 5: Replace `startHand` with `startGame`, `dealHand`, and `_setupHand`**

In `game/PokerTable.js`, DELETE the entire existing `startHand(deck) { ... }` method and add these three methods in its place:

```js
  // ---- start a tournament (assign stacks once) ----
  startGame(deck) {
    if (this.gamePhase !== 'lobby') throw new Error('Game already in progress')
    const seated = this.occupiedSeats()
    if (seated.length < 2) throw new Error('Need at least 2 players')
    for (const i of seated) {
      Object.assign(this.seats[i], {
        stack: this.startingStack, eliminated: false, finishPlace: null, waiting: false,
      })
    }
    this.gamePhase = 'playing'
    this.buttonSeat = this.activeSeats()[0]
    this._setupHand(deck)
  }

  // ---- deal the next hand of an in-progress game (stacks carry over) ----
  dealHand(deck) {
    if (this.gamePhase !== 'playing') throw new Error('No game in progress')
    if (this.phase !== 'payout') throw new Error('Hand still in progress')
    if (this.activeSeats().length < 2) throw new Error('Need at least 2 players')
    this.buttonSeat = this.activeSeatsFrom(this.buttonSeat)[0]
    this._setupHand(deck)
  }

  // shared per-hand setup: reset per-hand state, post blinds, deal, set first to act
  _setupHand(deck) {
    for (const i of this.occupiedSeats()) {
      const p = this.seats[i]
      const inactive = p.eliminated || p.waiting
      Object.assign(p, {
        holeCards: [], bet: 0, committed: 0,
        folded: inactive, allIn: false, hasActed: false,
      })
    }
    this.board = []
    this.pot = 0
    this.winners = []
    this.reveal = false
    this.deck = deck || new Deck().shuffle()

    const active = this.activeSeats()
    const after = this.activeSeatsFrom(this.buttonSeat)
    let sbSeat, bbSeat, firstToAct
    if (active.length === 2) {
      sbSeat = this.buttonSeat
      bbSeat = after[0]
      firstToAct = this.buttonSeat
    } else {
      sbSeat = after[0]
      bbSeat = after[1]
      firstToAct = this.activeSeatsFrom(bbSeat)[0]
    }

    this.postBlind(sbSeat, this.smallBlind)
    this.postBlind(bbSeat, this.bigBlind)
    this.currentBet = this.bigBlind
    this.minRaise = this.bigBlind

    for (let round = 0; round < 2; round++) {
      for (const i of this.activeSeatsFrom(this.buttonSeat)) {
        this.seats[i].holeCards.push(this.deck.draw(1)[0])
      }
    }

    this.phase = 'preflop'
    this.toActSeat = firstToAct
  }
```

- [ ] **Step 6: Update existing tests to the new entry points**

In `test/pokerTable.test.js`, replace every existing call `t.startHand(` with `t.startGame(` — EXCEPT in the test named `removed player is not dealt into the next hand`, whose **second** deal (the one after the first hand finishes, currently `t.startHand(new Deck().shuffle(() => 0))` near the end) must become `t.dealHand(new Deck().shuffle(() => 0))`.

Quick way to find them: `grep -n "startHand" test/pokerTable.test.js`. After editing, there must be **zero** remaining `startHand` references in the test file.

- [ ] **Step 7: Run to verify pass**

Run: `npm test`
Expected: PASS — the 4 new lifecycle tests plus all prior tests (now using `startGame`/`dealHand`). 48+ total.

- [ ] **Step 8: Commit**

```bash
git add game/PokerTable.js test/pokerTable.test.js
git commit -m "feat: game lifecycle with startGame/dealHand split and active-seat iteration"
```

---

## Task 2: Elimination, finishing places, and game-over

**Files:**
- Modify: `game/PokerTable.js`
- Modify: `test/pokerTable.test.js`

After each hand settles, mark broke players eliminated (with finishing places) and end the game when one player remains. Add `newGame()`.

- [ ] **Step 1: Write the failing tests**

Append to `test/pokerTable.test.js`:

```js
// Deck helper: stack the top cards, fill the rest with the remaining 52-set.
function stacked(top) {
  const rest = new Deck().cards.filter(
    x => !top.some(c => c.rank === x.rank && c.suit === x.suit))
  return new Deck([...top, ...rest])
}

test('a busted player is eliminated with a finishing place and skipped next hand', () => {
  const c = (rank, suit) => ({ rank, suit })
  // Deal order (button=seat0): r1 seat1,seat2,seat0 ; r2 seat1,seat2,seat0.
  //   Carol(seat2) = 7♠ 8♠ ; Alice(seat0) = A♥ A♦ ; Bob(seat1) folds.
  //   board A♠ K♦ 9♣ 4♥ 2♦ -> Alice trip aces, Carol just ace-high. Carol busts.
  const top = [
    c(2, 'Clubs'), c(7, 'Spades'), c(14, 'Hearts'),
    c(3, 'Clubs'), c(8, 'Spades'), c(14, 'Diamonds'),
    c(14, 'Spades'), c(13, 'Diamonds'), c(9, 'Clubs'),
    c(4, 'Hearts'), c(2, 'Diamonds'),
  ]
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20, startingStack: 1500 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startGame(stacked(top))
  t.seats[2].stack = 80 // Carol short: already posted 20 BB -> 100 total
  t.applyAction('a', { type: 'raise', amount: 200 })
  t.applyAction('b', { type: 'fold' })
  t.applyAction('c', { type: 'call' }) // Carol all-in 100, loses to Alice
  assert.strictEqual(t.phase, 'payout')
  assert.strictEqual(t.seats[2].stack, 0)
  assert.strictEqual(t.seats[2].eliminated, true)
  assert.strictEqual(t.seats[2].finishPlace, 3) // 2 survivors + 1
  // next hand: Carol is inert (folded, no cards), Alice & Bob still active
  t.dealHand(new Deck().shuffle(() => 0))
  assert.strictEqual(t.seats[2].folded, true)
  assert.strictEqual(t.seats[2].holeCards.length, 0)
})

test('game ends when one active player remains', () => {
  const c = (rank, suit) => ({ rank, suit })
  // heads-up deal: seat1(Bob) <- 2♣,3♣ ; seat0(Alice) <- A♥,A♦.
  // board A♠ K♦ 9♣ 7♥ 2♦ -> Alice trip aces beats Bob's pair of twos.
  const top = [
    c(2, 'Clubs'), c(14, 'Hearts'),
    c(3, 'Clubs'), c(14, 'Diamonds'),
    c(14, 'Spades'), c(13, 'Diamonds'), c(9, 'Clubs'),
    c(7, 'Hearts'), c(2, 'Diamonds'),
  ]
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob')
  t.startGame(stacked(top))
  t.applyAction('a', { type: 'raise', amount: 1500 }) // Alice all-in
  t.applyAction('b', { type: 'call' })                // Bob all-in, loses
  assert.strictEqual(t.gamePhase, 'over')
  assert.strictEqual(t.seats[1].eliminated, true)
  assert.strictEqual(t.seats[1].finishPlace, 2)
  assert.strictEqual(t.seats[0].finishPlace, 1) // winner
})

test('newGame returns to lobby and re-includes players', () => {
  const c = (rank, suit) => ({ rank, suit })
  const top = [
    c(2, 'Clubs'), c(14, 'Hearts'),
    c(3, 'Clubs'), c(14, 'Diamonds'),
    c(14, 'Spades'), c(13, 'Diamonds'), c(9, 'Clubs'),
    c(7, 'Hearts'), c(2, 'Diamonds'),
  ]
  const t = new PokerTable()
  t.sit('a', 'A'); t.sit('b', 'B')
  t.startGame(stacked(top))
  t.applyAction('a', { type: 'raise', amount: 1500 })
  t.applyAction('b', { type: 'call' })
  assert.strictEqual(t.gamePhase, 'over')
  t.newGame()
  assert.strictEqual(t.gamePhase, 'lobby')
  for (const s of t.seats.filter(Boolean)) {
    assert.strictEqual(s.stack, 1500)
    assert.strictEqual(s.eliminated, false)
    assert.strictEqual(s.finishPlace, null)
  }
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `eliminated`/`finishPlace` not set, `gamePhase` not `over`, `t.newGame` not a function.

- [ ] **Step 3: Add `_finishHand()`, call it from settlement, add `newGame()`**

In `game/PokerTable.js`, add `this._finishHand()` as the LAST line of BOTH `settlePots` (after `this.phase = 'payout'`) and `awardToLastPlayer` (after `this.phase = 'payout'`).

Then add these two methods (e.g. after `awardChips`):

```js
  // After a hand settles: eliminate broke players (with finishing places) and
  // end the game if one player remains.
  _finishHand() {
    if (this.gamePhase !== 'playing') return
    const wasActive = p => !p.eliminated && !p.waiting
    const busted = this.occupiedSeats().map(i => this.seats[i])
      .filter(p => wasActive(p) && p.stack === 0)
    const survivors = this.occupiedSeats().map(i => this.seats[i])
      .filter(p => wasActive(p) && p.stack > 0)

    // bigger pre-hand stack (== committed for an all-in bust) finishes higher
    busted.sort((a, b) => b.committed - a.committed)
    let place = survivors.length + 1
    for (const p of busted) {
      p.eliminated = true
      p.finishPlace = place
      place++
    }

    if (survivors.length === 1) {
      survivors[0].finishPlace = 1
      this.gamePhase = 'over'
    }
  }

  // From 'over': reset everyone and return to the lobby for a new game.
  newGame() {
    if (this.gamePhase !== 'over') throw new Error('Game is not over')
    this.gamePhase = 'lobby'
    this.phase = 'waiting'
    for (const i of this.occupiedSeats()) {
      Object.assign(this.seats[i], {
        stack: this.startingStack, holeCards: [], bet: 0, committed: 0,
        folded: false, allIn: false, hasActed: false,
        eliminated: false, finishPlace: null, waiting: false,
      })
    }
    this.board = []
    this.pot = 0
    this.winners = []
    this.reveal = false
    this.buttonSeat = -1
    this.toActSeat = -1
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS — the 3 new tests plus all prior tests.

- [ ] **Step 5: Commit**

```bash
git add game/PokerTable.js test/pokerTable.test.js
git commit -m "feat: player elimination with finishing places and game-over"
```

---

## Task 3: `getStateFor` — gamePhase, pots, eliminated/finishPlace/waiting

**Files:**
- Modify: `game/PokerTable.js`
- Modify: `test/pokerTable.test.js`

Expose the new state to clients, and mark mid-game joiners as `waiting` in `sit`.

- [ ] **Step 1: Write the failing tests**

Append to `test/pokerTable.test.js`:

```js
test('getStateFor exposes gamePhase and a pots breakdown', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  const lobby = t.getStateFor('a')
  assert.strictEqual(lobby.gamePhase, 'lobby')

  t.startGame(new Deck().shuffle(() => 0))
  const view = t.getStateFor('a')
  assert.strictEqual(view.gamePhase, 'playing')
  // blinds posted -> one main pot of 30
  assert.ok(Array.isArray(view.pots))
  assert.strictEqual(view.pots[0].label, 'Main')
  assert.strictEqual(view.pots[0].amount, 30)
})

test('getStateFor reports eliminated/finishPlace and waiting joiners', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob')
  t.startGame(new Deck().shuffle(() => 0))
  // someone joins mid-game -> waiting
  const seat = t.sit('z', 'Zoe')
  assert.ok(seat >= 0)
  assert.strictEqual(t.seats[seat].waiting, true)
  const view = t.getStateFor('a')
  const zoe = view.seats[seat]
  assert.strictEqual(zoe.waiting, true)
  // self has eliminated=false, finishPlace=null
  const me = view.seats.find(s => s && s.isSelf)
  assert.strictEqual(me.eliminated, false)
  assert.strictEqual(me.finishPlace, null)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `gamePhase`/`pots`/`waiting` undefined in the state.

- [ ] **Step 3: Mark joiners waiting in `sit`**

In `game/PokerTable.js`, update `sit` to flag mid-game joiners:

```js
  sit(id, username) {
    const existing = this.findSeatById(id)
    if (existing !== -1) return existing
    const seat = this.seats.findIndex(s => s === null)
    if (seat === -1) return -1
    const p = newPlayer(id, username, this.startingStack)
    if (this.gamePhase !== 'lobby') p.waiting = true   // joins the next game
    this.seats[seat] = p
    return seat
  }
```

- [ ] **Step 4: Add `_displayPots()` and extend `getStateFor`**

In `game/PokerTable.js`, add a helper (e.g. before `getStateFor`):

```js
  // Live pot breakdown for display, labelled Main / Side / Side 2 ...
  // Normally a single pot; only split into side pots once a player is all-in
  // (otherwise unequal blinds/partial bets would show spurious side pots).
  _displayPots() {
    const liveBets = this.occupiedSeats().reduce((s, i) => s + this.seats[i].bet, 0)
    const total = this.pot + liveBets
    if (total === 0) return []
    const anyAllIn = this.occupiedSeats().some(i => {
      const p = this.seats[i]
      return p.allIn && !p.eliminated
    })
    if (!anyAllIn) return [{ amount: total, label: 'Main' }]
    const contributors = this.occupiedSeats()
      .map(i => this.seats[i])
      .filter(p => p.committed > 0)
      .map(p => ({ id: p.id, committed: p.committed, folded: p.folded }))
    const pots = buildPots(contributors)
    return pots.map((pot, k) => ({
      amount: pot.amount,
      label: k === 0 ? 'Main' : (pots.length === 2 ? 'Side' : `Side ${k}`),
    }))
  }
```

Then in `getStateFor`, add `gamePhase` and `pots` to the returned object (next to `phase`/`pot`):

```js
      gamePhase: this.gamePhase,
      phase: this.phase,
      board: this.board,
      pot: this.pot + liveBets,
      pots: this._displayPots(),
```

And add the three per-seat fields inside the `seats.map` return object (next to `allIn`):

```js
          allIn: p.allIn,
          eliminated: p.eliminated,
          finishPlace: p.finishPlace,
          waiting: p.waiting,
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add game/PokerTable.js test/pokerTable.test.js
git commit -m "feat: expose gamePhase, pots breakdown, and elimination state to clients"
```

---

## Task 4: Backend events

**Files:**
- Modify: `backend.js`

Replace the single `startHand` socket event with `startGame`, `dealHand`, and `newGame`.

- [ ] **Step 1: Replace the `startHand` handler**

In `backend.js`, replace the `socket.on('startHand', ...)` block with:

```js
  socket.on('startGame', () => {
    try { table.startGame(); broadcast() }
    catch (err) { socket.emit('errorMsg', err.message) }
  })

  socket.on('dealHand', () => {
    try { table.dealHand(); broadcast() }
    catch (err) { socket.emit('errorMsg', err.message) }
  })

  socket.on('newGame', () => {
    try { table.newGame(); broadcast() }
    catch (err) { socket.emit('errorMsg', err.message) }
  })
```

- [ ] **Step 2: Verify it parses and the engine tests still pass**

Run: `node --check backend.js && npm test 2>&1 | tail -3`
Expected: `node --check` clean; all engine tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend.js
git commit -m "feat: startGame/dealHand/newGame socket events"
```

---

## Task 5: Frontend — per-pot display, OUT seats, game-over overlay

**Files:**
- Modify: `public/index.html`
- Modify: `public/css/table.css`
- Modify: `public/js/render.js`

- [ ] **Step 1: Add the game-over overlay element**

In `public/index.html`, add a `#gameover` div immediately AFTER the `</div>` that closes `#table` (before `<div id="controls">`):

```html
    <div id="gameover" class="hidden"></div>
```

- [ ] **Step 2: Add styles**

Append to `public/css/table.css`:

```css
/* per-pot chips */
#pot { display: flex; gap: 6px; justify-content: center; }
.pot-chip {
  font: 700 12px sans-serif; padding: 3px 10px; border-radius: 12px;
  background: #0008; border: 1px solid #ffd166; color: #ffd166;
}
.pot-chip.side { border-color: #9bf6ff; color: #9bf6ff; }

/* eliminated / waiting seats */
.seat.eliminated, .seat.waiting { opacity: .45; filter: grayscale(1); }
.seat .status-out {
  margin-top: 3px; display: inline-block; background: #dc3545; color: #fff;
  font: 700 10px sans-serif; padding: 2px 8px; border-radius: 8px;
}
.seat .status-wait {
  margin-top: 3px; display: inline-block; background: #475569; color: #cbd5e1;
  font: 700 10px sans-serif; padding: 2px 8px; border-radius: 8px;
}

/* game over overlay */
#gameover {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px;
  background: rgba(11,19,43,.9); z-index: 5; text-align: center;
}
.go-trophy { font-size: 40px; }
.go-title { color: #ffd166; font: 800 24px sans-serif; }
.go-standings { color: #cbd5e1; font: 600 13px sans-serif; }
```

- [ ] **Step 3: Update `render.js` — pots, seats, overlay**

In `public/js/render.js`, add an `ordinal` helper near the top (after `rankLabel`):

```js
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
```

Replace the `// pot + result` block (the line setting `#pot` textContent and the result block) with:

```js
  // pots (main + side) as chips
  const potEl = document.getElementById('pot')
  potEl.replaceChildren()
  for (const pot of (state.pots || [])) {
    const chip = document.createElement('div')
    chip.className = 'pot-chip' + (pot.label === 'Main' ? '' : ' side')
    chip.textContent = `${pot.label.toUpperCase()} $${pot.amount}`
    potEl.append(chip)
  }

  // result banner at payout
  const result = document.getElementById('result')
  if (state.phase === 'payout' && state.winners.length) {
    const names = state.winners.map(w => w.username).join(' & ')
    result.textContent = `${names} win${state.winners.length > 1 ? '' : 's'} the pot`
  } else {
    result.textContent = ''
  }

  // game over overlay
  const go = document.getElementById('gameover')
  if (state.gamePhase === 'over') {
    const standings = state.seats.filter(s => s && s.finishPlace != null)
      .sort((a, b) => a.finishPlace - b.finishPlace)
    const winner = standings.find(s => s.finishPlace === 1)
    go.innerHTML =
      `<div class="go-trophy">🏆</div>` +
      `<div class="go-title">${winner ? winner.username : 'Someone'} wins the tournament!</div>` +
      `<div class="go-standings">${standings.map(s => `${ordinal(s.finishPlace)} ${s.username}`).join(' · ')}</div>`
    go.classList.remove('hidden')
  } else {
    go.classList.add('hidden')
  }
```

Then in the seat loop, replace the seat `className`, the hole-cards block, and the `bet` status block with:

```js
    el.className = 'seat'
      + (seat.seat === state.toActSeat ? ' active' : '')
      + (seat.folded && !seat.eliminated && !seat.waiting ? ' folded' : '')
      + (seat.eliminated ? ' eliminated' : '')
      + (seat.waiting ? ' waiting' : '')
    el.style.setProperty('--x', x + '%')
    el.style.setProperty('--y', y + '%')

    const hole = document.createElement('div')
    hole.className = 'hole'
    if (!seat.eliminated && !seat.waiting) {
      if (seat.holeCards === 'hidden') hole.append(cardEl('back'), cardEl('back'))
      else hole.append(...seat.holeCards.map(c => cardEl(c)))
    }

    const nameplate = document.createElement('div')
    nameplate.className = 'nameplate'
    const dealer = seat.seat === state.buttonSeat ? ' <span class="button-chip">D</span>' : ''
    nameplate.innerHTML = `${seat.username} · $${seat.stack}${dealer}`

    const status = document.createElement('div')
    status.className = 'bet'
    if (seat.eliminated) {
      status.innerHTML = `<span class="status-out">OUT · ${ordinal(seat.finishPlace)}</span>`
    } else if (seat.waiting) {
      status.innerHTML = `<span class="status-wait">WAITING</span>`
    } else {
      status.textContent = seat.bet ? `$${seat.bet}` : (seat.allIn ? 'ALL-IN' : '')
    }

    el.append(hole, nameplate, status)
    seatsRoot.append(el)
```

- [ ] **Step 4: Verify it parses**

Run: `node --check public/js/render.js`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/css/table.css public/js/render.js
git commit -m "feat: per-pot display, eliminated/waiting seats, game-over overlay"
```

---

## Task 6: Frontend — context-aware button

**Files:**
- Modify: `public/js/frontend.js`

The single lobby/between-hands button changes label and event based on `gamePhase`.

- [ ] **Step 1: Replace the Start Hand block in `renderControls`**

In `public/js/frontend.js`, replace the block that creates the `Start Hand` button (the `if (seated && !handLive) { ... }` block) with:

```js
  // Context button: lobby -> Start Game, between hands -> Deal Next Hand,
  // game over -> New Game.
  if (seated && !handLive) {
    let label, event
    if (state.gamePhase === 'lobby') { label = 'Start Game'; event = 'startGame' }
    else if (state.gamePhase === 'over') { label = 'New Game'; event = 'newGame' }
    else { label = 'Deal Next Hand'; event = 'dealHand' }
    const btn = document.createElement('button')
    btn.className = 'btn-start'
    btn.textContent = label
    btn.onclick = () => socket.emit(event)
    bar.append(btn)
  }
```

- [ ] **Step 2: Verify it parses**

Run: `node --check public/js/frontend.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add public/js/frontend.js
git commit -m "feat: context-aware Start Game / Deal Next Hand / New Game button"
```

---

## Task 7: Extend the smoke test to two hands

**Files:**
- Modify: `scripts/smoke.mjs`

Confirm a second hand deals, stacks carry over, and the context button cycles.

- [ ] **Step 1: Add a second-hand check**

In `scripts/smoke.mjs`, find the block after the first hand's final assertions (after the `chk('opponent cards revealed at showdown', ...)` line and before the `// console/page errors` section). Insert this block there:

```js
  // --- second hand: stacks carry over, button moves, context button cycles ---
  // the between-hands button should now read "Deal Next Hand"
  const betweenLabel = await alice.page.$eval('#controls button.btn-start', b => b.textContent).catch(() => null)
  chk('between hands shows "Deal Next Hand"', betweenLabel === 'Deal Next Hand')

  await alice.page.click('#controls button.btn-start') // deal hand 2
  await sleep(800)
  const h2 = await snapshot(alice.page)
  chk('hand 2 deals (back to a live hand)', h2.community === 0 && /\d/.test(h2.pot))
  // stacks are no longer the fresh 1500/1500 — someone won hand 1
  const stacks = await alice.page.evaluate(() =>
    [...document.querySelectorAll('#seats .seat .nameplate')]
      .map(n => Number((n.textContent.match(/\$(\d+)/) || [])[1])))
  chk('stacks carried over (not reset to equal 1500)', stacks.length === 2 && stacks[0] !== stacks[1])
```

- [ ] **Step 2: Run the smoke test**

First reinstall deps if needed (`npm install`), then:
Run: `npm run smoke`
Expected: ALL PASS, including the three new second-hand checks. (If the server fails to boot with a missing-module error, run `npm install` first — see the README note about reinstalling.)

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke.mjs
git commit -m "test: extend smoke harness to a second hand with carried-over stacks"
```

---

## Self-Review notes (coverage check)

- **gamePhase lobby/playing/over** → Task 1 (lifecycle), Task 2 (over), Task 3 (exposed).
- **startGame/dealHand split, persistent stacks** → Task 1.
- **activeSeats skipping eliminated/waiting** → Task 1 (iterators + inert via `folded` in `_setupHand`).
- **Elimination + finishing places (incl. simultaneous busts by stack)** → Task 2 (`_finishHand`).
- **Game-over + winner** → Task 2.
- **newGame back to lobby** → Task 2.
- **getStateFor pots/eliminated/finishPlace/waiting; sit waiting** → Task 3.
- **backend startGame/dealHand/newGame** → Task 4.
- **Per-pot display, OUT seats, game-over screen** → Task 5.
- **Context-aware button** → Task 6.
- **Two-hand smoke** → Task 7.
- **Update existing tests to new entry points** → Task 1 Step 6.

**Known follow-ups (out of scope, per spec):** action timers / auto-advance (C3), escalating blinds, reconnection & sit-out, rebuys, tournament payouts.
```
