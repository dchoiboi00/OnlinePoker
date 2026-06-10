document.querySelector('#usernameForm').addEventListener('submit', (event) => {
  event.preventDefault()
  const username = document.querySelector('#usernameInput').value.trim() || 'Player'
  socket.emit('initGame', { username })
  document.querySelector('#overlay').classList.add('hidden')
})
