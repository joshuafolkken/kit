#!/usr/bin/env tsx
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { styleText } from 'node:util'
import { machine_capacity } from '#scripts/gate/machine-capacity'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { session_language } from '#scripts/josh/session-language'
import terminalLink from 'terminal-link'
import { run_board_closed } from './run-board-closed'
import { run_board_labels, type Words } from './run-board-labels'
import { run_board_plan } from './run-board-plan'
import { run_board_read } from './run-board-read'
import { run_board_screen, type Screen } from './run-board-screen'
import type { BoardPorts } from './run-board-state'
import { run_board_tick } from './run-board-tick'

// `josh run:board` — a full-screen board of the running `backlogrun` (joshuafolkken/kit#3430), redrawn
// four times a second for a person to keep open beside the run. What one redraw reads, and how often each read
// is taken, is `run-board-tick.ts`'s; this file wires the live reads and the terminal around it. A run
// that ended stays on screen until the next one starts (joshuafolkken/kit#3439); with no run in this
// checkout it reads nothing from GitHub and waits.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ONCE_FLAG = '--once'
const SIGINT_EXIT_CODE = 130
const SIGTERM_EXIT_CODE = 143
const USAGE = 'Usage: josh run:board [--once]'
const { FRESH_STATE, REDRAW_MS, tick } = run_board_tick

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
	read_closed: async (issues) => await run_board_closed.read_all(issues),
	now: () => Date.now(),
	write: (frame) => process.stdout.write(frame),
	// No fallback: a terminal that opens no link, or a pipe, gets the bare number rather than a URL.
	link: (text, url) => terminalLink(text, url, { fallback: false }),
	is_tty: process.stdout.isTTY,
	on_exit,
	sleep: async (ms) => {
		await sleep(ms)
	},
}

// Every frame starts from the top of the alternate screen, erasing what the last one left below it, and
// ends on the line that says closing the screen leaves the run going (joshuafolkken/kit#3437) — only a
// screen a person can close says it.
function framed(ports: BoardPorts, screen: Screen, words: Words): BoardPorts {
	const footer = `\n${styleText('dim', words.keeps_running)}\n`

	return {
		...ports,
		write: (frame) => {
			ports.write(`${screen.frame}${frame}${footer}`)
		},
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

async function redraw_forever(ports: BoardPorts, words: Words): Promise<void> {
	// The plan is read in the background, so the first frame is drawn without waiting on GitHub
	// (joshuafolkken/kit#3455).
	let state = await tick(FRESH_STATE, ports, words, 'background')

	for (;;) {
		// eslint-disable-next-line no-await-in-loop -- polling: each redraw waits out the tick before it
		await ports.sleep(REDRAW_MS)
		// eslint-disable-next-line no-await-in-loop -- polling: each redraw folds the state the last one left
		state = await tick(state, ports, words, 'background')
	}
}

// A signal leaves through `on_exit`; a failed redraw leaves before its error is printed, so the error
// lands on the normal screen rather than vanishing with the alternate one.
async function watch(ports: BoardPorts, words: Words): Promise<void> {
	const screen = run_board_screen.screen_of('live')
	const leave = leaver(ports, screen)

	ports.write(screen.enter)
	ports.on_exit(leave)

	try {
		await redraw_forever(framed(ports, screen, words), words)
	} finally {
		leave()
	}
}

async function run(argv: ReadonlyArray<string>, ports: BoardPorts = LIVE_PORTS): Promise<number> {
	const is_once = argv[0] === ONCE_FLAG

	if (argv.length > (is_once ? 1 : 0)) {
		process.stderr.write(`${USAGE}\n`)

		return FAILURE_EXIT_CODE
	}

	const words = run_board_labels.words_of(session_language.resolve_session_lang().lang)

	const mode = run_board_screen.mode_of({ is_tty: ports.is_tty, is_once })

	// One plain frame stays on the terminal after the command, so it draws the still icons rather than a
	// spinner frame frozen mid-turn (joshuafolkken/kit#3452).
	const once_ports = { ...ports, is_tty: false }

	await (mode === 'live' ? watch(ports, words) : tick(FRESH_STATE, once_ports, words))

	return SUCCESS_EXIT_CODE
}

const run_board_cli = { run }

// `.env` is read inside the guard, as `run:event --watch` reads it, so the board draws in the
// `JOSH_SESSION_LANG` a person keeps there while the unit tests see no developer's `.env`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	josh_environment_file.load_environment_file()
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

export { run_board_cli }
