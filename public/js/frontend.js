const canvas = document.querySelector('canvas')
const c = canvas.getContext('2d')

// draw table
const img = new Image()
img.src = "/img/table.jpeg"
function drawImage() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    var scaleWidth = canvas.width / img.width;
    var scaleHeight = canvas.height / img.height;
    var scale = Math.max(scaleWidth, scaleHeight);

    // Calculate the dimensions to keep the aspect ratio
    var newWidth = img.width * scale;
    var newHeight = img.height * scale;

    // Calculate the centering position
    var x = (canvas.width - newWidth) / 2;
    var y = (canvas.height - newHeight) / 2;

    c.drawImage(img, x, y, newWidth, newHeight)
}
img.onload = () => {
    drawImage()
}
window.addEventListener('resize', drawImage)

const socket = io()

const devicePixelRatio = window.devicePixelRatio || 1

const frontEndPlayers = {}
var frontEndDeck = new Deck()

socket.on('updateDeck', (backEndDeck) => {
    frontEndDeck = backEndDeck
    console.log("Front end deck:", frontEndDeck)
})

socket.on('updatePlayers', (backEndPlayers) => {
    for (const id in backEndPlayers) {
        const backEndPlayer = backEndPlayers[id]

        // if we see new player
        if (!frontEndPlayers[id]){
            frontEndPlayers[id] = new Player({
                seat: backEndPlayer.seat,
                username: backEndPlayer.username
            })
        }

    }
    for (const id in frontEndPlayers) {
        if (!backEndPlayers[id]){
            delete frontEndPlayers[id]
        }
    }

    console.log("Front end players:", frontEndPlayers)
})

// Animation

let animationId
function animate() {
    animationId = requestAnimationFrame(animate)


    for (const id in frontEndPlayers) {
        const frontEndPlayer = frontEndPlayers[id]

        frontEndPlayer.draw()
    }

}

animate()

document.querySelector('#usernameForm').addEventListener('submit', (event) => {
    event.preventDefault()
    document.querySelector('#usernameForm').style.display = 'none'
    socket.emit('initGame', {
      username: document.querySelector('#usernameInput').value
    })
  })