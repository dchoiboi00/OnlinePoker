# Side Pots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute the pot correctly when players are all-in for different amounts, so a short all-in player can only win the portion every contributor matched.

**Architecture:** A pure `buildPots(contributors)` function (new `game/sidePots.js`) turns per-player contributions into ordered pots (main first). `PokerTable.settlePots()` replaces the old single-winner `payout()`, awarding each pot to the best eligible hand with per-pot chop + odd chip. Chips from players who left mid-hand are captured as "dead money" (the difference between `this.pot` and the seated players' committed totals) and added to the main pot — so no `leave()` rewrite is needed and all existing tests keep passing.

**Tech Stack:** Node 20, `node:test` / `node:assert`.

**Spec:** `docs/superpowers/specs/2026-06-10-poker-side-pots-design.md`

**Commit discipline:** one commit per task, exact messages given. **No Claude/AI attribution in commit messages.**

---

## Design note: how this differs from the spec, and why

The spec proposed refining `leave()` to *retain departed players in their seats* so their `committed` stays in the pot math. While building the plan we found a simpler mechanism that achieves the same goal (chips never vanish) with less code and zero risk to existing tests:

- The **only** code path where multiple players split a pot is `showdown()` (2+ non-folded players). Every "one player left standing" path (everyone folds, or a leave reduces the table to one) goes through `awardToLastPlayer`, which correctly gives the **whole** `this.pot` to the lone winner — no side pots possible with one contender.
- `this.pot` already contains *every* chip put in this hand (street bets are swept into it as each street ends, and `leave()` sweeps the leaver's current bet). So at a showdown, **`this.pot − (sum of seated players' committed)` is exactly the chips contributed by players who have since left** — the "dead money."
- `settlePots()` therefore builds tiers from seated players' `committed` and adds that dead-money difference to the main pot. `leave()` and `awardToLastPlayer` are left essentially unchanged, so all current leave/fold-to-win tests pass untouched.

**Known limitation (documented, deferred to C2):** if a player leaves mid-hand *and* 2+ remaining players then reach an all-in showdown for unequal amounts, the departed player's dead money all lands in the main pot rather than being re-tiered. This is rare, chip-conserving, and cannot occur in the current equal-stack game. Revisit if C2's persistent stacks make it matter.

---

## File Structure

**Create:**
- `game/sidePots.js` — `buildPots(contributors)`. Pure, no engine deps.
- `test/sidePots.test.js` — unit tests for `buildPots`.

**Modify:**
- `game/PokerTable.js` — add `require('./sidePots')`; replace `payout()` with `settlePots()` + `awardChips()`; update `showdown()`; inline the single-winner award in `awardToLastPlayer()`.
- `test/pokerTable.test.js` — add integration tests for real side pots + a departed-player conservation test.

---

## Task 1: `buildPots` pure function

**Files:**
- Create: `game/sidePots.js`
- Test: `test/sidePots.test.js`

`buildPots(contributors)` takes `[{ id, committed, folded }]` (every player who put chips in this hand; folded players included) and returns ordered pots `[{ amount, eligibleIds }]`, main pot first. `eligibleIds` = non-folded contributors who reached that tier.

- [ ] **Step 1: Write the failing tests**

Create `test/sidePots.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { buildPots } = require('../game/sidePots')

test('equal contributions form a single main pot', () => {
  const pots = buildPots([
    { id: 'a', committed: 200, folded: false },
    { id: 'b', committed: 200, folded: false },
    { id: 'c', committed: 200, folded: false },
  ])
  assert.strictEqual(pots.length, 1)
  assert.strictEqual(pots[0].amount, 600)
  assert.deepStrictEqual(pots[0].eligibleIds.sort(), ['a', 'b', 'c'])
})

test('one short all-in creates a main pot and one side pot', () => {
  // a,b have 1500 in; c is all-in for 500
  const pots = buildPots([
    { id: 'a', committed: 1500, folded: false },
    { id: 'b', committed: 1500, folded: false },
    { id: 'c', committed: 500, folded: false },
  ])
  assert.strictEqual(pots.length, 2)
  // main: 500 from each of 3 = 1500, all eligible
  assert.strictEqual(pots[0].amount, 1500)
  assert.deepStrictEqual(pots[0].eligibleIds.sort(), ['a', 'b', 'c'])
  // side: 1000 from each of a,b = 2000, only a,b eligible
  assert.strictEqual(pots[1].amount, 2000)
  assert.deepStrictEqual(pots[1].eligibleIds.sort(), ['a', 'b'])
})

test('two all-ins create two side pots with shrinking eligibility', () => {
  const pots = buildPots([
    { id: 'a', committed: 1500, folded: false },
    { id: 'b', committed: 900, folded: false },
    { id: 'c', committed: 400, folded: false },
  ])
  assert.strictEqual(pots.length, 3)
  assert.strictEqual(pots[0].amount, 1200) // 400 * 3
  assert.deepStrictEqual(pots[0].eligibleIds.sort(), ['a', 'b', 'c'])
  assert.strictEqual(pots[1].amount, 1000) // (900-400) * 2
  assert.deepStrictEqual(pots[1].eligibleIds.sort(), ['a', 'b'])
  assert.strictEqual(pots[2].amount, 600)  // (1500-900) * 1
  assert.deepStrictEqual(pots[2].eligibleIds.sort(), ['a'])
})

test('a folded contributor adds chips but is never eligible', () => {
  // b folded after committing 1500
  const pots = buildPots([
    { id: 'a', committed: 1500, folded: false },
    { id: 'b', committed: 1500, folded: true },
    { id: 'c', committed: 500, folded: false },
  ])
  // main: 1500, eligible a,c (not b); side: 2000, eligible a only
  assert.strictEqual(pots[0].amount, 1500)
  assert.deepStrictEqual(pots[0].eligibleIds.sort(), ['a', 'c'])
  assert.strictEqual(pots[1].amount, 2000)
  assert.deepStrictEqual(pots[1].eligibleIds.sort(), ['a'])
})

test('a lone top-tier contributor (uncalled bet) gets its own pot', () => {
  const pots = buildPots([
    { id: 'a', committed: 1500, folded: false },
    { id: 'c', committed: 500, folded: false },
  ])
  assert.strictEqual(pots.length, 2)
  assert.strictEqual(pots[0].amount, 1000)            // 500 * 2
  assert.deepStrictEqual(pots[0].eligibleIds.sort(), ['a', 'c'])
  assert.strictEqual(pots[1].amount, 1000)            // (1500-500) * 1
  assert.deepStrictEqual(pots[1].eligibleIds, ['a'])  // a wins it back
})

test('a tier whose only contributors folded has empty eligibility', () => {
  // a folded with the strict-highest contribution (constructed input)
  const pots = buildPots([
    { id: 'a', committed: 100, folded: true },
    { id: 'b', committed: 50, folded: false },
  ])
  assert.strictEqual(pots[0].amount, 100)             // 50 * 2
  assert.deepStrictEqual(pots[0].eligibleIds, ['b'])
  assert.strictEqual(pots[1].amount, 50)              // (100-50) * 1
  assert.deepStrictEqual(pots[1].eligibleIds, [])     // a folded -> nobody eligible
})

test('contributors of 0 are ignored', () => {
  const pots = buildPots([
    { id: 'a', committed: 100, folded: false },
    { id: 'b', committed: 0, folded: false },
  ])
  assert.strictEqual(pots.length, 1)
  assert.strictEqual(pots[0].amount, 100)
  assert.deepStrictEqual(pots[0].eligibleIds, ['a'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../game/sidePots'`.

- [ ] **Step 3: Implement `buildPots`**

Create `game/sidePots.js`:

```js
// Pure side-pot construction. No engine dependencies.
//
// contributors: [{ id, committed, folded }] — everyone who put chips in this
//   hand. Folded players are included (their chips are in the pots) but are
//   never eligible to win.
// Returns ordered pots [{ amount, eligibleIds }], main pot first.
function buildPots(contributors) {
  const live = contributors.filter(c => c.committed > 0)
  if (live.length === 0) return []

  // distinct contribution levels, ascending — each is a pot boundary
  const levels = [...new Set(live.map(c => c.committed))].sort((a, b) => a - b)

  const pots = []
  let prev = 0
  for (const level of levels) {
    const layer = level - prev
    const atOrAbove = live.filter(c => c.committed >= level)
    pots.push({
      amount: layer * atOrAbove.length,
      eligibleIds: atOrAbove.filter(c => !c.folded).map(c => c.id),
    })
    prev = level
  }

  // merge adjacent pots that share the exact same eligibility
  const merged = []
  for (const pot of pots) {
    const last = merged[merged.length - 1]
    if (last && sameIds(last.eligibleIds, pot.eligibleIds)) {
      last.amount += pot.amount
    } else {
      merged.push({ amount: pot.amount, eligibleIds: [...pot.eligibleIds] })
    }
  }
  return merged
}

function sameIds(a, b) {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every(id => setB.has(id))
}

module.exports = { buildPots }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 7 `buildPots` tests, and the existing 35 still green (38+ total).

- [ ] **Step 5: Commit**

```bash
git add game/sidePots.js test/sidePots.test.js
git commit -m "feat: buildPots constructs main and side pots from contributions"
```

---

## Task 2: Wire side-pot settlement into the engine

**Files:**
- Modify: `game/PokerTable.js`

Replace the single-winner `payout()` with side-pot-aware `settlePots()` + `awardChips()`, update `showdown()` to compute hand scores and call `settlePots()`, and inline the lone-winner award in `awardToLastPlayer()`. This is a refactor under the existing tests: **equal-stack behavior is identical, so all 35 existing tests must stay green.**

- [ ] **Step 1: Add the `buildPots` import**

In `game/PokerTable.js`, change the top requires:

```js
const { Deck } = require('./cards')
const { evaluateBest, compareScores } = require('./handEvaluator')
const { buildPots } = require('./sidePots')
```

- [ ] **Step 2: Replace `showdown()`**

Replace the existing `showdown()` method with:

```js
  showdown() {
    this.phase = 'showdown'
    this.reveal = true
    // score each non-folded player's best hand once
    const scoreById = new Map()
    for (const i of this.occupiedSeats()) {
      const p = this.seats[i]
      if (!p.folded) scoreById.set(p.id, evaluateBest([...p.holeCards, ...this.board]))
    }
    this.settlePots(scoreById)
  }
```

- [ ] **Step 3: Replace `awardToLastPlayer()` (inline the lone-winner award)**

Replace the existing `awardToLastPlayer()` method with:

```js
  awardToLastPlayer(seat) {
    // everyone else folded or left — the lone contender takes the whole pot,
    // including any dead money. No side pots are possible with one contender.
    for (const i of this.occupiedSeats()) { this.pot += this.seats[i].bet; this.seats[i].bet = 0 }
    this.reveal = false
    const w = this.seats[seat]
    w.stack += this.pot
    this.winners = [{ id: w.id, username: w.username }]
    this.pot = 0
    this.phase = 'payout'
  }
```

- [ ] **Step 4: Replace `payout()` with `settlePots()` + `awardChips()`**

Delete the entire existing `payout(winners) { ... }` method and add these two methods in its place:

```js
  settlePots(scoreById) {
    // contributions from players still seated (folded players included)
    const contributors = this.occupiedSeats()
      .map(i => this.seats[i])
      .filter(p => p.committed > 0)
      .map(p => ({ id: p.id, committed: p.committed, folded: p.folded }))
    const pots = buildPots(contributors)

    // chips from players who left mid-hand are in this.pot but not in any
    // seated player's committed total — fold them into the main pot
    const seatedTotal = contributors.reduce((sum, c) => sum + c.committed, 0)
    const deadMoney = this.pot - seatedTotal
    if (deadMoney > 0) {
      if (pots.length === 0) {
        const stillIn = this.occupiedSeats()
          .map(i => this.seats[i]).filter(p => !p.folded).map(p => p.id)
        pots.push({ amount: deadMoney, eligibleIds: stillIn })
      } else {
        pots[0].amount += deadMoney
      }
    }

    const winnerIds = new Set()
    // award top tier downward; an empty (no eligible winner) tier rolls its
    // chips down onto the next lower tier that does have winners
    let rollDown = 0
    for (let k = pots.length - 1; k >= 0; k--) {
      const amount = pots[k].amount + rollDown
      const eligible = pots[k].eligibleIds
      if (eligible.length === 0) { rollDown = amount; continue }
      rollDown = 0

      let recipients
      if (eligible.length === 1) {
        recipients = eligible
      } else {
        let best = null
        for (const id of eligible) {
          const s = scoreById.get(id)
          if (!best || compareScores(s, best) > 0) best = s
        }
        recipients = eligible.filter(id => compareScores(scoreById.get(id), best) === 0)
      }
      this.awardChips(amount, recipients)
      recipients.forEach(id => winnerIds.add(id))
    }

    this.winners = [...winnerIds].map(id => {
      const p = this.seats[this.findSeatById(id)]
      return { id: p.id, username: p.username }
    })
    this.pot = 0
    this.phase = 'payout'
  }

  // Split `amount` among recipient ids, odd chip to the first eligible seat
  // left of the button.
  awardChips(amount, recipientIds) {
    const ids = new Set(recipientIds)
    const ordered = this.seatsClockwiseFrom(this.buttonSeat)
      .map(i => this.seats[i])
      .filter(p => ids.has(p.id))
    const share = Math.floor(amount / ordered.length)
    let remainder = amount - share * ordered.length
    for (const w of ordered) {
      w.stack += share
      if (remainder > 0) { w.stack += 1; remainder-- }
    }
  }
```

- [ ] **Step 5: Run the full suite — existing behavior must be unchanged**

Run: `npm test`
Expected: PASS — all 35 existing tests plus Task 1's 7 `buildPots` tests. Equal-stack showdowns collapse to a single pot, so `settlePots` produces the same payouts the old `payout` did (the showdown-winner and tie-chop tests confirm this), and the leave/fold-to-win tests still go through `awardToLastPlayer`.

- [ ] **Step 6: Commit**

```bash
git add game/PokerTable.js
git commit -m "feat: settle showdowns into side pots, keeping dead money in the main pot"
```

---

## Task 3: Integration tests for real side pots

**Files:**
- Modify: `test/pokerTable.test.js`

Drive the engine into genuine unequal-stack all-ins (by setting a seat's stack directly — test-only, no production hook) and assert the short stack can only win the main pot. Add a departed-player conservation test.

- [ ] **Step 1: Add the failing tests**

Append to `test/pokerTable.test.js`:

```js
test('short all-in wins only the main pot; the rest goes to the side pot', () => {
  const c = (rank, suit) => ({ rank, suit })
  // Deal order (button=seat0): round1 seat1,seat2,seat0 ; round2 seat1,seat2,seat0
  //   seat1 (Bob) folds preflop, so his cards are irrelevant.
  //   seat2 (Carol) = A♥ Q♥  -> makes the nut flush, the BEST hand
  //   seat0 (Alice) = K♦ K♠  -> pair of kings
  //   board: 5♥ 9♥ 2♥ 7♦ 8♣  -> three hearts complete Carol's flush
  const top = [
    c(2, 'Clubs'),  c(14, 'Hearts'), c(13, 'Diamonds'), // r1: Bob, Carol, Alice
    c(3, 'Clubs'),  c(12, 'Hearts'), c(13, 'Spades'),   // r2: Bob, Carol, Alice
    c(5, 'Hearts'), c(9, 'Hearts'), c(2, 'Hearts'),     // flop
    c(7, 'Diamonds'),                                    // turn
    c(8, 'Clubs'),                                       // river
  ]
  const rest = new Deck().cards.filter(
    x => !top.some(t => t.rank === x.rank && t.suit === x.suit))
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20, startingStack: 1500 })
  t.sit('a', 'Alice') // seat 0 — button (UTG 3-handed)
  t.sit('b', 'Bob')   // seat 1 — SB
  t.sit('c', 'Carol') // seat 2 — BB
  t.startHand(new Deck([...top, ...rest]))

  // make Carol short: 20 already posted as BB, leave her only 80 behind
  t.seats[2].stack = 80

  t.applyAction('a', { type: 'raise', amount: 200 }) // Alice raises to 200
  t.applyAction('b', { type: 'fold' })               // Bob folds (committed 10)
  t.applyAction('c', { type: 'call' })               // Carol all-in for 100 total

  assert.strictEqual(t.phase, 'payout')
  // main pot = 100 from Alice + 100 from Carol + Bob's 10 = 210, won by Carol (flush)
  assert.strictEqual(t.seats[2].stack, 210)
  // side pot = Alice's uncalled 100, returned to Alice (1500 - 200 + 100)
  assert.strictEqual(t.seats[0].stack, 1400)
  // Bob folded his small blind
  assert.strictEqual(t.seats[1].stack, 1490)
  // both Alice and Carol are credited as winners (of different pots)
  assert.deepStrictEqual(t.winners.map(w => w.id).sort(), ['a', 'c'])
})

test('a player leaving mid-hand leaves no chips behind at showdown', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startHand(new Deck().shuffle(() => 0.5))
  // everyone limps in preflop
  t.applyAction('a', { type: 'call' })   // UTG calls 20
  t.applyAction('b', { type: 'call' })   // SB completes
  t.applyAction('c', { type: 'check' })  // BB checks -> flop

  // Carol leaves on the flop; Alice and Bob remain
  t.leave('c')

  // capture all chips in play among the remaining players (stacks + live pot)
  const remaining = ['a', 'b']
  const before = remaining.reduce(
    (sum, id) => sum + t.seats[t.findSeatById(id)].stack, 0) + t.getStateFor('a').pot

  // Alice and Bob check it down to showdown
  let guard = 0
  while (t.phase !== 'payout' && guard++ < 20) {
    const seat = t.toActSeat
    if (seat === -1) break
    const id = t.seats[seat].id
    const la = t.legalActions(id)
    t.applyAction(id, la.canCheck ? { type: 'check' } : { type: 'call' })
  }

  assert.strictEqual(t.phase, 'payout')
  assert.strictEqual(t.pot, 0)
  // every chip that was in play (including Carol's dead money) ended up with a,b
  const after = remaining.reduce(
    (sum, id) => sum + t.seats[t.findSeatById(id)].stack, 0)
  assert.strictEqual(after, before)
})
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: PASS — both new integration tests, plus all prior tests (44+ total). If the side-pot split test fails, the dealt cards or bet amounts don't match the engine's deal order — re-verify against `game/PokerTable.js` rather than changing engine logic.

- [ ] **Step 3: Commit**

```bash
git add test/pokerTable.test.js
git commit -m "test: side-pot split and departed-player chip conservation"
```

---

## Self-Review notes (coverage check)

- **`buildPots` pure function** → Task 1 (equal, one/two side pots, folded contributor, uncalled bet, empty-eligibility, zero contributor).
- **`settlePots` per-pot award + chop/odd-chip** → Task 2.
- **Dead money from departed players** → Task 2 (`this.pot − seatedTotal`), verified in Task 3 conservation test. This fulfills the spec's "departed contributions stay counted" goal via a simpler mechanism than seat-retention (see Design note).
- **No UI change / `this.pot` kept for display / `winners` as union** → Task 2.
- **Equal-stack behavior identical / 35 existing tests pass** → Task 2 Step 5.
- **Integration with unequal stacks** → Task 3.

**Known follow-ups (out of scope, per spec):** persistent stacks / button rotation / busting (C2 — the sub-project that makes side pots occur in real play and adds per-pot UI), action timers (C3), and re-tiering dead money for the rare leave-then-multiway-all-in case.
```
