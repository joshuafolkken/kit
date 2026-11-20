# run:board theme demo template

Copy the code block to `.josh/tmp/scratch/<theme>-theme-demo.mjs`, add effects and variants, and run it with
`pnpm josh scratch:run .josh/tmp/scratch/<theme>-theme-demo.mjs [variant]…`.

```js
// Template for a `run:board` theme demo: a mock board, a typed message, and one effect per variant.
// Copy it to .josh/tmp/scratch/<theme>-theme-demo.mjs, then add effects and variants.
// Usage: pnpm josh scratch:run .josh/tmp/scratch/<theme>-theme-demo.mjs [variant]…
// No argument is a tour: each message types with the next variant. One or more names play those
// variants on every message. It writes to the terminal only. Needs 100 columns, 24 rows, 24-bit color.

const ESC = '\u001B['
const W = 100
const TICK_MS = 50
// The board's own paces: a letter every 50 ms (`LETTER_MS`), a spinner frame every 80 ms.
const SPINNER_MS = 80

// The theme's palette. Name each color by what it paints, so the Issue can say which element takes which.
const BODY = '62;236;225'
const RULE = '30;120;115'
const WHITE = '235;255;252'
const AMBER = '255;190;0'
const RED = '255;70;70'
const CAPTION = '150;150;150'

// A mock board. Refresh it from a real frame: `NO_COLOR=1 pnpm josh run:board --once --theme <theme>`.
const BOARD = [
	'= JOSH-BOARD      T+ 21°41′05″  OK 63/76 ■■■■■■■■--  ET ~15:52  RN 2  HD 13   DEFCON 5 4 3 [2] 1',
	'  V1.3164.0+1179  HB       29″  MM   37% ■■■■------',
	'  KIT                      29″  WT WATCHING — 13 WAITING',
	'',
	'-- -- THROUGHPUT -------------------- /H ACTIVE - DONE - PEAK - NOW ------------------------------',
	'     24H  ▇▄▆▆▃▃▃▅▅▃▂▂┊┊┊┊┊▁▅▆██▄▁   4.3    17H     72    9.0     0',
	'      7D  ▂▄▂▅▃▄▂█▃█▇█▄▄             4.1    89H    368    5.2',
	'',
	'-- -- USAGE --------------------------------------------------------------------------------------',
	'     CLAUDE        7D  90% ■■■■■■■■■■■■■■■■■┊--  ≈55 SAT 10:00',
	'     GITHUB      REST   1% ----┊---------------  4929     15:57',
	'',
	'-- -- LANES 2/6 - T+ ------- CPU ---- MEM --------------------------------------------------------',
	"     BD 8336  12′04″   41%   1.2G  P2 FT REPLACE THE LANE CHILD'S SLEEP POLLING",
	'     RV 8332   3′51″   12%   0.8G     FT NOTIFY WHEN READY ISSUES FALL BELOW THE FLOOR',
	'',
	'-- -- QUEUED 3 -----------------------------------------------------------------------------------',
	'     HD 8329     FT FIND AND FIX WHAT DOUBLED HANDOFF SESSION COST',
	'     HD 8331     FT BREAK DOWN FREE-LANE WAIT TIME BY CAUSE',
	'     HD 8333     FT SHRINK TEST:RELATED REACH OF THE TOP THREE',
	'',
]
// Which text takes which color, beyond the body and the rules.
const TONES = [
	[/\bP2\b/gu, AMBER],
	[/\[2\]/gu, RED],
]

// The variants under comparison: its name, the caption shown while it plays, and what it draws.
// `draw(grid, tick, typed)` changes cells of `grid[y][x] = [character, color]`.
const VARIANTS = {
	example: {
		note: 'EXAMPLE - the typed message is white while it types',
		draw: (grid, tick, typed) => {
			if (!typed.is_typing) return
			for (let x = MESSAGE_X; x < MESSAGE_X + typed.length; x++) grid[2][x] = [grid[2][x][0], WHITE]
		},
	},
}

const MESSAGE_X = 32
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

function colors_of(line) {
	const is_rule = line.startsWith('-- --')
	const colors = [...line].map((ch) => (ch === '-' && is_rule ? RULE : BODY))
	for (const [pattern, color] of TONES) {
		for (const match of line.matchAll(pattern)) colors.fill(color, match.index, match.index + match[0].length)
	}
	return colors
}

function row_of(line, color) {
	const padded = line.padEnd(W)
	const colors = color ? undefined : colors_of(padded)
	return [...padded].map((ch, index) => [ch, color ?? colors[index]])
}

// One write per frame: home the cursor, then each row with a color escape only where the color changes.
function render(grid) {
	let text = `${ESC}H`
	for (const row of grid) {
		let last = ''
		for (const [ch, color] of row) {
			if (color !== last) text += `${ESC}38;2;${color}m`
			last = color
			text += ch
		}
		text += `${ESC}0m${ESC}K\n`
	}
	out(text)
}

// The header's third line types each message a letter a tick, `█` after it. `cooled` counts the ticks
// since the message finished (negative while it types), for effects that run on after the typing.
function typed_line(tick) {
	const index = MESSAGES.findLastIndex(({ start }) => tick >= start)
	if (index < 0) return { line: BOARD[2], is_typing: false, length: 0, total: 0, cooled: -1, index }
	const { start, text } = MESSAGES[index]
	const length = Math.min(text.length, tick - start + 1)
	const is_typing = length < text.length
	const line = `${BOARD[2].slice(0, MESSAGE_X)}${text.slice(0, length)}${is_typing ? '█' : ''}`
	return { line, is_typing, length, total: text.length, cooled: tick - start - text.length, index }
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
		const grid = BOARD.with(2, typed.line).map((line) => row_of(line))
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
