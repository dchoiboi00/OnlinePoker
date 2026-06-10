const { Deck } = require('./cards')
const { evaluateBest, compareScores } = require('./handEvaluator')

const NUM_SEATS = 7

function newPlayer(id, username, stack) {
  return {
    id, username, stack,
    holeCards: [], bet: 0, committed: 0,
    folded: false, allIn: false, hasActed: false,
  }
}

class PokerTable {
  constructor({ smallBlind = 10, bigBlind = 20, startingStack = 1500 } = {}) {
    this.seats = Array(NUM_SEATS).fill(null)
    this.smallBlind = smallBlind
    this.bigBlind = bigBlind
    this.startingStack = startingStack
    this.phase = 'waiting'          // waiting|preflop|flop|turn|river|payout
    this.board = []
    this.pot = 0
    this.currentBet = 0
    this.minRaise = bigBlind
    this.buttonSeat = -1
    this.toActSeat = -1
    this.deck = null
    this.reveal = false             // true when the hand ended at showdown
    this.winners = []               // [{ id, username }]
  }

  // ---- seating ----
  sit(id, username) {
    const existing = this.findSeatById(id)
    if (existing !== -1) return existing
    const seat = this.seats.findIndex(s => s === null)
    if (seat === -1) return -1
    this.seats[seat] = newPlayer(id, username, this.startingStack)
    return seat
  }

  leave(id) {
    const seat = this.findSeatById(id)
    if (seat !== -1) this.seats[seat] = null
  }

  findSeatById(id) { return this.seats.findIndex(s => s && s.id === id) }
  occupiedSeats() { return this.seats.map((s, i) => (s ? i : -1)).filter(i => i >= 0) }

  // Occupied seats clockwise, starting just AFTER `seat` (exclusive).
  seatsClockwiseFrom(seat) {
    const out = []
    for (let k = 1; k <= NUM_SEATS; k++) {
      const i = (seat + k) % NUM_SEATS
      if (this.seats[i]) out.push(i)
    }
    return out
  }

  // ---- start a hand ----
  startHand(deck) {
    const occ = this.occupiedSeats()
    if (occ.length < 2) throw new Error('Need at least 2 players')

    for (const i of occ) {
      Object.assign(this.seats[i], {
        stack: this.startingStack, holeCards: [], bet: 0, committed: 0,
        folded: false, allIn: false, hasActed: false,
      })
    }
    this.board = []
    this.pot = 0
    this.winners = []
    this.reveal = false
    this.deck = deck || new Deck().shuffle()

    // advance / set the button
    this.buttonSeat = this.buttonSeat === -1
      ? occ[0]
      : this.seatsClockwiseFrom(this.buttonSeat)[0]

    const after = this.seatsClockwiseFrom(this.buttonSeat)
    let sbSeat, bbSeat, firstToAct
    if (occ.length === 2) {
      sbSeat = this.buttonSeat
      bbSeat = after[0]
      firstToAct = this.buttonSeat                    // button acts first preflop
    } else {
      sbSeat = after[0]
      bbSeat = after[1]
      firstToAct = this.seatsClockwiseFrom(bbSeat)[0] // UTG
    }

    this.postBlind(sbSeat, this.smallBlind)
    this.postBlind(bbSeat, this.bigBlind)
    this.currentBet = this.bigBlind
    this.minRaise = this.bigBlind

    // deal two rounds, starting left of the button
    for (let round = 0; round < 2; round++) {
      for (const i of this.seatsClockwiseFrom(this.buttonSeat)) {
        this.seats[i].holeCards.push(this.deck.draw(1)[0])
      }
    }

    this.phase = 'preflop'
    this.toActSeat = firstToAct
  }

  postBlind(seat, amount) {
    const p = this.seats[seat]
    const post = Math.min(amount, p.stack)
    p.stack -= post
    p.bet += post
    p.committed += post
    if (p.stack === 0) p.allIn = true
  }

  legalActions(id) {
    const seat = this.findSeatById(id)
    if (seat === -1 || seat !== this.toActSeat || this.phase === 'waiting' || this.phase === 'payout') {
      return null
    }
    const p = this.seats[seat]
    const toCall = this.currentBet - p.bet
    const maxRaiseTo = p.bet + p.stack            // total if all-in
    const minRaiseTo = Math.min(this.currentBet + this.minRaise, maxRaiseTo)
    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0 && p.stack > 0,
      callAmount: Math.min(toCall, p.stack),
      canRaise: p.stack > toCall,                 // must have more than a call
      minRaiseTo,
      maxRaiseTo,
    }
  }

  commit(p, amount) {
    const amt = Math.min(amount, p.stack)
    p.stack -= amt
    p.bet += amt
    p.committed += amt
    if (p.stack === 0) p.allIn = true
  }

  applyAction(id, action) {
    const seat = this.findSeatById(id)
    if (seat !== this.toActSeat) throw new Error('Not your turn')
    const p = this.seats[seat]
    const toCall = this.currentBet - p.bet

    switch (action.type) {
      case 'fold':
        p.folded = true
        break
      case 'check':
        if (toCall !== 0) throw new Error('Cannot check facing a bet')
        break
      case 'call':
        this.commit(p, Math.min(toCall, p.stack))
        break
      case 'bet':
      case 'raise': {
        const target = action.amount
        const maxTo = p.bet + p.stack
        if (typeof target !== 'number') throw new Error('Raise needs an amount')
        if (target > maxTo) throw new Error('Raise exceeds stack')
        if (target <= this.currentBet) throw new Error('Raise must exceed the current bet')
        const isAllIn = target === maxTo
        const minTo = this.currentBet + this.minRaise
        if (!isAllIn && target < minTo) throw new Error('Raise below the minimum')
        const raiseSize = target - this.currentBet
        this.commit(p, target - p.bet)
        this.minRaise = Math.max(this.minRaise, raiseSize)
        this.currentBet = target
        // a raise reopens action for everyone still live
        for (const i of this.occupiedSeats()) {
          const q = this.seats[i]
          if (i !== seat && !q.folded && !q.allIn) q.hasActed = false
        }
        break
      }
      default:
        throw new Error('Unknown action: ' + action.type)
    }

    p.hasActed = true
    this.advance()
  }

  advance() {
    const live = this.occupiedSeats().filter(i => !this.seats[i].folded)
    if (live.length === 1) {
      this.awardToLastPlayer(live[0])
      return
    }
    if (this.bettingRoundComplete()) {
      this.nextStreet()
      return
    }
    this.toActSeat = this.nextToAct(this.toActSeat)
  }

  bettingRoundComplete() {
    const live = this.occupiedSeats().map(i => this.seats[i]).filter(p => !p.folded)
    const actionable = live.filter(p => !p.allIn)
    return actionable.every(p => p.hasActed && p.bet === this.currentBet)
  }

  nextToAct(fromSeat) {
    for (const i of this.seatsClockwiseFrom(fromSeat)) {
      const p = this.seats[i]
      if (!p.folded && !p.allIn) return i
    }
    return -1
  }

  // --- replaced in Task 7 ---
  nextStreet() {
    for (const i of this.occupiedSeats()) {
      this.pot += this.seats[i].bet
      this.seats[i].bet = 0
      this.seats[i].hasActed = false
    }
    this.currentBet = 0
    this.minRaise = this.bigBlind
    const order = ['preflop', 'flop', 'turn', 'river', 'showdown']
    const next = order[order.indexOf(this.phase) + 1]
    this.phase = next
    if (next === 'flop') this.board.push(...this.deck.draw(3))
    else if (next === 'turn' || next === 'river') this.board.push(...this.deck.draw(1))
    if (next !== 'showdown') this.toActSeat = this.nextToAct(this.buttonSeat)
  }

  awardToLastPlayer(seat) {
    for (const i of this.occupiedSeats()) { this.pot += this.seats[i].bet; this.seats[i].bet = 0 }
    const w = this.seats[seat]
    w.stack += this.pot
    this.winners = [{ id: w.id, username: w.username }]
    this.pot = 0
    this.phase = 'payout'
  }
}

module.exports = { PokerTable, NUM_SEATS }
