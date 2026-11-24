// How `josh run:board` puts its frames on the terminal. A board kept open
// draws on the alternate screen, as `top` and `less` do: clearing the normal screen pushes every
// redraw into the scrollback, so the board would grow like a log. Leaving restores the screen and the
// cursor the person had. One frame — `--once`, or a pipe — draws no screen control; a terminal still
// gets its colors.

type ScreenMode = 'live' | 'plain'

// The control bytes written on entering and on leaving, and each frame as written: `frame` in one
// synchronized write, `held` without it for the first frame, revealed a block at a time.
interface Screen {
	enter: string
	frame: (text: string) => string
	held: (text: string) => string
	leave: string
}

const ESC = '\u{1B}['
const ALTERNATE_SCREEN_ON = `${ESC}?1049h`
const ALTERNATE_SCREEN_OFF = `${ESC}?1049l`
const CURSOR_HIDE = `${ESC}?25l`
const CURSOR_SHOW = `${ESC}?25h`
const CURSOR_HOME = `${ESC}H`
// joshuafolkken/kit#8653: the alternate screen keeps the cursor's row, so the intro typed after
// entering would land wherever the shell left it; the second row, first column, is where it goes.
const CURSOR_SECOND_ROW = `${ESC}2;1H`
const ERASE_BELOW = `${ESC}J`
const ERASE_LINE = `${ESC}K`
const SYNC_ON = `${ESC}?2026h`
const SYNC_OFF = `${ESC}?2026l`

// joshuafolkken/kit#8125: bytes a terminal draws only once all have arrived (DEC 2026), so no
// half-written state shows; a terminal without it ignores the markers. Nothing to write stays nothing.
function synced(text: string): string {
	if (text === '') return ''

	return `${SYNC_ON}${text}${SYNC_OFF}`
}

// A frame over the last one, never a cleared screen: each line erased as it is written, the last
// erasing every row below too, so a shorter frame leaves none of the longer one. Each erase leads its
// line — one after a line that fills the row would take the line's last character with it.
function overwritten(text: string): string {
	const lines = text.split('\n')
	const last = lines.length - 1
	const erased = lines.map((line, index) => `${index === last ? ERASE_BELOW : ERASE_LINE}${line}`)

	return `${CURSOR_HOME}${erased.join('\n')}`
}

function overwritten_synced(text: string): string {
	return synced(overwritten(text))
}

// Writes put together in one synchronized write: each part's own markers taken out, so the terminal
// draws none of them until the last has arrived.
function joined_synced(parts: ReadonlyArray<string>): string {
	return synced(parts.map((part) => part.replaceAll(SYNC_ON, '').replaceAll(SYNC_OFF, '')).join(''))
}

// joshuafolkken/kit#8796: a writer that, once held, keeps every write until it is flushed, then writes
// them as one synchronized write; not held, each write goes straight through. A live board's redraw
// no longer holds it: the frame loop composes every layer into one write (joshuafolkken/kit#8826).
interface Joint {
	write: (bytes: string) => void
	hold: () => void
	flush: () => void
}

function joint_of(write: (bytes: string) => void): Joint {
	const held: Array<string> = []
	let is_holding = false

	return {
		write: (bytes) => {
			if (is_holding) held.push(bytes)
			else write(bytes)
		},
		hold: () => {
			is_holding = true
		},
		flush: () => {
			const joined = joined_synced(held.splice(0))

			is_holding = false
			if (joined !== '') write(joined)
		},
	}
}

// Ports writing through the joint, every wait flushing it first, so nothing held waits with them — the
// spin's first wait comes right after it draws the frame's rain back.
function jointed<P extends Pick<Joint, 'write'> & { sleep: (ms: number) => Promise<void> }>(
	ports: P,
	joint: Joint,
): P {
	return {
		...ports,
		write: joint.write,
		sleep: async (ms: number) => {
			joint.flush()
			await ports.sleep(ms)
		},
	}
}

// The first frame, revealed a block at a time over the intro's typed line: the screen wiped first,
// whatever the intro left (joshuafolkken/kit#8000), and nothing held back by synchronized output.
function wiped(text: string): string {
	return `${CURSOR_HOME}${ERASE_BELOW}${text}`
}

function unchanged(text: string): string {
	return text
}

const LIVE: Screen = {
	enter: `${ALTERNATE_SCREEN_ON}${CURSOR_HIDE}${CURSOR_SECOND_ROW}`,
	frame: overwritten_synced,
	held: wiped,
	leave: `${CURSOR_SHOW}${ALTERNATE_SCREEN_OFF}`,
}

const PLAIN: Screen = { enter: '', frame: unchanged, held: unchanged, leave: '' }

function mode_of(options: { is_tty: boolean; is_once: boolean }): ScreenMode {
	return options.is_tty && !options.is_once ? 'live' : 'plain'
}

function screen_of(mode: ScreenMode): Screen {
	return mode === 'live' ? LIVE : PLAIN
}

const run_board_screen = { joined_synced, joint_of, jointed, mode_of, screen_of, synced }

export { run_board_screen }
export type { Joint, Screen, ScreenMode }
