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

// Returns >0 if a beats b, <0 if b beats a, 0 if tied.
function compareScores(a, b) {
  if (a.category !== b.category) return a.category - b.category
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length)
  for (let i = 0; i < len; i++) {
    const diff = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function* combinations(arr, k) {
  const n = arr.length
  const idx = Array.from({ length: k }, (_, i) => i)
  while (true) {
    yield idx.map(i => arr[i])
    let i = k - 1
    while (i >= 0 && idx[i] === i + n - k) i--
    if (i < 0) return
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

// Best 5-card hand from 5,6, or 7 cards. Returns { category, tiebreakers, name }.
function evaluateBest(cards) {
  let best = null
  for (const combo of combinations(cards, 5)) {
    const s = score5(combo)
    if (!best || compareScores(s, best) > 0) best = s
  }
  return { ...best, name: CATEGORY_NAMES[best.category] }
}

module.exports = { CATEGORY, CATEGORY_NAMES, score5, compareScores, evaluateBest }
