const SUIT_SYMBOL = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }
const SUIT_RED = { Hearts: true, Diamonds: true, Clubs: false, Spades: false }
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

function rankLabel(r) { return RANK_LABEL[r] || String(r) }

function cardEl(card) {
  const el = document.createElement('div')
  if (card === 'back') { el.className = 'card back'; return el }
  el.className = 'card' + (SUIT_RED[card.suit] ? ' red' : '')
  el.textContent = rankLabel(card.rank) + SUIT_SYMBOL[card.suit]
  return el
}

// Position seat `idx` around the table, rotated so the viewer (selfSeat)
// sits at the bottom-center.
function seatPosition(idx, selfSeat, numSeats) {
  const rel = ((idx - selfSeat) % numSeats + numSeats) % numSeats
  const angle = Math.PI / 2 + (2 * Math.PI * rel) / numSeats // self at bottom
  // ry kept tight so the bottom (self) seat clears the action bar at the very bottom
  const cx = 50, cy = 47, rx = 40, ry = 36 // percentages
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }
}

function renderTable(state) {
  const selfSeatObj = state.seats.find(s => s && s.isSelf)
  const selfSeat = selfSeatObj ? selfSeatObj.seat : 0

  // community
  const community = document.getElementById('community')
  community.replaceChildren(...state.board.map(c => cardEl(c)))

  // pot + result
  document.getElementById('pot').textContent = state.pot ? `POT $${state.pot}` : ''
  const result = document.getElementById('result')
  if (state.phase === 'payout' && state.winners.length) {
    const names = state.winners.map(w => w.username).join(' & ')
    result.textContent = `${names} win${state.winners.length > 1 ? '' : 's'} the pot`
  } else {
    result.textContent = ''
  }

  // seats
  const seatsRoot = document.getElementById('seats')
  seatsRoot.replaceChildren()
  for (const seat of state.seats) {
    if (!seat) continue
    const { x, y } = seatPosition(seat.seat, selfSeat, state.numSeats)
    const el = document.createElement('div')
    el.className = 'seat'
      + (seat.seat === state.toActSeat ? ' active' : '')
      + (seat.folded ? ' folded' : '')
    el.style.setProperty('--x', x + '%')
    el.style.setProperty('--y', y + '%')

    const hole = document.createElement('div')
    hole.className = 'hole'
    if (seat.holeCards === 'hidden') hole.append(cardEl('back'), cardEl('back'))
    else hole.append(...seat.holeCards.map(c => cardEl(c)))

    const nameplate = document.createElement('div')
    nameplate.className = 'nameplate'
    const dealer = seat.seat === state.buttonSeat ? ' <span class="button-chip">D</span>' : ''
    nameplate.innerHTML = `${seat.username} · $${seat.stack}${dealer}`

    const bet = document.createElement('div')
    bet.className = 'bet'
    bet.textContent = seat.bet ? `$${seat.bet}` : (seat.allIn ? 'ALL-IN' : '')

    el.append(hole, nameplate, bet)
    seatsRoot.append(el)
  }
}

window.renderTable = renderTable
