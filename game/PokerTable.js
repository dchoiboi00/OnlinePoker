const { Deck } = require('./cards')
const { evaluateBest, compareScores } = require('./handEvaluator')
const { buildPots } = require('./sidePots')

const NUM_SEATS = 7

function newPlayer(id, username, stack) {
  return {
    id, username, stack,
    holeCards: [], bet: 0, committed: 0,
    folded: false, allIn: false, hasActed: false,
    eliminated: false, finishPlace: null, waiting: false,
  }
}

class PokerTable {
  constructor({ smallBlind = 10, bigBlind = 20, startingStack = 1500 } = {}) {
    this.seats = Array(NUM_SEATS).fill(null)
    this.smallBlind = smallBlind
    this.bigBlind = bigBlind
    this.startingStack = startingStack
    this.phase = 'waiting'          // waiting|preflop|flop|turn|river|payout
    this.gamePhase = 'lobby'         // lobby|playing|over
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
    const p = newPlayer(id, username, this.startingStack)
    if (this.gamePhase !== 'lobby') p.waiting = true   // joins the next game
    this.seats[seat] = p
    return seat
  }

  leave(id) {
    const seat = this.findSeatById(id)
    if (seat === -1) return  // player not seated, nothing to do

    const handLive = this.phase !== 'waiting' && this.phase !== 'payout'

    if (!handLive) {
      // No active hand — just free the seat.
      this.seats[seat] = null
      // if a game is in progress and only one active player remains, end it
      if (this.gamePhase === 'playing') {
        const active = this.activeSeats()
        if (active.length === 1) {
          this.seats[active[0]].finishPlace = 1
          this.gamePhase = 'over'
        }
      }
      return
    }

    // Hand is live: sweep the leaver's current street bet into the pot so chips
    // are never lost, then remove them from the seat.
    const p = this.seats[seat]
    this.pot += p.bet
    p.bet = 0
    this.seats[seat] = null

    // Check how many occupied (and non-folded) seats remain.
    const occupied = this.occupiedSeats()
    const contenders = occupied.filter(i => !this.seats[i].folded)

    if (occupied.length === 0) {
      // Everyone left — nothing left to do.
      this.phase = 'payout'
      return
    }

    if (contenders.length === 1) {
      // Only one non-folded player remains — they win.
      this.awardToLastPlayer(contenders[0])
      return
    }

    // More than one contender remains.  Fix up toActSeat if necessary, then
    // check whether the betting round is now complete.
    if (this.toActSeat === seat) {
      // It was the leaver's turn — move action to the next live seat.
      const next = this.nextToAct(seat)
      this.toActSeat = next
    }

    // Whether or not it was their turn, leaving may have completed the round.
    if (this.bettingRoundComplete()) {
      this.nextStreet()
    }
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

  // Seated and able to play this game (not eliminated, not waiting to join).
  activeSeats() {
    return this.occupiedSeats().filter(i => {
      const p = this.seats[i]
      return !p.eliminated && !p.waiting
    })
  }

  // Active seats clockwise, starting just AFTER `seat` (exclusive).
  activeSeatsFrom(seat) {
    return this.seatsClockwiseFrom(seat).filter(i => {
      const p = this.seats[i]
      return !p.eliminated && !p.waiting
    })
  }

  // ---- start a tournament (assign stacks once) ----
  startGame(deck) {
    if (this.gamePhase !== 'lobby') throw new Error('Game already in progress')
    const seated = this.occupiedSeats()
    if (seated.length < 2) throw new Error('Need at least 2 players')
    for (const i of seated) {
      Object.assign(this.seats[i], {
        stack: this.startingStack, eliminated: false, finishPlace: null, waiting: false,
      })
    }
    this.gamePhase = 'playing'
    this.buttonSeat = this.activeSeats()[0]
    this._setupHand(deck)
  }

  // ---- deal the next hand of an in-progress game (stacks carry over) ----
  dealHand(deck) {
    if (this.gamePhase !== 'playing') throw new Error('No game in progress')
    if (this.phase !== 'payout') throw new Error('Hand still in progress')
    if (this.activeSeats().length < 2) throw new Error('Need at least 2 players')
    this.buttonSeat = this.activeSeatsFrom(this.buttonSeat)[0]
    this._setupHand(deck)
  }

  // shared per-hand setup: reset per-hand state, post blinds, deal, set first to act
  _setupHand(deck) {
    for (const i of this.occupiedSeats()) {
      const p = this.seats[i]
      const inactive = p.eliminated || p.waiting
      Object.assign(p, {
        holeCards: [], bet: 0, committed: 0,
        folded: inactive, allIn: false, hasActed: false,
      })
    }
    this.board = []
    this.pot = 0
    this.winners = []
    this.reveal = false
    this.deck = deck || new Deck().shuffle()

    const active = this.activeSeats()
    const after = this.activeSeatsFrom(this.buttonSeat)
    let sbSeat, bbSeat, firstToAct
    if (active.length === 2) {
      sbSeat = this.buttonSeat
      bbSeat = after[0]
      firstToAct = this.buttonSeat
    } else {
      sbSeat = after[0]
      bbSeat = after[1]
      firstToAct = this.activeSeatsFrom(bbSeat)[0]
    }

    this.postBlind(sbSeat, this.smallBlind)
    this.postBlind(bbSeat, this.bigBlind)
    this.currentBet = this.bigBlind
    this.minRaise = this.bigBlind

    for (let round = 0; round < 2; round++) {
      for (const i of this.activeSeatsFrom(this.buttonSeat)) {
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
        this.currentBet = target
        // A sub-minimum all-in (raiseSize < minRaise) does NOT re-open betting
        // for players who already acted — this matters for unequal-stack play
        // (Target C).  Only a full raise resets hasActed and bumps minRaise.
        if (raiseSize >= this.minRaise) {
          this.minRaise = Math.max(this.minRaise, raiseSize)
          for (const i of this.occupiedSeats()) {
            const q = this.seats[i]
            if (i !== seat && !q.folded && !q.allIn) q.hasActed = false
          }
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

  nextStreet() {
    // sweep street bets into the pot
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

    if (next === 'showdown') { this.showdown(); return }

    // if at most one player can still act (rest all-in), deal out the rest
    const actionable = this.occupiedSeats()
      .map(i => this.seats[i])
      .filter(p => !p.folded && !p.allIn)
    if (actionable.length <= 1) { this.nextStreet(); return }

    this.toActSeat = this.nextToAct(this.buttonSeat)
  }

  showdown() {
    this.phase = 'showdown'
    this.reveal = true
    // score each non-folded player's best hand once
    const scoreById = new Map()
    for (const i of this.occupiedSeats()) {
      const p = this.seats[i]
      if (!p.folded) scoreById.set(p.id, evaluateBest([...p.holeCards, ...this.board]))
    }
    this.settlePots(scoreById)
  }

  awardToLastPlayer(seat) {
    // everyone else folded or left — the lone contender takes the whole pot,
    // including any dead money. No side pots are possible with one contender.
    for (const i of this.occupiedSeats()) { this.pot += this.seats[i].bet; this.seats[i].bet = 0 }
    this.reveal = false
    const w = this.seats[seat]
    w.stack += this.pot
    this.winners = [{ id: w.id, username: w.username }]
    this.pot = 0
    this.phase = 'payout'
    this._finishHand()
  }

  settlePots(scoreById) {
    // contributions from players still seated (folded players included)
    const contributors = this.occupiedSeats()
      .map(i => this.seats[i])
      .filter(p => p.committed > 0)
      .map(p => ({ id: p.id, committed: p.committed, folded: p.folded }))
    const pots = buildPots(contributors)

    // chips from players who left mid-hand are in this.pot but not in any
    // seated player's committed total — fold them into the main pot
    const seatedTotal = contributors.reduce((sum, c) => sum + c.committed, 0)
    const deadMoney = this.pot - seatedTotal
    if (deadMoney > 0) {
      if (pots.length === 0) {
        const stillIn = this.occupiedSeats()
          .map(i => this.seats[i]).filter(p => !p.folded).map(p => p.id)
        pots.push({ amount: deadMoney, eligibleIds: stillIn })
      } else {
        pots[0].amount += deadMoney
      }
    }

    const winnerIds = new Set()
    // award top tier downward; an empty (no eligible winner) tier rolls its
    // chips down onto the next lower tier that does have winners
    let rollDown = 0
    for (let k = pots.length - 1; k >= 0; k--) {
      const amount = pots[k].amount + rollDown
      const eligible = pots[k].eligibleIds
      if (eligible.length === 0) { rollDown = amount; continue }
      rollDown = 0

      let recipients
      if (eligible.length === 1) {
        recipients = eligible
      } else {
        let best = null
        for (const id of eligible) {
          const s = scoreById.get(id)
          if (!best || compareScores(s, best) > 0) best = s
        }
        recipients = eligible.filter(id => compareScores(scoreById.get(id), best) === 0)
      }
      this.awardChips(amount, recipients)
      recipients.forEach(id => winnerIds.add(id))
    }

    this.winners = [...winnerIds].map(id => {
      const p = this.seats[this.findSeatById(id)]
      return { id: p.id, username: p.username }
    })
    this.pot = 0
    this.phase = 'payout'
    this._finishHand()
  }

  // Split `amount` among recipient ids, odd chip to the first eligible seat
  // left of the button.
  awardChips(amount, recipientIds) {
    const ids = new Set(recipientIds)
    const ordered = this.seatsClockwiseFrom(this.buttonSeat)
      .map(i => this.seats[i])
      .filter(p => ids.has(p.id))
    const share = Math.floor(amount / ordered.length)
    let remainder = amount - share * ordered.length
    for (const w of ordered) {
      w.stack += share
      if (remainder > 0) { w.stack += 1; remainder-- }
    }
  }

  // After a hand settles: eliminate broke players (with finishing places) and
  // end the game if one player remains.
  _finishHand() {
    if (this.gamePhase !== 'playing') return
    const wasActive = p => !p.eliminated && !p.waiting
    const busted = this.occupiedSeats().map(i => this.seats[i])
      .filter(p => wasActive(p) && p.stack === 0)
    const survivors = this.occupiedSeats().map(i => this.seats[i])
      .filter(p => wasActive(p) && p.stack > 0)

    // bigger pre-hand stack (== committed for an all-in bust) finishes higher
    busted.sort((a, b) => b.committed - a.committed)
    let place = survivors.length + 1
    for (const p of busted) {
      p.eliminated = true
      p.finishPlace = place
      place++
    }

    if (survivors.length === 1) {
      survivors[0].finishPlace = 1
      this.gamePhase = 'over'
    }
  }

  // From 'over': reset everyone and return to the lobby for a new game.
  newGame() {
    if (this.gamePhase !== 'over') throw new Error('Game is not over')
    this.gamePhase = 'lobby'
    this.phase = 'waiting'
    for (const i of this.occupiedSeats()) {
      Object.assign(this.seats[i], {
        stack: this.startingStack, holeCards: [], bet: 0, committed: 0,
        folded: false, allIn: false, hasActed: false,
        eliminated: false, finishPlace: null, waiting: false,
      })
    }
    this.board = []
    this.pot = 0
    this.winners = []
    this.reveal = false
    this.buttonSeat = -1
    this.toActSeat = -1
  }

  // Live pot breakdown for display, labelled Main / Side / Side 2 ...
  // Normally a single pot; only split into side pots once a player is all-in
  // (otherwise unequal blinds/partial bets would show spurious side pots).
  _displayPots() {
    const liveBets = this.occupiedSeats().reduce((s, i) => s + this.seats[i].bet, 0)
    const total = this.pot + liveBets
    if (total === 0) return []
    const anyAllIn = this.occupiedSeats().some(i => {
      const p = this.seats[i]
      return p.allIn && !p.eliminated
    })
    if (!anyAllIn) return [{ amount: total, label: 'Main' }]
    const contributors = this.occupiedSeats()
      .map(i => this.seats[i])
      .filter(p => p.committed > 0)
      .map(p => ({ id: p.id, committed: p.committed, folded: p.folded }))
    const pots = buildPots(contributors)
    return pots.map((pot, k) => ({
      amount: pot.amount,
      label: k === 0 ? 'Main' : (pots.length === 2 ? 'Side' : `Side ${k}`),
    }))
  }

  getStateFor(id) {
    const liveBets = this.occupiedSeats().reduce((sum, i) => sum + this.seats[i].bet, 0)
    return {
      gamePhase: this.gamePhase,
      phase: this.phase,
      board: this.board,
      pot: this.pot + liveBets,
      pots: this._displayPots(),
      currentBet: this.currentBet,
      buttonSeat: this.buttonSeat,
      toActSeat: this.toActSeat,
      winners: this.winners,
      numSeats: NUM_SEATS,
      seats: this.seats.map((p, idx) => {
        if (!p) return null
        const isSelf = p.id === id
        const revealOpponent = this.reveal && !p.folded
        let holeCards
        if (p.holeCards.length === 0) holeCards = []
        else if (isSelf || revealOpponent) holeCards = p.holeCards
        else holeCards = 'hidden'
        return {
          seat: idx,
          username: p.username,
          stack: p.stack,
          bet: p.bet,
          folded: p.folded,
          allIn: p.allIn,
          eliminated: p.eliminated,
          finishPlace: p.finishPlace,
          waiting: p.waiting,
          isSelf,
          holeCards,
        }
      }),
      legalActions: this.legalActions(id),
    }
  }
}

module.exports = { PokerTable, NUM_SEATS }
