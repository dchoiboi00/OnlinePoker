const express = require('express')
const app = express()

// Socket.io setup
const http = require('http')
const server = http.createServer(app)
const {Server} = require('socket.io')
const io = new Server(server, { pingInterval: 2000, pingTimeout: 5000})

const PORT = process.env.PORT || 3000;

app.use(express.static('public'))

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html')
})

// Backend objects

const backEndPlayers = {}
const backEndDeck = []

// Backend logic on user events
io.on('connection', (socket) => {
    console.log(`a user connected with id ${socket.id}`)




})


// Backend ticker
setInterval(() => {
    // update everything
    


}, 15)





server.listen(PORT, () => {
    console.log(`Poker app listening on port ${PORT}`)
})

console.log('server did load')