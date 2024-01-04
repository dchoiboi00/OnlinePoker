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

const { Deck } =  require('./public/js/classes/Deck')

const backEndPlayers = {}
const backEndDeck = new Deck()
backEndDeck.shuffle()
const NUM_PLAYERS = 7
const emptySeats = Array.from({length: NUM_PLAYERS}, () => true)

function findEmptySeat() {
    // if all emptySeats are false
    if (!emptySeats) {
        return -1
    }
    for (let i = 0; i < emptySeats.length; i++){
        if (emptySeats[i]){
            return i
        }
    }
}

// Backend logic on user events
io.on('connection', (socket) => {
    console.log(`a user connected with id ${socket.id}`)
    console.log('current deck:', backEndDeck)

    // On user form submission
    socket.on('initGame', ({ username }) => {
        backEndPlayers[socket.id] = {
            seat: findEmptySeat(),
            username
        }
        emptySeats[backEndPlayers[socket.id].seat] = false
        
    })
    
    // On disconnect
    socket.on('disconnect', (reason) => {
        console.log(reason)
        if (backEndPlayers[socket.id]){
            emptySeats[backEndPlayers[socket.id].seat] = true
        }
        delete backEndPlayers[socket.id]
        io.emit('updatePlayers', backEndPlayers)
    })

})


// Backend ticker
setInterval(() => {
    // update everything
    io.emit('updateDeck', backEndDeck)
    io.emit('updatePlayers', backEndPlayers)
    console.log(backEndPlayers)

}, 1500)





server.listen(PORT, () => {
    console.log(`Poker app listening on port ${PORT}`)
})

console.log('server did load')

module.exports = {
    NUM_PLAYERS
}