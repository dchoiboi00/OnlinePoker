# Design — One Playable No-Limit Hold'em Hand

**Date:** 2026-06-09
**Status:** Approved (pending spec review)
**Target:** A complete, playable single hand of No-Limit Texas Hold'em over multiplayer, end to end.

## Goal

Turn the current skeleton (Express + Socket.io app that seats players around a
table) into a **workable demo**: a full hand of No-Limit Texas Hold'em plays out
from deal to showdown with a real winner. One hand at a time; "Start Hand" deals
a fresh hand.

This is "Target B" — the smallest thing that is actually *poker*. A later
milestone ("Target C") adds dealer-button rotation, persistent chip stacks,
busting out, side pots, and timers.

## Scope

### In scope
- Manual hand start: players join and sit (2–7 seats); any seated player clicks
  **Start Hand** once ≥2 are seated.
- Full No-Limit Hold'em hand: post blinds → deal hole cards → preflop / flop /
  turn / river betting → showdown → payout → back to waiting.
- No-Limit betting: Fold / Check / Call / Bet / Raise with a bet-size slider;
  all-in allowed.
- Server-authoritative game state and validation.
- Private hole cards (each client sees only its own face-up).
- Hand evaluation (best 5-of-7) with tie/chop handling.
- Full-DOM (HTML + CSS) table UI replacing the canvas draw loop.

### Out of scope (deferred to a later milestone)
- Action timers (players act at their own pace).
- AI / bot players — testing & demoing is done by opening multiple browser tabs.
- Side pots, persistent chip stacks across hands, rebuys, multiple tables.
- Dealer-button rotation across hands.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| How much poker | One full playable hand (Target B) | Smallest thing that is real poker; compelling demo |
| Hand start | Manual "Start Hand" button, 2–7 players | Deterministic for demos; least fiddly |
| Betting structure | No-Limit Hold'em | The recognizable classic |
| Rendering | Full DOM / HTML + CSS | Interactive betting UI is far easier in DOM than canvas |
| Authority | Server-authoritative | Required so hole cards stay private; server validates all actions |
| Stakes | 1,500 chips, blinds 10/20, **stacks reset each hand** | Equal stacks in one hand ⇒ side pots impossible ⇒ correct NL without side-pot logic |

### Why side pots are not needed here
Every player starts a hand with an identical 1,500-chip stack and stacks reset
each hand. In a single hand, no player can ever be all-in for *less* than another
player needs to call — everyone can always cover. Therefore only a single main
pot is ever required. Side pots become necessary only with unequal/persistent
stacks (Target C), so they are explicitly deferred.

## Architecture

**Server-authoritative.** The backend owns all game state and rules. Clients
render the state they are given and send *intents* ("fold", "raise to 120"); the
server validates every action and pushes updated state.

This replaces the current design where the entire deck is broadcast to all
clients every 15 ms — incompatible with private hole cards.

### Backend modules
- `backend.js` — Express + Socket.io wiring, connection/seat management, routes
  socket events to the engine. Stays thin.
- `game/PokerTable.js` — the hand state machine. Holds players, pot, board,
  current bet, whose turn, dealer button, betting-round bookkeeping. Exposes
  `startHand()`, `applyAction(playerId, action)`, and advances streets.
- `game/handEvaluator.js` — pure function: given 7 cards (2 hole + 5 board),
  returns the best 5-card hand and a comparable rank. Heavily unit-tested.
- `game/Deck.js` — existing Deck, cleaned up (fix the in-browser
  `module.exports` issue; keep Fisher–Yates shuffle).

### Frontend modules (`public/js`, DOM-based)
- `frontend.js` — socket connection; holds latest game state; renders the table
  from it (replaces the canvas draw loop and `Player.draw()`).
- `render/table.js`, `render/seat.js`, `render/controls.js` — render seats,
  cards, pot, and the Fold/Call/Raise controls + bet slider from state.
- `eventListeners.js` — wires betting controls and the Start Hand button to emit
  intents.

The `table.jpeg` felt may remain as a CSS background if desired.

### Networking
- Server emits a **personalized** `gameState` to each socket: your own hole cards
  face-up; opponents' as face-down counts; shared board, pot, current bet, whose
  turn, and the set of legal actions for the recipient.
- The 15 ms broadcast ticker is **removed**. State is pushed only when it changes
  (on actions and street transitions).

## Game Flow (state machine)

```
WAITING ──Start Hand──> POST_BLINDS ──> DEAL_HOLE
   ▲                                        │
   │                                        ▼
PAYOUT <── SHOWDOWN <── RIVER_BET <── TURN_BET <── FLOP_BET <── PREFLOP_BET
```

Each `*_BET` is a betting round: action moves to the next active player who
chooses Fold / Check / Call / Bet / Raise; the round closes when all non-folded
players have matched the current bet or are all-in. After preflop, the flop (3),
turn (1), and river (1) community cards are dealt before their betting rounds.

**Shortcut:** if everyone folds to a single remaining player at any point, that
player wins the pot immediately and the hand jumps to PAYOUT (no showdown).

## Betting rules (server-enforced)
- Legal actions are computed per player, per turn, server-side.
- **Check** only when there is no outstanding bet to match.
- **Call** matches the current bet (capped at the player's stack = all-in).
- Min **raise** = the size of the previous bet/raise; max = the player's whole
  stack (all-in).
- Betting round closes when all non-folded players have matched the current bet
  or are all-in.
- **Showdown:** evaluate best 5-of-7 for each remaining player; highest wins.
  Exact ties **chop** the pot evenly; the odd chip goes to the first player left
  of the button.

## Testing
- `handEvaluator` and the betting engine are pure logic → built **test-first**:
  every hand ranking, tie/chop cases, and raise/legal-action validation.
- Add a real test runner (replace the placeholder `npm test`).
- Full hand flow is verified by running the server and driving multiple browser
  tabs.

## Workflow constraint
- **Commit to git in reasonable, logical chunks** as work lands (e.g. "hand
  evaluator + tests", "betting engine", "DOM table rendering"), not one large
  commit at the end. Each chunk is verified before committing.

## Follow-ups (not this build)
- Run `/init` to generate CLAUDE.md *after* this build lands, when there is real
  structure to document.
- Target C: dealer rotation, persistent stacks, side pots, busting out, timers.
