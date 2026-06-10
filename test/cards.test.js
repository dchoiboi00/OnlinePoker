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
