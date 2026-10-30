import { setTimeout as sleep } from 'node:timers/promises'
import { styleText } from 'node:util'
import { poll } from '#scripts/lib/poll'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_progress } from '#scripts/run/progress/run-progress'
import { run_progress_read } from '#scripts/run/progress/run-progress-read'
import terminalLink from 'terminal-link'
import { run_board_closed } from './run-board-closed'
import { run_board_every } from './run-board-every'
import { run_board_fold } from './run-board-fold'
import { run_board_gather } from './run-board-gather'
import { run_board_gather_live } from './run-board-gather-live'
import { run_board_gather_thread } from './run-board-gather-thread'
import { run_board_keys, type KeyReading } from './run-board-keys'
import { run_board_labels } from './run-board-labels'
import { run_board_plan_shared } from './run-board-plan-shared'
import { run_board_screen, type Screen } from './run-board-screen'
import { run_board_snapshot } from './run-board-snapshot'
import { run_board_spin } from './run-board-spin'
import type { BoardPorts } from './run-board-state'
import { run_board_thanks_read } from './run-board-thanks-read'
import { run_board_tick } from './run-board-tick'

// `josh run:board` — a full-screen board of the running `backlogrun`, redrawn once a second, its
// spinners turned between redraws, for a person to keep open beside the run. What one redraw reads,
// and how often each read is taken, is `run-board-tick.ts`'s; this file wires the live reads and the
// terminal around it. A run that ended stays on screen until the next one starts; with no run in this
// checkout it reads nothing from GitHub and waits.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ONCE_FLAG = '--once'
const CHAT_FLAG = '--chat'
const EVERY_FLAG = '--every'
const FLAGS: ReadonlySet<string> = new Set(['', ONCE_FLAG, CHAT_FLAG])
const SIGINT_EXIT_CODE = 130
const SIGTERM_EXIT_CODE = 143
const USAGE = 'Usage: josh run:board [--once | --chat | --every <minutes>]'
const DISABLED_NOTICE = `\`${run_progress.DISABLED_KEY}=${run_progress.DISABLED_VALUE}\` is set, so no progress is pushed.`
const TRAILING_NEWLINE = /\n$/u
const { FRESH_STATE, tick } = run_board_tick
const { WORDS } = run_board_labels

// A signal exits with its conventional code, so the `exit` handler restores the screen on every path.
function on_exit(leave: () => void): void {
	process.once('exit', leave)
	process.once('SIGINT', () => process.exit(SIGINT_EXIT_CODE))
	process.once('SIGTERM', () => process.exit(SIGTERM_EXIT_CODE))
}

const LIVE_PORTS: Omit<BoardPorts, 'gather'> = {
	read_plan: async (scope) => await run_board_plan_shared.read(scope),
	read_closed: async (issues) => await run_board_closed.read_all(issues),
	snapshot: run_board_snapshot.file_store(),
	read_thanks: async () => await run_board_thanks_read.read_thanks(),
	now: () => Date.now(),
	write: (frame) => process.stdout.write(frame),
	// No fallback: a terminal that opens no link, or a pipe, gets the bare number rather than a URL.
	link: (text, url) => terminalLink(text, url, { fallback: false }),
	is_tty: process.stdout.isTTY,
	// Read on every redraw, so a resized pane is fitted on the next one.
	size: () => ({ rows: process.stdout.rows, columns: process.stdout.columns }),
	form: 'screen',
	keys: {
		is_tty: process.stdin.isTTY,
		raw: (is_raw) => {
			process.stdin.setRawMode(is_raw)
		},
		listen: (on_data) => {
			process.stdin.setEncoding('utf8').on('data', on_data).resume()
		},
		// Stops reading, so stdin no longer holds the process open.
		close: () => {
			process.stdin.pause()
		},
		interrupt: () => process.exit(SIGINT_EXIT_CODE),
	},
	mark: async () => {
		run_progress_read.mark(await run_progress_read.stamp_target(), Date.now())
	},
	push: async (frame) => {
		await telegram_notify.progress(frame)
	},
	on_exit,
	sleep: async (ms) => {
		await sleep(ms)
	},
}

// A live board reads on its worker thread, so no read stops its spinner; a single frame has no spinner
// to stop, and reads where it draws.
function live_ports(is_live: boolean): BoardPorts {
	const gather = is_live
		? run_board_gather_thread.worker_gatherer()
		: run_board_gather.frame_gatherer(run_board_gather_live.ports_of(false))

	return { ...LIVE_PORTS, gather }
}

// Every frame starts from the top of the alternate screen, erasing what the last one left below it, and
// ends on the line that says closing the screen leaves the run going — only a screen a person can
// close says it, and it is the first line to give way to a short pane. Nothing follows the last line,
// so a frame that fills the pane never scrolls the header off the top.
// The keys are named under it where a person can type them.
function framed(ports: BoardPorts, screen: Screen): BoardPorts {
	const keys = ports.folded === undefined ? [] : [run_board_fold.KEYS_LINE]

	return {
		...ports,
		footer: ['', ...[WORDS.keeps_running, ...keys].map((line) => styleText('dim', line))],
		write: (frame) => {
			ports.write(`${screen.frame}${frame.replace(TRAILING_NEWLINE, '')}`)
		},
	}
}

// Leaves the alternate screen once, whichever path gets there first: a second leave would restore the
// cursor saved on entering and draw over whatever was printed after the first. The terminal leaves raw
// mode with it.
function leaver(ports: BoardPorts, screen: Screen, keys: KeyReading): () => void {
	let has_left = false

	return () => {
		if (has_left) return
		has_left = true
		keys.stop?.()
		ports.write(screen.leave)
	}
}

// A frame on the second, its spinners turned until the next: the turns are
// written past the frame's own control bytes, each to its spot on the screen the frame drew.
async function redraw_forever(ports: BoardPorts, screen: Screen): Promise<void> {
	const drawn = framed(ports, screen)
	// The plan is read in the background, so the first frame is drawn without waiting on GitHub.
	let state = FRESH_STATE

	await poll.wait_for(
		async () => {
			// eslint-disable-next-line require-atomic-updates -- poll awaits each callback before starting the next tick
			state = await tick(state, drawn, 'background')
		},
		{
			interval_ms: run_board_spin.REDRAW_MS,
			sleeper: async () => {
				await run_board_spin.spin_to_second(state.spots, ports)
			},
		},
	)
}

// A signal leaves through `on_exit`; a failed redraw leaves before its error is printed, so the error
// lands on the normal screen rather than vanishing with the alternate one.
async function watch(ports: BoardPorts): Promise<void> {
	const screen = run_board_screen.screen_of('live')
	const keys = run_board_keys.read_keys(ports.keys)
	const leave = leaver(ports, screen, keys)

	ports.write(screen.enter)
	ports.on_exit(leave)

	try {
		await redraw_forever({ ...ports, folded: keys.folded }, screen)
	} finally {
		leave()
	}
}

// The answer to a progress question asked during a `backlogrun`: one frame in the chat's form,
// recorded as the report it is, so the next scheduled one waits a full interval — as
// `run:progress --once` does.
async function answer(ports: BoardPorts): Promise<void> {
	const { text } = await run_board_every.chat_frame(ports)

	ports.write(text)
	await ports.mark()
}

function refuse(): number {
	process.stderr.write(`${USAGE}\n`)

	return FAILURE_EXIT_CODE
}

// `--every <minutes>`: the chat frame pushed off-screen each interval until the
// run ends — started only because a person asked, so the heartbeat's no-Telegram rule is untouched.
async function push_every(minutes: string | undefined, ports: BoardPorts): Promise<number> {
	const interval = run_progress.minutes_from(minutes)

	if (interval === undefined) return refuse()

	if (run_progress.is_disabled()) {
		process.stderr.write(`${DISABLED_NOTICE}\n`)

		return SUCCESS_EXIT_CODE
	}

	await run_board_every.push_until_ended(ports, interval * MS_PER_MINUTE)

	return SUCCESS_EXIT_CODE
}

// The ports a test hands in, else the live ones.
function ports_for(ports: BoardPorts | undefined, is_live: boolean): BoardPorts {
	return ports ?? live_ports(is_live)
}

async function draw(flag: string, ports: BoardPorts | undefined): Promise<void> {
	if (flag === CHAT_FLAG) {
		await answer(ports_for(ports, false))

		return
	}

	const { is_tty } = ports ?? LIVE_PORTS
	const mode = run_board_screen.mode_of({ is_tty, is_once: flag === ONCE_FLAG })

	if (mode === 'live') {
		await watch(ports_for(ports, true))

		return
	}

	// One plain frame stays on the terminal after the command, so it draws the still icons rather than a
	// spinner frame frozen mid-turn.
	await tick(FRESH_STATE, { ...ports_for(ports, false), is_tty: false, size: undefined })
}

function is_every(flag: string, rest: ReadonlyArray<string>): boolean {
	return flag === EVERY_FLAG && rest.length === 1
}

function is_refused(flag: string, rest: ReadonlyArray<string>): boolean {
	return rest.length > 0 || !FLAGS.has(flag)
}

async function run(argv: ReadonlyArray<string>, ports?: BoardPorts): Promise<number> {
	const [flag = '', ...rest] = argv

	if (is_every(flag, rest)) return await push_every(rest[0], ports_for(ports, false))
	if (is_refused(flag, rest)) return refuse()

	await draw(flag, ports)

	return SUCCESS_EXIT_CODE
}

const run_board_cli = { DISABLED_NOTICE, USAGE, run }

export { run_board_cli }
