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
