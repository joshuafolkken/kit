import { setTimeout as sleep } from 'node:timers/promises'
import { styleText } from 'node:util'
import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { poll } from '#scripts/lib/poll'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_progress } from '#scripts/run/progress/run-progress'
import { run_progress_read } from '#scripts/run/progress/run-progress-read'
import terminalLink from 'terminal-link'
import { run_board_closed } from './run-board-closed'
import { run_board_every } from './run-board-every'
import { run_board_fold } from './run-board-fold'
import { run_board_fold_store } from './run-board-fold-store'
import { run_board_frame_store } from './run-board-frame-store'
import { run_board_gather } from './run-board-gather'
import { run_board_gather_live } from './run-board-gather-live'
import { run_board_gather_thread } from './run-board-gather-thread'
import { run_board_intro } from './run-board-intro'
import { run_board_issue_count } from './run-board-issue-count'
import { run_board_keys, type KeyReading } from './run-board-keys'
import { run_board_labels } from './run-board-labels'
import { run_board_plan_shared } from './run-board-plan-shared'
import type { GithubRateLimit } from './run-board-render-quota-github'
import { run_board_screen, type Screen } from './run-board-screen'
import { run_board_snapshot } from './run-board-snapshot'
import { run_board_spin } from './run-board-spin'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_thanks_read } from './run-board-thanks-read'
import { run_board_theme, type Theme } from './run-board-theme'
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
const FRESH_FLAG = '--fresh'
const FLAGS: ReadonlySet<string> = new Set(['', ONCE_FLAG, CHAT_FLAG])
const PASSED_ON_FLAGS: ReadonlySet<string> = new Set([CHAT_FLAG, EVERY_FLAG])
const SIGINT_EXIT_CODE = 130
const SIGTERM_EXIT_CODE = 143
const USAGE =
	'Usage: josh run:board [--once | --chat [--fresh] | --every <minutes>] [--theme wargames]'
const DISABLED_NOTICE = `\`${run_progress.DISABLED_KEY}=${run_progress.DISABLED_VALUE}\` is set, so no progress is pushed.`
const TRAILING_NEWLINE = /\n$/u
const { FRESH_STATE, tick } = run_board_tick

type Reveal = (frame: string) => Promise<void>
const { CHAT_KEY, fresh } = run_board_frame_store
const { WORDS } = run_board_labels

// A signal exits with its conventional code, so the `exit` handler restores the screen on every path.
function on_exit(leave: () => void): void {
	process.once('exit', leave)
	process.once('SIGINT', () => process.exit(SIGINT_EXIT_CODE))
	process.once('SIGTERM', () => process.exit(SIGTERM_EXIT_CODE))
}

// The allowances with the session's transport, which the github row marks with ▶. The transport is
// read without a probe, so the board spends none of the GraphQL allowance it draws; one not known
// yet (or an invalid setting) leaves the allowances unmarked.
async function read_rate_limit_with_transport(): Promise<GithubRateLimit | undefined> {
	const resources = await gh_core_rate_limit.read_resources()
	if (resources === undefined) return undefined

	return { ...resources, transport: await git_gh_transport.known() }
}

const LIVE_PORTS: Omit<BoardPorts, 'gather'> = {
	read_plan: async (scope) => await run_board_plan_shared.read(scope),
	read_closed: async (issues) => await run_board_closed.read_all(issues),
	snapshot: run_board_snapshot.file_store(),
	read_thanks: async () => await run_board_thanks_read.read_thanks(),
	read_rate_limit: read_rate_limit_with_transport,
	read_issue_count: async (repo) => await run_board_issue_count.read_issue_count(repo),
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
		store: run_board_fold_store.file_store(),
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
	intro_sleep: async (ms) => {
		await sleep(ms)
	},
}

// A live board reads on its worker thread, so no read stops its spinner; a single frame has no spinner
// to stop, and reads where it draws.
function live_ports(is_live: boolean): BoardPorts {
	const gather = is_live
		? run_board_gather_thread.worker_gatherer()
		: run_board_gather.frame_gatherer(run_board_gather_live.ports_of(false))

	// Kept off `LIVE_PORTS`, so the profile that spreads them always reads from scratch.
	return { ...LIVE_PORTS, gather, frames: run_board_frame_store.file_store() }
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

// A tick whose frame is held off the screen, then revealed before it returns, so no spinner turns until
// every line is out.
async function revealed_tick(
	state: BoardState,
	ports: BoardPorts,
	screen: Screen,
	reveal: Reveal,
): Promise<BoardState> {
	const held: Array<string> = []
	const holding = framed(
		{
			...ports,
			write: (frame) => {
				held.push(frame)
			},
		},
		screen,
	)
	const next = await tick(state, holding, 'background')

	await reveal(held.join(''))

	return next
}

// A tick drawing each frame, the plan read in the background so the first is drawn without waiting on
// GitHub. Where the board reveals, the first frame is revealed; every later one is written as drawn.
function ticker(
	ports: BoardPorts,
	screen: Screen,
	reveal: Reveal | undefined,
): (state: BoardState) => Promise<BoardState> {
	let opening = reveal

	return async (state) => {
		const revealing = opening

		opening = undefined
		if (revealing === undefined) return await tick(state, framed(ports, screen), 'background')

		return await revealed_tick(state, ports, screen, revealing)
	}
}

// A frame on the second, its spinners turned until the next: the turns are
// written past the frame's own control bytes, each to its spot on the screen the frame drew.
async function redraw_forever(
	ports: BoardPorts,
	screen: Screen,
	reveal: Reveal | undefined,
): Promise<void> {
	const step = ticker(ports, screen, reveal)
	let state = FRESH_STATE

	await poll.wait_for(
		async () => {
			// eslint-disable-next-line require-atomic-updates -- poll awaits each callback before starting the next tick
			state = await step(state)
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
// lands on the normal screen rather than vanishing with the alternate one. A board in a theme reveals
// its first frame a line at a time; one in none draws it whole.
async function watch(ports: BoardPorts, theme: Theme | undefined): Promise<void> {
	const screen = run_board_screen.screen_of('live')
	const keys = run_board_keys.read_keys(ports.keys)
	const leave = leaver(ports, screen, keys)

	const reveal: Reveal | undefined =
		theme === undefined
			? undefined
			: async (frame) => {
					await run_board_intro.reveal(frame, ports, keys)
				}

	ports.write(screen.enter)
	ports.on_exit(leave)
	const gather = run_board_intro.after(ports.gather, run_board_intro.play(ports, keys))

	try {
		await redraw_forever({ ...ports, gather, folded: keys.folded }, screen, reveal)
	} finally {
		leave()
	}
}

// A chat frame read from scratch, kept so the next question within a minute is answered from it; dated
// when the read began, so its age is never understated.
async function read_chat(ports: BoardPorts): Promise<string> {
	const saved_ms = ports.now()
	const { text } = await run_board_every.chat_frame(ports)

	ports.frames?.save(CHAT_KEY, { text, saved_ms })

	return text
}

// The answer to a progress question asked during a `backlogrun`, `fullrun` or `halfrun`: one frame in the chat's form,
// recorded as the report it is, so the next scheduled one waits a full interval — as
// `run:progress --once` does. A frame recorded within the minute is the answer, read nothing.
async function answer(ports: BoardPorts): Promise<void> {
	const text = fresh(ports.frames, CHAT_KEY, ports.now()) ?? (await read_chat(ports))

	ports.write(text)
	await ports.mark()
}

// One plain frame stays on the terminal after the command, so it draws the still icons rather than a
// spinner frame frozen mid-turn; a frame recorded within the minute is the answer, read nothing.
async function still(ports: BoardPorts, theme: Theme | undefined): Promise<void> {
	const key = run_board_frame_store.once_key(theme, ports.is_tty)
	const now_ms = ports.now()
	const recorded = fresh(ports.frames, key, now_ms)

	if (recorded !== undefined) {
		ports.write(recorded)

		return
	}

	const write = run_board_frame_store.recording(ports.write, ports.frames, key, now_ms)
	const themed = run_board_theme.themed({ ...ports, write }, theme)

	await tick(FRESH_STATE, { ...themed, is_tty: false, size: undefined })
}

function refuse(note = ''): number {
	process.stderr.write(`${note}${USAGE}\n`)

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

// A board a person watches, in the theme; the chat's frame and `--every`'s are passed on as they are,
// so they never take it.
async function draw(flag: string, ports: BoardPorts | undefined, theme?: Theme): Promise<void> {
	if (flag === CHAT_FLAG) {
		await answer(ports_for(ports, false))

		return
	}

	const { is_tty } = ports ?? LIVE_PORTS
	const mode = run_board_screen.mode_of({ is_tty, is_once: flag === ONCE_FLAG })
	const board = ports_for(ports, mode === 'live')

	if (mode === 'live') {
		await watch(run_board_theme.themed(board, theme), theme)

		return
	}

	await still(board, theme)
}

function is_every(flag: string, rest: ReadonlyArray<string>): boolean {
	return flag === EVERY_FLAG && rest.length === 1
}

function is_fresh_chat(flag: string, rest: ReadonlyArray<string>): boolean {
	return flag === CHAT_FLAG && rest.length === 1 && rest[0] === FRESH_FLAG
}

// `--chat --fresh` reads from scratch past the record and still records — as the hand-off asks right
// after a merge, when a record up to a minute old could still show the merged child in flight.
function chat_ports(
	flag: string,
	rest: ReadonlyArray<string>,
	ports: BoardPorts | undefined,
): BoardPorts | undefined {
	if (!is_fresh_chat(flag, rest)) return ports
	const board = ports_for(ports, false)

	return { ...board, frames: run_board_frame_store.save_only(board.frames) }
}

function is_refused(flag: string, rest: ReadonlyArray<string>): boolean {
	return (rest.length > 0 && !is_fresh_chat(flag, rest)) || !FLAGS.has(flag)
}

// `--chat` and `--every` never take the theme, so a `JOSH_BOARD_THEME` naming none never refuses them.
function theme_environment(argv: ReadonlyArray<string>): NodeJS.ProcessEnv {
	return argv.some((argument) => PASSED_ON_FLAGS.has(argument)) ? {} : process.env
}

async function run(argv: ReadonlyArray<string>, ports?: BoardPorts): Promise<number> {
	const environment = theme_environment(argv)
	const choice = run_board_theme.choose(argv, environment)

	if (choice === undefined) return refuse(run_board_theme.refusal(argv, environment))
	const [flag = '', ...rest] = choice.argv

	if (is_every(flag, rest)) return await push_every(rest[0], ports_for(ports, false))
	if (is_refused(flag, rest)) return refuse()

	await draw(flag, chat_ports(flag, rest, ports), choice.theme)

	return SUCCESS_EXIT_CODE
}

const run_board_cli = { DISABLED_NOTICE, LIVE_PORTS, USAGE, run }

export { run_board_cli }
