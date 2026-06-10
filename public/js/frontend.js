const socket = io()
let latestState = null

socket.on('gameState', (state) => {
  latestState = state
  renderTable(state)
  renderControls(state)
})

socket.on('errorMsg', (msg) => {
  const result = document.getElementById('result')
  result.textContent = msg
})

function emitAction(action) { socket.emit('action', action) }

function renderControls(state) {
  const bar = document.getElementById('controls')
  bar.replaceChildren()

  const seated = state.seats.some(s => s && s.isSelf)
  const handLive = state.phase !== 'waiting' && state.phase !== 'payout'

  // Start Hand button: shown when seated and no hand in progress
  if (seated && !handLive) {
    const start = document.createElement('button')
    start.className = 'btn-start'
    start.textContent = 'Start Hand'
    start.onclick = () => socket.emit('startHand')
    bar.append(start)
  }

  const la = state.legalActions
  if (!la) return // not our turn (or not seated)

  const fold = document.createElement('button')
  fold.className = 'btn-fold'; fold.textContent = 'Fold'
  fold.onclick = () => emitAction({ type: 'fold' })
  bar.append(fold)

  if (la.canCheck) {
    const check = document.createElement('button')
    check.className = 'btn-check'; check.textContent = 'Check'
    check.onclick = () => emitAction({ type: 'check' })
    bar.append(check)
  }
  if (la.canCall) {
    const call = document.createElement('button')
    call.className = 'btn-call'; call.textContent = `Call $${la.callAmount}`
    call.onclick = () => emitAction({ type: 'call' })
    bar.append(call)
  }
  if (la.canRaise) {
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(la.minRaiseTo)
    slider.max = String(la.maxRaiseTo)
    slider.value = String(la.minRaiseTo)

    const amount = document.createElement('span')
    amount.id = 'raiseAmount'
    amount.textContent = `$${la.minRaiseTo}`
    slider.oninput = () => { amount.textContent = `$${slider.value}` }

    const raise = document.createElement('button')
    raise.className = 'btn-raise'
    raise.textContent = state.currentBet > 0 ? 'Raise' : 'Bet'
    raise.onclick = () => emitAction({
      type: state.currentBet > 0 ? 'raise' : 'bet',
      amount: Number(slider.value),
    })
    bar.append(slider, amount, raise)
  }
}

window.renderControls = renderControls
