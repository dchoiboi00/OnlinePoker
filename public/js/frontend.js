const canvas = document.querySelector('canvas')
const c = canvas.getContext('2d')

const socket = io()

const devicePixelRatio = window.devicePixelRatio || 1

const frontEndPlayers = {}
