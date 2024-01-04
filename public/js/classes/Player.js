const NUM_PLAYERS = 7

class Player {
    constructor({ seat, username }) {
      this.seat = seat
      this.username = username
    }
    
    calculatePosition() {
        const angle = (2 * Math.PI * this.seat) / NUM_PLAYERS;
        const tableCenterX = innerWidth / 2; // Replace with the actual center X-coordinate of your table
        const tableCenterY = innerHeight / 2; // Replace with the actual center Y-coordinate of your table
        const tableRadius = 200; // Replace with the actual radius of your table
    
        return {
            x: tableCenterX + tableRadius * Math.cos(angle),
            y: tableCenterY + tableRadius * Math.sin(angle),
        };
    }

    // Fix to draw players based on seat
    draw() {
        console.log(`Drawing user ${this.username} at seat ${this.seat}`)

        const { x, y } = this.calculatePosition();

        c.font = '25px sans-serif'
        c.fillStyle = 'white'
        c.fillText(this.username, x - 10, y + 20)
        c.save()

        c.shadowColor = this.color
        c.shadowBlur = 20
        c.beginPath()
        //c.arc(x, y, 50, 0, Math.PI * 2, false)
        c.fillStyle = 'red'
        c.fill()
        c.restore()
    }
  }