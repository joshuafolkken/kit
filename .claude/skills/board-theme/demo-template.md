# run:board theme demo template

Take a real colored frame afresh, copy the code block to `.josh/tmp/scratch/<theme>-theme-demo.mjs`, add
effects and scenes, and run it:

```bash
FORCE_COLOR=3 pnpm josh run:board --once --theme <theme> > .josh/tmp/scratch/<theme>-frame.ans
pnpm josh scratch:run .josh/tmp/scratch/<theme>-theme-demo.mjs
```

`DEMO_STEPS=<n>` ends it after n frames: the check without a terminal.

```js
// Template for a `run:board` theme demo: a real board frame, a typed message, and scenes a number key picks.
// Copy it to .josh/tmp/scratch/<theme>-theme-demo.mjs, then add effects and scenes.
// Usage: pnpm josh scratch:run .josh/tmp/scratch/<theme>-theme-demo.mjs
// A number key picks a scene; it loops with two seconds of normal display between plays; Q or Ctrl-C
// quits. An optional [scene] picks the first. DEMO_STEPS=<n> ends it after n frames. Terminal only;
// needs the frame's columns, 24 rows, 24-bit color.

import { readFileSync } from 'node:fs'

const ESC = '\u001B['
// The frame's rows shown; the caption takes two more, above the board.
const H = 22
const TICK_MS = 50
// The board's own paces: a letter every 50 ms (`LETTER_MS`), a spinner frame every 80 ms.
const SPINNER_MS = 80

function rgb(color) {
	return `${ESC}38;2;${color}m`
}

// The theme's palette. Name each color by what it paints, so the Issue can say which element takes which.
const BODY = rgb('62;236;225')
const WHITE = rgb('235;255;252')
const CAPTION = rgb('150;150;150')
const CHOSEN = rgb('255;200;60')

// The base: the real colored frame beside this script, `<theme>-frame.ans` for `<theme>-theme-demo.mjs`,
// taken afresh for each proposal:
// `FORCE_COLOR=3 pnpm josh run:board --once --theme <theme> > .josh/tmp/scratch/<theme>-frame.ans`.
const FRAME = readFileSync(new URL(import.meta.url.replace(/-theme-demo\.mjs$/u, '-frame.ans')), 'utf8')
// Where the frame's message line sits — its row, its first column and the column after it (the matrix
// frame's); read them off the frame. The typed messages replace that span only.
const MESSAGE_Y = 2
const MESSAGE_X = 45
const MESSAGE_END = 101

const MESSAGES = [
	{ start: 50, text: '>  #8343 · BASH PNPM JOSH WAIT --PID $(PGREP -F "MEASURE…' },
	{ start: 155, text: 'OK #8349 MERGED — THEME TABLE IS IN; #8354 STARTS' },
]
const LAST_TICK = 260

// An effect: `draw(grid, tick, typed)` changes cells of `grid[y][x] = [character, style]`; a style is
// escapes, `rgb()` one.
function white_while_typing(grid, tick, typed) {
	if (!typed.is_typing) return
	const row = grid[MESSAGE_Y]
	for (let x = MESSAGE_X; x < MESSAGE_X + typed.length; x++) row[x] = [row[x][0], WHITE]
}

// The animations a number key picks: its name, what it shows, the ticks of the timeline it loops, and
// what it draws.
const SCENES = {
	0: { name: 'ALL', note: 'the whole timeline: two messages type', from: 0, to: LAST_TICK, draw: white_while_typing },
	1: { name: 'TYPE', note: 'one message types white', from: 45, to: 115, draw: white_while_typing },
}
// Between two plays the board shows its normal display for two seconds, from this tick of the timeline.
const GAP_TICKS = 40
const NORMAL_FROM = 230

function out(text) {
	process.stdout.write(text)
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function row_of(line, style) {
	return [...line.padEnd(W)].slice(0, W).map((ch) => [ch, style])
}

// One cell per character, styled by every escape before it on its line, so each cell repaints on its own.
function cells_of(line) {
	const cells = []
	let style = ''
	for (const part of line.split(/(\u001B\[[\d;]*m)/u)) {
		if (part.startsWith(ESC)) style += part
		else for (const ch of part) cells.push([ch, style])
	}
	return cells
}

const LINES = FRAME.split('\n').slice(0, H).map(cells_of)
// The frame's own width, so the demo crops no column.
const W = Math.max(...LINES.map((cells) => cells.length))
const BOARD = LINES.map((cells) => [...cells, ...row_of('', '')].slice(0, W))

// Only the escapes a cell adds to the last cell's style; a reset and the whole style where it is not an extension.
function style_change(last, style) {
	if (style === last) return ''
	return last !== undefined && style.startsWith(last) ? style.slice(last.length) : `${ESC}0m${style}`
}

// One write per frame: home the cursor, then each row with escapes only where the style changes.
function render(grid) {
	let text = `${ESC}H`
	for (const row of grid) {
		let last
		for (const [ch, style] of row) {
			text += style_change(last, style)
			last = style
			text += ch
		}
		text += `${ESC}0m${ESC}K\n`
	}
	out(text)
}

// The message line types each message a letter a tick, `█` after it. `cooled` counts the ticks
// since the message finished (negative while it types), for effects that run on after the typing.
function typed_line(tick) {
	const index = MESSAGES.findLastIndex(({ start }) => tick >= start)
	if (index < 0) return { cells: [], is_typing: false, length: 0, total: 0, cooled: -1, index }
	const { start, text } = MESSAGES[index]
	const length = Math.min(text.length, tick - start + 1)
	const is_typing = length < text.length
	const cells = row_of(`${text.slice(0, length)}${is_typing ? '█' : ''}`, BODY).slice(0, MESSAGE_END - MESSAGE_X)
	return { cells, is_typing, length, total: text.length, cooled: tick - start - text.length, index }
}

function grid_of(typed) {
	const grid = BOARD.map((row) => [...row])
	if (typed.index >= 0) grid[MESSAGE_Y].splice(MESSAGE_X, MESSAGE_END - MESSAGE_X, ...typed.cells)
	return grid
}

// Where step `step` of scene `key`'s loop is on the timeline: the scene's ticks, then the normal display.
function moment_of(key, step) {
	const { from, to } = SCENES[key]
	const place = step % (to - from + GAP_TICKS)
	return place < to - from ? { tick: from + place, is_gap: false } : { tick: NORMAL_FROM + place - (to - from), is_gap: true }
}

// The two rows above the board: the scene playing, then the keys with the chosen one picked out.
function caption_rows(key, moment) {
	const { name, note } = SCENES[key]
	const title = moment.is_gap ? `[${key}] ${name} - normal display, two seconds, then it plays again` : `[${key}] ${name} - ${note}`
	const line = `  KEYS  ${Object.entries(SCENES).map(([each, scene]) => `${each} ${scene.name}`).join('   ')}   Q QUIT`
	const keys = row_of(line, CAPTION)
	const at = line.indexOf(`${key} ${name}`)
	for (let x = at; x < Math.min(W, at + key.length + 1 + name.length); x++) keys[x][1] = CHOSEN
	return [row_of(`  ${title}`, moment.is_gap ? CAPTION : WHITE), keys]
}

// One frame: the caption rows, then the board at the moment's tick with the scene's effect drawn.
function frame_of(key, moment) {
	const typed = typed_line(moment.tick)
	const grid = grid_of(typed)
	SCENES[key].draw(grid, moment.tick, typed)
	return [...caption_rows(key, moment), ...grid]
}

// The scene playing and the step of its loop; a number key picks a scene and starts it over.
const playing = { key: '0', step: 0 }

function on_keys(data) {
	for (const ch of String(data).toLowerCase()) {
		if (ch === 'q' || ch === '\u0003') process.exit(0)
		if (ch in SCENES) [playing.key, playing.step] = [ch, 0]
	}
}

function listen() {
	if (!process.stdin.isTTY) return
	process.stdin.setRawMode(true)
	process.stdin.resume()
	process.stdin.on('data', on_keys)
}

// Loops the scene playing until a key quits; DEMO_STEPS ends it after that many frames (a check).
async function play(last_step) {
	for (let count = 0; count < last_step; count++) {
		render(frame_of(playing.key, moment_of(playing.key, playing.step)))
		playing.step += 1
		await sleep(TICK_MS)
	}
}

async function main() {
	const [key = '0'] = process.argv.slice(2)
	if (!(key in SCENES)) throw new Error(`Unknown scene: ${key}. Known: ${Object.keys(SCENES).join(', ')}`)
	playing.key = key
	// The alternate screen, with the cursor hidden; both are put back however the script ends.
	process.on('exit', () => out(`${ESC}0m${ESC}?25h${ESC}?1049l`))
	process.on('SIGINT', () => process.exit(0))
	out(`${ESC}?1049h${ESC}?25l${ESC}2J`)
	listen()
	await play(Number(process.env.DEMO_STEPS || Infinity))
	process.exit(0)
}

await main()
```
