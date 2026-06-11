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

test('startGame needs at least 2 players', () => {
  const t = new PokerTable()
  t.sit('a', 'Alice')
  assert.throws(() => t.startGame(), /at least 2/)
})

test('startGame posts blinds, deals 2 hole cards, sets preflop', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20, startingStack: 1500 })
  t.sit('a', 'Alice') // seat 0
  t.sit('b', 'Bob')   // seat 1
  t.sit('c', 'Carol') // seat 2
  t.startGame(new Deck().shuffle(() => 0)) // deterministic shuffle

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
  t.startGame(new Deck().shuffle(() => 0))
  assert.strictEqual(t.buttonSeat, 0)
  assert.strictEqual(t.seats[0].bet, 10) // button = SB heads-up
  assert.strictEqual(t.seats[1].bet, 20) // BB
  assert.strictEqual(t.toActSeat, 0)     // button acts first preflop heads-up
})

test('legalActions for UTG facing the big blind', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startGame(new Deck().shuffle(() => 0))
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
  t.startGame(new Deck().shuffle(() => 0))
  assert.strictEqual(t.legalActions('b'), null) // seat 1 is not to act
})

test('everyone folds to one player -> immediate win, pot awarded', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startGame(new Deck().shuffle(() => 0))
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
  t.startGame(new Deck().shuffle(() => 0))
  assert.throws(() => t.applyAction('a', { type: 'check' }), /check/i)
  assert.throws(() => t.applyAction('a', { type: 'raise', amount: 30 }), /minimum/i)
})

test('calling around preflop closes the round and deals the flop', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startGame(new Deck().shuffle(() => 0))
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
  t.startGame(new Deck([...top, ...rest]))
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
  t.startGame(new Deck([...top, ...rest]))
  t.applyAction('a', { type: 'call' }); t.applyAction('b', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  assert.strictEqual(t.winners.length, 2)
  assert.strictEqual(t.seats[0].stack, 1500) // each got their 20 back
  assert.strictEqual(t.seats[1].stack, 1500)
})

test('getStateFor hides opponent hole cards before showdown', () => {
  const t = new PokerTable()
  t.sit('a', 'Alice'); t.sit('b', 'Bob'); t.sit('c', 'Carol')
  t.startGame(new Deck().shuffle(() => 0))
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
  t.startGame(new Deck().shuffle(() => 0))
  t.applyAction('a', { type: 'call' }); t.applyAction('b', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  t.applyAction('b', { type: 'check' }); t.applyAction('a', { type: 'check' })
  const view = t.getStateFor('a')
  const other = view.seats.find(s => s && !s.isSelf)
  assert.ok(Array.isArray(other.holeCards) && other.holeCards.length === 2)
})

// ---- BUG 1: leave() during a live hand ----

test('leave while waiting frees the seat', () => {
  const t = new PokerTable()
  t.sit('a', 'Alice') // seat 0
  t.sit('b', 'Bob')   // seat 1
  // no hand started — phase is 'waiting'
  t.leave('a')
  assert.strictEqual(t.seats[0], null)
  // a new player can take the freed seat
  const newSeat = t.sit('z', 'Zara')
  assert.strictEqual(newSeat, 0)
})

test('leaver was to act (3-handed) — hand does NOT freeze', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice') // seat 0 — button, UTG (toActSeat preflop)
  t.sit('b', 'Bob')   // seat 1 — SB
  t.sit('c', 'Carol') // seat 2 — BB
  t.startGame(new Deck().shuffle(() => 0))
  // seat 0 (UTG) is toActSeat
  assert.strictEqual(t.toActSeat, 0)
  t.leave('a') // UTG leaves while it is their turn
  // toActSeat must point at a live, non-null, non-folded seat
  assert.ok(t.toActSeat !== -1, 'toActSeat must be valid')
  assert.ok(t.seats[t.toActSeat] !== null, 'toActSeat seat must not be null')
  assert.ok(!t.seats[t.toActSeat].folded, 'toActSeat player must not be folded')
  // the remaining player must be able to act without throwing
  const actingId = t.seats[t.toActSeat].id
  assert.doesNotThrow(() => t.applyAction(actingId, { type: 'fold' }))
})

test('chip conservation: leaver chips stay in the pot', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice') // seat 0 — button
  t.sit('b', 'Bob')   // seat 1 — SB
  t.sit('c', 'Carol') // seat 2 — BB
  t.startGame(new Deck().shuffle(() => 0))
  // Bob (SB) has bet 10, Carol (BB) has bet 20; pot (via getStateFor) = 30
  const potBefore = t.getStateFor('c').pot
  assert.strictEqual(potBefore, 30)
  // SB (Bob) leaves mid-hand
  t.leave('b')
  // Bob's 10 posted chips must still be in the effective pot
  const potAfter = t.getStateFor('c').pot
  assert.strictEqual(potAfter, 30)
})

test('heads-up: opponent leaves mid-hand → remaining player wins', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice') // seat 0 — button / SB heads-up
  t.sit('b', 'Bob')   // seat 1 — BB
  t.startGame(new Deck().shuffle(() => 0))
  const aliceStackBefore = t.seats[0].stack // 1490 (posted 10)
  // Bob leaves while the hand is live
  t.leave('b')
  assert.strictEqual(t.phase, 'payout')
  assert.deepStrictEqual(t.winners.map(w => w.id), ['a'])
  // Alice should have gotten the pot (10 + 20 = 30) added to her remaining stack
  assert.strictEqual(t.seats[0].stack, aliceStackBefore + 30)
})

test('removed player is not dealt into the next hand', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'Alice') // seat 0
  t.sit('b', 'Bob')   // seat 1
  t.sit('c', 'Carol') // seat 2
  t.startGame(new Deck().shuffle(() => 0))
  // Carol (BB, seat 2) leaves mid-hand
  t.leave('c')
  // Force the hand to end: the remaining two fold/act until hand concludes
  // After Carol (BB) leaves, action should continue; UTG (seat0) acts
  // Let whoever is toActSeat fold until payout
  while (t.phase !== 'payout') {
    const seat = t.toActSeat
    if (seat === -1) break
    const id = t.seats[seat].id
    t.applyAction(id, { type: 'fold' })
  }
  // Start a new hand — Carol should not be seated
  assert.strictEqual(t.findSeatById('c'), -1)
  t.dealHand(new Deck().shuffle(() => 0))
  // Only Alice and Bob should have hole cards; Carol's seat is null
  assert.strictEqual(t.seats[2], null)
  const occ = t.occupiedSeats()
  assert.strictEqual(occ.length, 2)
  for (const i of occ) {
    assert.strictEqual(t.seats[i].holeCards.length, 2)
  }
})

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
  t.startGame(new Deck([...top, ...rest]))

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
  t.startGame(new Deck().shuffle(() => 0.5))
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

test('leaving between hands until one remains ends the game', () => {
  const t = new PokerTable({ smallBlind: 10, bigBlind: 20 })
  t.sit('a', 'A'); t.sit('b', 'B'); t.sit('c', 'C')
  t.startGame(new Deck().shuffle(() => 0))
  // finish hand 1: fold around to the big blind
  t.applyAction(t.seats[t.toActSeat].id, { type: 'fold' })
  t.applyAction(t.seats[t.toActSeat].id, { type: 'fold' })
  assert.strictEqual(t.phase, 'payout')
  assert.strictEqual(t.gamePhase, 'playing')
  t.leave('b')                              // 2 active remain (a, c)
  assert.strictEqual(t.gamePhase, 'playing')
  t.leave('c')                              // only one active player left
  assert.strictEqual(t.gamePhase, 'over')
  const winner = t.seats.find(s => s && s.finishPlace === 1)
  assert.ok(winner, 'a winner should be declared')
})
