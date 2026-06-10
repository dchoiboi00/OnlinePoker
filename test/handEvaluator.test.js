const test = require('node:test')
const assert = require('node:assert')
const { score5 } = require('../game/handEvaluator')

const H = r => ({ rank: r, suit: 'Hearts' })
const S = r => ({ rank: r, suit: 'Spades' })
const D = r => ({ rank: r, suit: 'Diamonds' })
const C = r => ({ rank: r, suit: 'Clubs' })

test('straight flush', () => {
  const s = score5([H(9), H(8), H(7), H(6), H(5)])
  assert.deepStrictEqual(s, { category: 8, tiebreakers: [9] })
})

test('wheel straight flush (A-2-3-4-5) ranks as 5-high', () => {
  const s = score5([H(14), H(2), H(3), H(4), H(5)])
  assert.deepStrictEqual(s, { category: 8, tiebreakers: [5] })
})

test('four of a kind: quad rank then kicker', () => {
  const s = score5([H(7), S(7), D(7), C(7), H(10)])
  assert.deepStrictEqual(s, { category: 7, tiebreakers: [7, 10] })
})

test('full house: trip rank then pair rank', () => {
  const s = score5([H(4), S(4), D(4), C(9), H(9)])
  assert.deepStrictEqual(s, { category: 6, tiebreakers: [4, 9] })
})

test('flush: all five ranks high-to-low', () => {
  const s = score5([H(14), H(10), H(7), H(4), H(2)])
  assert.deepStrictEqual(s, { category: 5, tiebreakers: [14, 10, 7, 4, 2] })
})

test('straight (mixed suits): high card', () => {
  const s = score5([H(10), S(9), D(8), C(7), H(6)])
  assert.deepStrictEqual(s, { category: 4, tiebreakers: [10] })
})

test('three of a kind: trip then two kickers', () => {
  const s = score5([H(5), S(5), D(5), C(13), H(2)])
  assert.deepStrictEqual(s, { category: 3, tiebreakers: [5, 13, 2] })
})

test('two pair: high pair, low pair, kicker', () => {
  const s = score5([H(9), S(9), D(4), C(4), H(13)])
  assert.deepStrictEqual(s, { category: 2, tiebreakers: [9, 4, 13] })
})

test('one pair: pair then three kickers', () => {
  const s = score5([H(8), S(8), D(14), C(6), H(3)])
  assert.deepStrictEqual(s, { category: 1, tiebreakers: [8, 14, 6, 3] })
})

test('high card: five ranks high-to-low', () => {
  const s = score5([H(14), S(11), D(9), C(6), H(3)])
  assert.deepStrictEqual(s, { category: 0, tiebreakers: [14, 11, 9, 6, 3] })
})

const { compareScores, evaluateBest } = require('../game/handEvaluator')

test('compareScores: higher category wins', () => {
  const flush = score5([H(14), H(10), H(7), H(4), H(2)])
  const straight = score5([H(10), S(9), D(8), C(7), H(6)])
  assert.ok(compareScores(flush, straight) > 0)
})

test('compareScores: same category breaks by tiebreakers', () => {
  const aceHigh = score5([H(14), S(11), D(9), C(6), H(3)])
  const kingHigh = score5([S(13), D(11), C(9), H(6), S(3)])
  assert.ok(compareScores(aceHigh, kingHigh) > 0)
})

test('compareScores: identical hands tie (0)', () => {
  const a = score5([H(9), S(9), D(4), C(4), H(13)])
  const b = score5([C(9), D(9), H(4), S(4), C(13)])
  assert.strictEqual(compareScores(a, b), 0)
})

test('evaluateBest picks the best 5 of 7 and names it', () => {
  // 2 hole + 5 board -> a flush in hearts is available
  const seven = [H(14), H(2), H(7), H(9), H(11), S(3), C(4)]
  const best = evaluateBest(seven)
  assert.strictEqual(best.category, 5) // flush
  assert.strictEqual(best.name, 'Flush')
  assert.deepStrictEqual(best.tiebreakers, [14, 11, 9, 7, 2])
})
