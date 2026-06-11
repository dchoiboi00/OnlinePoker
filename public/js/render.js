const SUIT_SYMBOL = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' }
const SUIT_RED = { Hearts: true, Diamonds: true, Clubs: false, Spades: false }
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

function rankLabel(r) { return RANK_LABEL[r] || String(r) }

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

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

  // pots (main + side) as chips
  const potEl = document.getElementById('pot')
  potEl.replaceChildren()
  for (const pot of (state.pots || [])) {
    const chip = document.createElement('div')
    chip.className = 'pot-chip' + (pot.label === 'Main' ? '' : ' side')
    chip.textContent = `${pot.label.toUpperCase()} $${pot.amount}`
    potEl.append(chip)
  }

  // result banner at payout
  const result = document.getElementById('result')
  if (state.phase === 'payout' && state.winners.length) {
    const names = state.winners.map(w => w.username).join(' & ')
    result.textContent = `${names} win${state.winners.length > 1 ? '' : 's'} the pot`
  } else {
    result.textContent = ''
  }

  // game over overlay
  const go = document.getElementById('gameover')
  if (state.gamePhase === 'over') {
    const standings = state.seats.filter(s => s && s.finishPlace != null)
      .sort((a, b) => a.finishPlace - b.finishPlace)
    const winner = standings.find(s => s.finishPlace === 1)
    go.innerHTML =
      `<div class="go-trophy">🏆</div>` +
      `<div class="go-title">${winner ? winner.username : 'Someone'} wins the tournament!</div>` +
      `<div class="go-standings">${standings.map(s => `${ordinal(s.finishPlace)} ${s.username}`).join(' · ')}</div>`
    go.classList.remove('hidden')
  } else {
    go.classList.add('hidden')
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
      + (seat.folded && !seat.eliminated && !seat.waiting ? ' folded' : '')
      + (seat.eliminated ? ' eliminated' : '')
      + (seat.waiting ? ' waiting' : '')
    el.style.setProperty('--x', x + '%')
    el.style.setProperty('--y', y + '%')

    const hole = document.createElement('div')
    hole.className = 'hole'
    if (!seat.eliminated && !seat.waiting) {
      if (seat.holeCards === 'hidden') hole.append(cardEl('back'), cardEl('back'))
      else hole.append(...seat.holeCards.map(c => cardEl(c)))
    }

    const nameplate = document.createElement('div')
    nameplate.className = 'nameplate'
    const dealer = seat.seat === state.buttonSeat ? ' <span class="button-chip">D</span>' : ''
    nameplate.innerHTML = `${seat.username} · $${seat.stack}${dealer}`

    const status = document.createElement('div')
    status.className = 'bet'
    if (seat.eliminated) {
      status.innerHTML = `<span class="status-out">OUT · ${ordinal(seat.finishPlace)}</span>`
    } else if (seat.waiting) {
      status.innerHTML = `<span class="status-wait">WAITING</span>`
    } else {
      status.textContent = seat.bet ? `$${seat.bet}` : (seat.allIn ? 'ALL-IN' : '')
    }

    el.append(hole, nameplate, status)
    seatsRoot.append(el)
  }
}

window.renderTable = renderTable
