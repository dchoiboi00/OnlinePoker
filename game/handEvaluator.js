const CATEGORY = {
  HIGH_CARD: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
}
const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
]

// Scores exactly 5 cards. Returns { category, tiebreakers }.
function score5(cards) {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a)
  const suits = cards.map(c => c.suit)
  const isFlush = suits.every(s => s === suits[0])

  const counts = new Map()
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1)
  // groups: [rank, count] sorted by count desc, then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])

  // straight detection over the distinct ranks
  const uniq = [...new Set(ranks)].sort((a, b) => b - a)
  let straightHigh = null
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0]
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5 // wheel
  }

  if (isFlush && straightHigh) return { category: CATEGORY.STRAIGHT_FLUSH, tiebreakers: [straightHigh] }
  if (groups[0][1] === 4) return { category: CATEGORY.QUADS, tiebreakers: [groups[0][0], groups[1][0]] }
  if (groups[0][1] === 3 && groups[1][1] >= 2) return { category: CATEGORY.FULL_HOUSE, tiebreakers: [groups[0][0], groups[1][0]] }
  if (isFlush) return { category: CATEGORY.FLUSH, tiebreakers: ranks }
  if (straightHigh) return { category: CATEGORY.STRAIGHT, tiebreakers: [straightHigh] }
  if (groups[0][1] === 3) return { category: CATEGORY.TRIPS, tiebreakers: groups.map(g => g[0]) }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return { category: CATEGORY.TWO_PAIR, tiebreakers: [groups[0][0], groups[1][0], groups[2][0]] }
  }
  if (groups[0][1] === 2) return { category: CATEGORY.PAIR, tiebreakers: groups.map(g => g[0]) }
  return { category: CATEGORY.HIGH_CARD, tiebreakers: ranks }
}

module.exports = { CATEGORY, CATEGORY_NAMES, score5 }
