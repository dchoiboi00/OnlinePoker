// Self-contained browser smoke test: boots the server, drives two browser
// players through a full hand, asserts the key behavior, saves screenshots,
// and tears everything down. Run with: npm run smoke
//
// Requires the Playwright Chromium browser once:  npx playwright install chromium
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.SMOKE_PORT || 3000
const URL = `http://localhost:${PORT}`
const SHOTS = join(ROOT, '.smoke')
mkdirSync(SHOTS, { recursive: true })

const log = (...a) => console.log(...a)
let failures = 0
const chk = (n, c) => { log(`${c ? 'PASS' : 'FAIL'}: ${n}`); if (!c) failures++ }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// --- boot the server ---
const server = spawn('node', ['backend.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverErr = ''
server.stderr.on('data', d => { serverErr += d })

async function waitForServer(timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(URL)
      if (res.ok) return true
    } catch { /* not up yet */ }
    await sleep(200)
  }
  return false
}

function shutdown(code) {
  try { server.kill() } catch { /* already gone */ }
  process.exit(code)
}

const up = await waitForServer()
if (!up) {
  log('FAIL: server did not start on', URL)
  if (serverErr) log(serverErr.split('\n').slice(0, 6).join('\n'))
  shutdown(1)
}

const browser = await chromium.launch()

async function newPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.fill('#usernameInput', name)
  await page.click('#usernameForm button[type=submit]')
  return { ctx, page, name, errors }
}

const snapshot = page => page.evaluate(() => ({
  back: document.querySelectorAll('.card.back').length,
  faceUp: document.querySelectorAll('.card:not(.back)').length,
  community: document.querySelectorAll('#community .card').length,
  result: (document.querySelector('#result')?.textContent || '').trim(),
  pot: (document.querySelector('#pot')?.textContent || '').trim(),
}))

const actionButtons = page => page.evaluate(() =>
  [...document.querySelectorAll('#controls button')].map(b => (b.textContent || '').trim()))

try {
  const alice = await newPlayer('Alice')
  await sleep(400)
  const bob = await newPlayer('Bob')
  await sleep(700)

  const aSeats = await alice.page.evaluate(() => document.querySelectorAll('#seats .seat').length)
  chk('two seats rendered', aSeats === 2)

  const startBtn = await alice.page.$('#controls button.btn-start')
  chk('Start Hand button present', !!startBtn)
  if (startBtn) await startBtn.click()
  await sleep(800)

  const aPre = await snapshot(alice.page)
  const bPre = await snapshot(bob.page)
  chk('Alice sees 2 own face-up + 2 opponent backs (private cards)', aPre.faceUp === 2 && aPre.back === 2)
  chk('Bob sees 2 own face-up + 2 opponent backs (private cards)', bPre.faceUp === 2 && bPre.back === 2)
  chk('no community cards preflop', aPre.community === 0)
  chk('pot shows blinds', /\d/.test(aPre.pot))
  await alice.page.screenshot({ path: join(SHOTS, 'alice-preflop.png') })
  await bob.page.screenshot({ path: join(SHOTS, 'bob-preflop.png') })

  // play to showdown: whoever is to act clicks Check, else Call, else Fold
  const players = [alice, bob]
  let reached = false
  for (let guard = 0; guard < 40; guard++) {
    const st = await snapshot(alice.page)
    if (/win/i.test(st.result)) { reached = true; break }
    let acted = false
    for (const p of players) {
      const btns = await actionButtons(p.page)
      if (!btns.some(b => /Fold|Check|Call|Raise|Bet/.test(b))) continue
      const sel = btns.some(b => /^Check$/.test(b)) ? 'button.btn-check'
        : btns.some(b => /^Call/.test(b)) ? 'button.btn-call'
        : 'button.btn-fold'
      const btn = await p.page.$('#controls ' + sel)
      if (btn) { await btn.click(); acted = true; await sleep(450); break }
    }
    if (!acted) await sleep(250)
  }

  const aEnd = await snapshot(alice.page)
  const bEnd = await snapshot(bob.page)
  chk('reached showdown/winner', reached)
  chk('winner announced to Alice', /win/i.test(aEnd.result))
  chk('winner announced to Bob', /win/i.test(bEnd.result))
  chk('5 community cards at showdown', aEnd.community === 5)
  chk('opponent cards revealed at showdown', aEnd.back === 0)
  await alice.page.screenshot({ path: join(SHOTS, 'alice-showdown.png') })
  await bob.page.screenshot({ path: join(SHOTS, 'bob-showdown.png') })

  const allErrors = [...alice.errors, ...bob.errors]
  chk('no browser JS errors', allErrors.length === 0)
  if (allErrors.length) log('  ERRORS:', allErrors.slice(0, 5))

  log(`\nSMOKE RESULT: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
  log(`screenshots: ${SHOTS}`)
} catch (err) {
  log('FAIL: smoke run threw:', err.message)
  failures++
} finally {
  await browser.close()
  shutdown(failures ? 1 : 0)
}
