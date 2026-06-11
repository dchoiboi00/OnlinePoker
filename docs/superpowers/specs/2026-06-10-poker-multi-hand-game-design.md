# Design — Multi-Hand Tournament Game (Target C, sub-project C2)

**Date:** 2026-06-10
**Status:** Approved (pending spec review)
**Target:** Turn the single playable hand into a tournament: chips persist across hands, players bust out, and the game runs until one winner remains.

## Context

C2 is the second sub-project of **Target C**, building on the merged single playable hand (Target B) and side pots (C1). C1 made unequal-stack all-ins settle correctly; C2 is what actually *produces* unequal stacks in play, so side pots finally become visible.

Decomposition recap: **C1 side pots** (done) → **C2 multi-hand tournament** (this spec) → **C3 action timers**.

## Goal

Add a game-level loop above the existing per-hand engine: assign starting stacks once, carry stacks across hands, rotate the button, eliminate players who bust, and end the game when one player holds all the chips. Surface the new state in the DOM UI (per-pot display, eliminated seats, game-over screen, a context-aware button).

## Key Decisions

| Decision | Choice |
|---|---|
| Game style | **Tournament** — equal starting stacks, bust = eliminated, no rebuys, last player standing wins |
| Next hand | **Manual** "Deal Next Hand" button between hands (no auto-advance/timers — that's C3) |
| Busted players | Shown as **eliminated "OUT"** at their seat with a finishing place; skipped in all future hands |
| Blinds | **Fixed** (10/20) — escalating blind levels deferred |
| Mid-game joins | Field **locks at Start Game**; players who sit during a game are spectators ("waiting") and enter at the next game |
| Disconnect mid-game | Player is **removed** (chips leave the table); reconnection/sit-out deferred |

## Scope

### In scope
- Game-level state machine `gamePhase`: `lobby → playing → over`.
- Persistent stacks across hands; starting stacks assigned once at game start.
- Player elimination on bust, with finishing places.
- Game-over detection (one active player left) and winner.
- Button rotation that skips eliminated players.
- A context-aware action button (Start Game / Deal Next Hand / New Game).
- UI: per-pot display (main + side pots), eliminated "OUT" seats with place, an "ALL-IN" indicator distinct from elimination, and a game-over screen.

### Out of scope (later)
- Action timers / auto-advance between hands (C3).
- Escalating blind levels, antes.
- Reconnection / sit-out for disconnects.
- Rebuys, multiple tables, tournament payouts (single winner only).

## Architecture

### Engine: `game/PokerTable.js`

**New game-level state (above the per-hand `phase`):**
- `this.gamePhase`: `'lobby'` | `'playing'` | `'over'`.
- Per-player flags added to `newPlayer`: `eliminated: false`, `finishPlace: null`.

**The current `startHand()` (which resets all stacks) splits into two intents:**
- **`startGame()`** — valid only from `lobby` with ≥2 seated players. Assigns `startingStack` to every seated player, clears `eliminated`/`finishPlace`, sets `gamePhase = 'playing'`, sets the button to the first seat, and deals hand 1.
- **`dealHand()`** — valid only while `playing` (between hands, i.e. after `phase === 'payout'`). Does **not** reset stacks. Rotates the button to the next non-eliminated seat and deals the next hand. Requires ≥2 active players.

A shared private helper holds the common per-hand setup (reset per-hand player fields, post blinds, deal hole cards, set first to act) so `startGame` and `dealHand` differ only in stack assignment and button placement.

**Active vs occupied seats:**
- `occupiedSeats()` — seated (non-null). Used for display.
- `activeSeats()` — seated **and** not eliminated. Used for all hand logic: dealing, blinds, button placement, `nextToAct`. (Within a hand, `folded` remains the per-hand exclusion; `eliminated` is the whole-game exclusion.)
- `seatsClockwiseFrom` gains an active-only variant (or a `skipEliminated` option) used by blinds/button/deal/action so eliminated players are passed over.

**Bust + game-over (after each hand settles, in the payout transition):**
- Any non-eliminated player at `stack === 0` is marked `eliminated = true` and assigned a `finishPlace`. Finishing place = (number of players still active after this bust) + 1. If multiple players bust in the same hand, order them by their stack at the **start** of that hand (larger stack finishes higher); ties broken by seat order.
- If exactly one active player remains, set `gamePhase = 'over'`, mark that player `finishPlace = 1` (the winner). The `over` state persists until **New Game**.
- `newGame()` — from `over`, returns to `lobby` (clears stacks/eliminated/finishPlace, keeps seats), so a new game can be started with the currently seated players.

**Mid-game joins:** while `gamePhase` is `playing` or `over`, `sit()` seats the player but marks them `waiting: true` (no stack, skipped like eliminated). `startGame`/`newGame` clears `waiting` and includes them.

### Networking: `backend.js`
- New socket events: `startGame`, `dealHand`, `newGame` (the client emits the right one based on `gamePhase`). The old `startHand` event is replaced.
- `broadcast()` is unchanged in shape; the richer state comes from `getStateFor`.

### Personalized state: `getStateFor(id)`
Adds:
- `gamePhase` (`lobby`/`playing`/`over`).
- `pots`: an array `[{ amount, label }]` derived from C1's `buildPots` during a live hand (and the settled pots at showdown) — `label` is `"Main"` for the first pot and `"Side"` (or `"Side 2"`, …) for the rest. Replaces relying on the single `pot` number for display (the single `pot` total is kept for backward compatibility).
- Per seat: `eliminated`, `finishPlace`, `waiting`, and an `allIn` flag already present — so the client can render OUT / ALL-IN / waiting.

### Frontend: `public/js`
- **`render.js`** — render the `pots` array as separate chips (Main + Side); render eliminated seats greyed with an `OUT · {place}` badge and no cards; render `ALL-IN` for active all-in players; render `waiting` spectators greyed.
- **`frontend.js`** (`renderControls`) — the single context button derives its label/event from `gamePhase` + `phase`: `lobby` → **Start Game** (`startGame`), `playing` & `payout` → **Deal Next Hand** (`dealHand`), `over` → **New Game** (`newGame`). During an active hand it shows the betting controls as today.
- **Game-over screen** — when `gamePhase === 'over'`, an overlay shows the 🏆 winner, final standings ordered by `finishPlace`, and the **New Game** button.

## Data flow (one game)

```
LOBBY  --Start Game-->  PLAYING  --hand--> settle --> bust check
  ^                        |  ^                          |
  |                        |  |__ Deal Next Hand (>=2) __|
  New Game                 |
  |                        v (1 active left)
  +----------------------  OVER (winner, standings)
```

## Testing

### `test/pokerTable.test.js` (engine)
- `startGame` assigns starting stacks, sets `gamePhase` to `playing`, deals hand 1.
- `dealHand` carries stacks over (no reset) and rotates the button to the next non-eliminated seat.
- A player who loses their last chip is `eliminated` after the hand, with the correct `finishPlace`, and is skipped (no cards/blinds/action) on the next hand.
- Button and blinds skip eliminated seats correctly (e.g., button was on a seat that just busted).
- Game-over: reducing to one active player sets `gamePhase = 'over'` and that player's `finishPlace = 1`.
- `newGame` returns to `lobby` and re-includes seated players on the next `startGame`.
- Chip conservation across a multi-hand game (total chips in play constant until a player leaves).
- Regression: all existing single-hand tests still pass once `startHand` is replaced by `startGame`/`dealHand` (update existing tests to the new entry points).

### Browser smoke (`npm run smoke`)
- Extend the harness to play **two hands** and assert stacks carry over, the button moves, and the context button cycles Start Game → Deal Next Hand. (A full bust-to-game-over flow needs 3 contexts and is optional.)

## Workflow constraints
- **Test-first** for the engine changes.
- **Commit in logical chunks** (e.g. "gamePhase + startGame/dealHand split", "elimination + game-over", "getStateFor pots/eliminated", "DOM per-pot + OUT + game-over").
- **No Claude/AI attribution** in commits or PRs.

## Follow-ups (not this sub-project)
- C3: action timers and optional auto-advance between hands.
- Escalating blinds/antes, reconnection & sit-out, rebuys, tournament payout structures.
