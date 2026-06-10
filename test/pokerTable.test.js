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
