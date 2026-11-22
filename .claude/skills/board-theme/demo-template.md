# run:board theme demo template

Take a real colored frame afresh, copy the code block to `.josh/tmp/scratch/<theme>-theme-demo.mjs`, add
effects and variants, and run it:

```bash
FORCE_COLOR=3 pnpm josh run:board --once --theme <theme> > .josh/tmp/scratch/<theme>-frame.ans
pnpm josh scratch:run .josh/tmp/scratch/<theme>-theme-demo.mjs [variant]…
```

```js
// Template for a `run:board` theme demo: a real board frame, a typed message, and one effect per variant.
// Copy it to .josh/tmp/scratch/<theme>-theme-demo.mjs, then add effects and variants.
// Usage: pnpm josh scratch:run .josh/tmp/scratch/<theme>-theme-demo.mjs [variant]…
// No argument is a tour: each message types with the next variant. One or more names play those
// variants on every message. It writes to the terminal only. Needs the frame's columns, 24 rows, 24-bit color.

import { readFileSync } from 'node:fs'

const ESC = '\u001B['
// The frame's rows shown; the caption takes two more.
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

// The base: the real colored frame beside this script, `<theme>-frame.ans` for `<theme>-theme-demo.mjs`,
// taken afresh for each proposal:
// `FORCE_COLOR=3 pnpm josh run:board --once --theme <theme> > .josh/tmp/scratch/<theme>-frame.ans`.
const FRAME = readFileSync(new URL(import.meta.url.replace(/-theme-demo\.mjs$/u, '-frame.ans')), 'utf8')
// Where the frame's message line sits — its row, its first column and the column after it (the matrix
// frame's); read them off the frame. The typed messages replace that span only.
const MESSAGE_Y = 2
const MESSAGE_X = 45
const MESSAGE_END = 101

// The variants under comparison: its name, the caption shown while it plays, and what it draws.
// `draw(grid, tick, typed)` changes cells of `grid[y][x] = [character, style]`; a style is escapes, `rgb()` one.
const VARIANTS = {
	example: {
		note: 'EXAMPLE - the typed message is white while it types',
		draw: (grid, tick, typed) => {
			if (!typed.is_typing) return
			const row = grid[MESSAGE_Y]
			for (let x = MESSAGE_X; x < MESSAGE_X + typed.length; x++) row[x] = [row[x][0], WHITE]
		},
	},
}

const MESSAGES = [
	{ start: 50, text: '>  #8343 · BASH PNPM JOSH WAIT --PID $(PGREP -F "MEASURE…' },
	{ start: 155, text: 'OK #8349 MERGED — THEME TABLE IS IN; #8354 STARTS' },
]
const LAST_TICK = 260

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

function variants_of(chosen, typed) {
	const names = Object.keys(VARIANTS)
	if (chosen.length > 0) return chosen
	return typed.index < 0 ? [] : [names[typed.index % names.length]]
}

async function scene(chosen) {
	for (let tick = 0; tick < LAST_TICK; tick++) {
		const typed = typed_line(tick)
		const names = variants_of(chosen, typed)
		const caption = typed.is_typing ? names.map((name) => VARIANTS[name].note).join('  +  ') : 'IDLE'
		const grid = grid_of(typed)
		grid.push(row_of('', CAPTION), row_of(`  ${caption}`.slice(0, W), CAPTION))
		for (const name of names) VARIANTS[name].draw(grid, tick, typed)
		render(grid)
		await sleep(TICK_MS)
	}
}

async function main() {
	const chosen = process.argv.slice(2)
	const unknown = chosen.find((name) => !(name in VARIANTS))
	if (unknown) throw new Error(`Unknown variant: ${unknown}. Known: ${Object.keys(VARIANTS).join(', ')}`)
	// The alternate screen, with the cursor hidden; both are put back however the script ends.
	process.on('exit', () => out(`${ESC}0m${ESC}?25h${ESC}?1049l`))
	process.on('SIGINT', () => process.exit(0))
	out(`${ESC}?1049h${ESC}?25l${ESC}2J`)
	await scene(chosen)
}

await main()
```
