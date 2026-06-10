const test = require('node:test')
const assert = require('node:assert')
const { buildPots } = require('../game/sidePots')

test('equal contributions form a single main pot', () => {
  const pots = buildPots([
    { id: 'a', committed: 200, folded: false },
    { id: 'b', committed: 200, folded: false },
    { id: 'c', committed: 200, folded: false },
  ])
  assert.strictEqual(pots.length, 1)
  assert.strictEqual(pots[0].amount, 600)
  assert.deepStrictEqual(pots[0].eligibleIds.sort(), ['a', 'b', 'c'])
})

test('one short all-in creates a main pot and one side pot', () => {
  // a,b have 1500 in; c is all-in for 500
  const pots = buildPots([
    { id: 'a', committed: 1500, folded: false },
    { id: 'b', committed: 1500, folded: false },
    { id: 'c', committed: 500, folded: false },
  ])
  assert.strictEqual(pots.length, 2)
  // main: 500 from each of 3 = 1500, all eligible
  assert.strictEqual(pots[0].amount, 1500)
  assert.deepStrictEqual(pots[0].eligibleIds.sort(), ['a', 'b', 'c'])
  // side: 1000 from each of a,b = 2000, only a,b eligible
  assert.strictEqual(pots[1].amount, 2000)
  assert.deepStrictEqual(pots[1].eligibleIds.sort(), ['a', 'b'])
})

test('two all-ins create two side pots with shrinking eligibility', () => {
  const pots = buildPots([
    { id: 'a', committed: 1500, folded: false },
    { id: 'b', committed: 900, folded: false },
    { id: 'c', committed: 400, folded: false },
  ])
  assert.strictEqual(pots.length, 3)
  assert.strictEqual(pots[0].amount, 1200) // 400 * 3
  assert.deepStrictEqual(pots[0].eligibleIds.sort(), ['a', 'b', 'c'])
  assert.strictEqual(pots[1].amount, 1000) // (900-400) * 2
  assert.deepStrictEqual(pots[1].eligibleIds.sort(), ['a', 'b'])
  assert.strictEqual(pots[2].amount, 600)  // (1500-900) * 1
  assert.deepStrictEqual(pots[2].eligibleIds.sort(), ['a'])
})

test('a folded contributor adds chips but is never eligible', () => {
  // b folded after committing 1500
  const pots = buildPots([
    { id: 'a', committed: 1500, folded: false },
    { id: 'b', committed: 1500, folded: true },
    { id: 'c', committed: 500, folded: false },
  ])
  // main: 1500, eligible a,c (not b); side: 2000, eligible a only
  assert.strictEqual(pots[0].amount, 1500)
  assert.deepStrictEqual(pots[0].eligibleIds.sort(), ['a', 'c'])
  assert.strictEqual(pots[1].amount, 2000)
  assert.deepStrictEqual(pots[1].eligibleIds.sort(), ['a'])
})

test('a lone top-tier contributor (uncalled bet) gets its own pot', () => {
  const pots = buildPots([
    { id: 'a', committed: 1500, folded: false },
    { id: 'c', committed: 500, folded: false },
  ])
  assert.strictEqual(pots.length, 2)
  assert.strictEqual(pots[0].amount, 1000)            // 500 * 2
  assert.deepStrictEqual(pots[0].eligibleIds.sort(), ['a', 'c'])
  assert.strictEqual(pots[1].amount, 1000)            // (1500-500) * 1
  assert.deepStrictEqual(pots[1].eligibleIds, ['a'])  // a wins it back
})

test('a tier whose only contributors folded has empty eligibility', () => {
  // a folded with the strict-highest contribution (constructed input)
  const pots = buildPots([
    { id: 'a', committed: 100, folded: true },
    { id: 'b', committed: 50, folded: false },
  ])
  assert.strictEqual(pots[0].amount, 100)             // 50 * 2
  assert.deepStrictEqual(pots[0].eligibleIds, ['b'])
  assert.strictEqual(pots[1].amount, 50)              // (100-50) * 1
  assert.deepStrictEqual(pots[1].eligibleIds, [])     // a folded -> nobody eligible
})

test('contributors of 0 are ignored', () => {
  const pots = buildPots([
    { id: 'a', committed: 100, folded: false },
    { id: 'b', committed: 0, folded: false },
  ])
  assert.strictEqual(pots.length, 1)
  assert.strictEqual(pots[0].amount, 100)
  assert.deepStrictEqual(pots[0].eligibleIds, ['a'])
})
