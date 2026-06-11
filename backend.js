const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const { PokerTable } = require('./game/PokerTable')

const app = express()
const server = http.createServer(app)
const io = new Server(server)
const PORT = process.env.PORT || 3000

app.use(express.static('public'))

const table = new PokerTable()

// Push each connected client its own personalized view.
function broadcast() {
  for (const [id, socket] of io.of('/').sockets) {
    socket.emit('gameState', table.getStateFor(id))
  }
}

io.on('connection', (socket) => {
  console.log(`connected: ${socket.id}`)

  socket.on('initGame', ({ username }) => {
    table.sit(socket.id, (username || 'Player').slice(0, 16))
    broadcast()
  })

  socket.on('startGame', () => {
    try { table.startGame(); broadcast() }
    catch (err) { socket.emit('errorMsg', err.message) }
  })

  socket.on('dealHand', () => {
    try { table.dealHand(); broadcast() }
    catch (err) { socket.emit('errorMsg', err.message) }
  })

  socket.on('newGame', () => {
    try { table.newGame(); broadcast() }
    catch (err) { socket.emit('errorMsg', err.message) }
  })

  socket.on('action', (action) => {
    try {
      table.applyAction(socket.id, action)
      broadcast()
    } catch (err) {
      socket.emit('errorMsg', err.message)
    }
  })

  socket.on('disconnect', () => {
    table.leave(socket.id)
    broadcast()
  })
})

server.listen(PORT, () => console.log(`Poker app listening on port ${PORT}`))
