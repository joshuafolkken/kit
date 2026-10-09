#!/usr/bin/env tsx
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters, styleText } from 'node:util'
import { machine_capacity } from '#scripts/gate/machine-capacity'
import { run_progress_read } from '#scripts/run/progress/run-progress-read'
import terminalLink from 'terminal-link'
import { run_board_closed } from './run-board-closed'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import { run_board_plan } from './run-board-plan'
import { run_board_read } from './run-board-read'
import { run_board_screen, type Screen } from './run-board-screen'
import type { BoardPorts } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import { run_board_usage_read } from './run-board-usage-read'

// `josh run:board` — a full-screen board of the running `backlogrun` (joshuafolkken/kit#3430), redrawn
// four times a second for a person to keep open beside the run. What one redraw reads, and how often each read
// is taken, is `run-board-tick.ts`'s; this file wires the live reads and the terminal around it. A run
// that ended stays on screen until the next one starts (joshuafolkken/kit#3439); with no run in this
// checkout it reads nothing from GitHub and waits.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ONCE_FLAG = '--once'
const CHAT_FLAG = '--chat'
const FLAGS: ReadonlySet<string> = new Set(['', ONCE_FLAG, CHAT_FLAG])
const SIGINT_EXIT_CODE = 130
const SIGTERM_EXIT_CODE = 143
const USAGE = 'Usage: josh run:board [--once | --chat]'
const { FRESH_STATE, REDRAW_MS, tick } = run_board_tick
const { WORDS } = run_board_labels

// A signal exits with its conventional code, so the `exit` handler restores the screen on every path.
function on_exit(leave: () => void): void {
	process.once('exit', leave)
	process.once('SIGINT', () => process.exit(SIGINT_EXIT_CODE))
	process.once('SIGTERM', () => process.exit(SIGTERM_EXIT_CODE))
}

const LIVE_PORTS: BoardPorts = {
	read_plan: async (scope) => await run_board_plan.read_plan(scope),
	read_local: run_board_read.read_local,
	read_machine: machine_capacity.read_sample,
	read_usage: run_board_usage_read.usage_reader(),
	read_closed: async (issues) => await run_board_closed.read_all(issues),
	now: () => Date.now(),
	write: (frame) => process.stdout.write(frame),
	// No fallback: a terminal that opens no link, or a pipe, gets the bare number rather than a URL.
	link: (text, url) => terminalLink(text, url, { fallback: false }),
	is_tty: process.stdout.isTTY,
	// Read on every redraw, so a resized pane is fitted on the next one (joshuafolkken/kit#3486).
	size: () => ({ rows: process.stdout.rows, columns: process.stdout.columns }),
	form: 'screen',
	mark: async () => {
		run_progress_read.mark(await run_progress_read.stamp_target(), Date.now())
	},
	on_exit,
	sleep: async (ms) => {
		await sleep(ms)
	},
}

// Every frame starts from the top of the alternate screen, erasing what the last one left below it, and
// ends on the line that says closing the screen leaves the run going (joshuafolkken/kit#3437) — only a
// screen a person can close says it. Nothing follows the footer and the frame is kept to the rows the
// footer leaves, so writing it never scrolls the header off the top (joshuafolkken/kit#3486).
function framed(ports: BoardPorts, screen: Screen): BoardPorts {
	const footer = ['', styleText('dim', WORDS.keeps_running)]
	const { size } = ports

	return {
		...ports,
		write: (frame) => {
			ports.write(`${screen.frame}${frame}${footer.join('\n')}`)
		},
		size: size === undefined ? undefined : () => run_board_fit.reserve(size(), footer),
	}
}

// Leaves the alternate screen once, whichever path gets there first: a second leave would restore the
// cursor saved on entering and draw over whatever was printed after the first.
function leaver(ports: BoardPorts, screen: Screen): () => void {
	let has_left = false

	return () => {
		if (has_left) return
		has_left = true
		ports.write(screen.leave)
	}
}

async function redraw_forever(ports: BoardPorts): Promise<void> {
	// The plan is read in the background, so the first frame is drawn without waiting on GitHub
	// (joshuafolkken/kit#3455).
	let state = await tick(FRESH_STATE, ports, 'background')

	for (;;) {
		// eslint-disable-next-line no-await-in-loop -- polling: each redraw waits out the tick before it
		await ports.sleep(REDRAW_MS)
		// eslint-disable-next-line no-await-in-loop -- polling: each redraw folds the state the last one left
		state = await tick(state, ports, 'background')
	}
}

// A signal leaves through `on_exit`; a failed redraw leaves before its error is printed, so the error
// lands on the normal screen rather than vanishing with the alternate one.
async function watch(ports: BoardPorts): Promise<void> {
	const screen = run_board_screen.screen_of('live')
	const leave = leaver(ports, screen)

	ports.write(screen.enter)
	ports.on_exit(leave)

	try {
		await redraw_forever(framed(ports, screen))
	} finally {
		leave()
	}
}

// The answer to a progress question asked during a `backlogrun` (joshuafolkken/kit#3456): one frame in
// the chat's form, with every escape stripped because a chat shows them as text, and recorded as the
// report it is, so the next scheduled one waits a full interval — as `run:progress --once` does.
async function answer(ports: BoardPorts): Promise<void> {
	const chat_ports: BoardPorts = {
		...ports,
		is_tty: false,
		size: undefined,
		form: 'chat',
		write: (frame) => {
			ports.write(stripVTControlCharacters(frame))
		},
	}

	await tick(FRESH_STATE, chat_ports)
	await ports.mark()
}

async function draw(flag: string, ports: BoardPorts): Promise<void> {
	if (flag === CHAT_FLAG) {
		await answer(ports)

		return
	}

	const mode = run_board_screen.mode_of({ is_tty: ports.is_tty, is_once: flag === ONCE_FLAG })

	// One plain frame stays on the terminal after the command, so it draws the still icons rather than a
	// spinner frame frozen mid-turn (joshuafolkken/kit#3452).
	const once_ports = { ...ports, is_tty: false, size: undefined }

	await (mode === 'live' ? watch(ports) : tick(FRESH_STATE, once_ports))
}

async function run(argv: ReadonlyArray<string>, ports: BoardPorts = LIVE_PORTS): Promise<number> {
	const [flag = '', ...rest] = argv

	if (rest.length > 0 || !FLAGS.has(flag)) {
		process.stderr.write(`${USAGE}\n`)

		return FAILURE_EXIT_CODE
	}

	await draw(flag, ports)

	return SUCCESS_EXIT_CODE
}

const run_board_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

export { run_board_cli }
