// Pure side-pot construction. No engine dependencies.
//
// contributors: [{ id, committed, folded }] — everyone who put chips in this
//   hand. Folded players are included (their chips are in the pots) but are
//   never eligible to win.
// Returns ordered pots [{ amount, eligibleIds }], main pot first.
function buildPots(contributors) {
  const live = contributors.filter(c => c.committed > 0)
  if (live.length === 0) return []

  // distinct contribution levels, ascending — each is a pot boundary
  const levels = [...new Set(live.map(c => c.committed))].sort((a, b) => a - b)

  const pots = []
  let prev = 0
  for (const level of levels) {
    const layer = level - prev
    const atOrAbove = live.filter(c => c.committed >= level)
    pots.push({
      amount: layer * atOrAbove.length,
      eligibleIds: atOrAbove.filter(c => !c.folded).map(c => c.id),
    })
    prev = level
  }

  // merge adjacent pots that share the exact same eligibility
  const merged = []
  for (const pot of pots) {
    const last = merged[merged.length - 1]
    if (last && sameIds(last.eligibleIds, pot.eligibleIds)) {
      last.amount += pot.amount
    } else {
      merged.push({ amount: pot.amount, eligibleIds: [...pot.eligibleIds] })
    }
  }
  return merged
}

function sameIds(a, b) {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every(id => setB.has(id))
}

module.exports = { buildPots }
