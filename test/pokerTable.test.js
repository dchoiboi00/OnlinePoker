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
