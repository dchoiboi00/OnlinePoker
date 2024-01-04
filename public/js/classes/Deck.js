class Card {
    constructor(rank, suit) {
        this.rank = rank
        this.suit = suit
    }

    toString() {
        let rankString

        switch (this.rank) {
            case 11:
                rankString = "Jack"
                break
            case 12:
                rankString = "Queen"
                break
            case 13:
                rankString = "King"
                break
            case 14:
                rankString = "Ace"
                break
            default:
                rankString = this.rank.toString();
        }

        return `${rankString} of ${this.suit}`
    }

    lt(otherCard) {
        return this.rank < otherCard.rank
    }

    gt(otherCard) {
        return this.rank > otherCard.rank;
    }
}

class Deck {
    constructor() {
        this.cards = []

        const suits = ["Hearts", "Diamonds", "Clubs", "Spades"]
        const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

        for (const suit of suits) {
            for (const rank of ranks) {
                this.cards.push(new Card(rank, suit))
            }
        }
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--){
            let j = Math.floor(Math.random() * (i + 1))
            console.log("j:", j)

            if (this.cards[i] === undefined) {
                console.error(`this.cards[${i}] is undefined`);
                continue;
            }
    
            if (this.cards[j] === undefined) {
                console.error(`this.cards[${j}] is undefined`);
                continue;
            }

            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]]
        }
    }

    deal() {
        return this.cards.splice(0, 2)
    }

    toString(){
        for (const card of this.cards){
            console.log(card)
        }
    }

}

module.exports = {
    Deck
}