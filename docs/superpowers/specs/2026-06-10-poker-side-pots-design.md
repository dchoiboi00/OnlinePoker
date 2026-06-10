# Design — Side Pots (Target C, sub-project C1)

**Date:** 2026-06-10
**Status:** Approved (pending spec review)
**Target:** Correct pot distribution when players are all-in for different amounts.

## Context

This is the first sub-project of **Target C** (the multi-hand persistent game).
Target C decomposes into, in dependency order:

1. **C1 — Side pots** (this spec): correct multi-pot distribution for unequal
   all-ins. Pure logic foundation.
2. **C2 — Multi-hand game loop**: persistent chip stacks, dealer-button rotation,
   busting out / elimination, game-over, auto next hand. Relies on C1.
3. **C3 — Action timers**: auto-check/fold on timeout.

Side pots come first because the single-hand engine's "no side pots needed"
guarantee depends on **equal stacks reset each hand**. The moment C2 makes chips
persist, stacks go unequal and a 3+ player all-in *requires* side pots to settle
correctly. Building and testing the side-pot algorithm in isolation first means
C2 is correct by construction.

## Goal

Replace the single-pot settlement with a side-pot-aware settlement so that a
player who is all-in for less than the full bet can only win the portion of the
pot that every contributor matched. Higher contributions form side pots
contestable only by the players who put those chips in.

## Scope

### In scope
- A pure `buildPots` function that turns per-player contributions into an
  ordered list of pots (main pot first), each with an amount and the set of
  players eligible to win it.
- Engine settlement (`settlePots`) that awards each pot to the best eligible
  hand, with chop and odd-chip handling per pot.
- A refinement to `leave()` so a player who departs mid-hand still has their
  contribution counted in the pots (chips never vanish).
- Thorough unit tests for `buildPots` and integration tests for the engine.

### Out of scope (later sub-projects / YAGNI)
- Persistent stacks, button rotation, busting, game-over (C2).
- Action timers (C3).
- Any UI change: the frontend keeps showing a single total pot. Per-pot display
  is deferred to C2, when multiway all-ins actually occur in play.
- A production "dev hook" to start hands with unequal stacks. Tests set seat
  stacks directly instead.

### Key constraint: no behavioral change in the current game
With equal starting stacks reset each hand, every contribution is equal, so
`buildPots` collapses to exactly one main pot and settlement is identical to
today. **All 35 existing tests must still pass unchanged.**

## Architecture

### New unit: `game/sidePots.js` (pure)

```
buildPots(contributors) -> [ { amount, eligibleIds }, ... ]   // main pot first
```

- **Input:** a snapshot array `[{ id, committed, folded }]` for every player who
  put chips in this hand. Folded players are included — their chips belong in the
  pots; they are simply never eligible to win.
- **Output:** an ordered list of pots. Each pot has:
  - `amount` — chips in the pot.
  - `eligibleIds` — ids of non-folded players who contributed at least up to that
    pot's tier (the players who can win it).
- **No engine dependencies.** The entire algorithm lives here and is unit-tested
  in isolation, like `handEvaluator`.

### Engine changes: `game/PokerTable.js`

- Replace `payout(winners)` with `settlePots()`:
  1. Build a contributor snapshot from the seats: `{ id, committed, folded }`
     for every seat with `committed > 0` (including departed players still
     retained in their seat — see `leave()` below).
  2. Call `buildPots(snapshot)`.
  3. For each pot, among its `eligibleIds`, pick the best hand using the showdown
     scores already computed (reuse `evaluateBest`/`compareScores`). Award the
     pot, splitting ties evenly with the odd chip to the first eligible winner
     left of the button.
  4. A pot whose `eligibleIds` is empty (a folded player's uncalled overbet) is
     refunded to its contributor(s).
- `showdown()` computes each contender's hand score once, then calls
  `settlePots()`.
- `awardToLastPlayer(seat)` (everyone folded to one player) awards the entire
  contributed total to that player — no per-pot evaluation needed.
- `this.pot` remains the **display total** (sum of contributions not yet
  awarded), so `getStateFor` and the frontend are unchanged. `settlePots` zeroes
  it when done.
- `this.winners` becomes the **union** of all pot winners (deduped), so the
  existing single-line "X wins" banner still renders. Per-pot attribution is
  deferred to C2.

### The algorithm (`buildPots`)

1. Collect the distinct `committed` levels across all contributors, ascending.
2. Walk the levels as layers. For level `L` with previous level `prev`:
   - `layer = L - prev`
   - `contributorsAtLevel` = players with `committed >= L` (folded included)
   - pot `amount = layer * contributorsAtLevel.length`
   - `eligibleIds` = players with `committed >= L` and `folded === false`
   - `prev = L`
3. Merge adjacent pots that have identical `eligibleIds` into a single pot. With
   equal contributions this yields exactly one main pot.

This handles the cases that matter without special-casing:
- **Uncalled bet** (you commit 1500, only caller is all-in for 500): the top
  1000 tier has you as its lone eligible contributor, so you win it back.
- **Folded contributor:** chips counted into the tiers; never in `eligibleIds`.
- **No eligible winner for a tier** (folded player's uncalled overbet): refunded
  to the contributor.
- **Chop + odd chip:** applied per pot; odd chip to the first eligible winner
  left of the button (same rule as today, now per pot).

### The one edge it forces: `leave()`

Today `leave()` during a live hand sweeps the player's street `bet` into the pot
and nulls the seat. Nulling drops their `committed` from the snapshot, so their
contributed chips would vanish from the side-pot math.

**Change:** when a player leaves during a live hand, mark them `folded = true`
and `left = true` but **keep their seat object** until the hand ends. Their
contribution stays counted (they are ineligible to win because folded). After
settlement (and before the next hand deals), remove any `left` seats. The
existing "leaving reduces the table to one contender → award" and chip-sweep
behavior is preserved.

## Testing

### `test/sidePots.test.js` (pure unit tests on `buildPots`)
- Equal contributions (3 players, all 200) → one pot of 600, all eligible.
- One short all-in: A=1500, B=1500, C=500 → main pot 1500 eligible {A,B,C};
  side pot 2000 eligible {A,B}.
- Two all-ins: A=1500, B=900, C=400 → three pots with correct amounts and
  shrinking eligibility.
- Folded contributor: their chips are in the pot total but never in `eligibleIds`.
- Uncalled bet: lone top-tier contributor gets that tier as a one-eligible pot.
- Tier with no eligible (folded) winner → refund marker / empty eligibility.

### `test/pokerTable.test.js` (integration)
- Set seat stacks directly to unequal values (test-only) after `startHand`, then
  drive real all-ins to a showdown; assert each player's final stack and that
  chips are conserved (total chips constant across the hand).
- A 3-player hand where the short stack wins the main pot but a bigger stack wins
  the side pot — assert the split is correct.
- Departed player mid-hand: their committed chips remain in the pot and are won
  by an eligible player; chip conservation holds.

### Regression
- The full existing suite (35 tests) passes unchanged — equal-stack settlement is
  byte-identical.

## Workflow constraints
- **Test-first** for `buildPots` and the engine changes.
- **Commit in reasonable, logical chunks** (e.g. "buildPots + tests", then
  "settlePots in engine", then "leave() retains departed contributions").
- **No Claude/AI attribution** in commit messages or PRs.

## Follow-ups (not this sub-project)
- C2: persistent stacks, button rotation, busting, game-over, next-hand flow —
  this is what makes side pots occur in real play, and where per-pot UI display
  is added.
- C3: action timers.
