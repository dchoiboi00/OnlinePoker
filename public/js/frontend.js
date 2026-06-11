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

  // Context button: lobby -> Start Game, between hands -> Deal Next Hand,
  // game over -> New Game.
  if (seated && !handLive) {
    let label, event
    if (state.gamePhase === 'lobby') { label = 'Start Game'; event = 'startGame' }
    else if (state.gamePhase === 'over') { label = 'New Game'; event = 'newGame' }
    else { label = 'Deal Next Hand'; event = 'dealHand' }
    const btn = document.createElement('button')
    btn.className = 'btn-start'
    btn.textContent = label
    btn.onclick = () => socket.emit(event)
    bar.append(btn)
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
