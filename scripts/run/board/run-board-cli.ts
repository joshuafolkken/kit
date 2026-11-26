import { setTimeout as sleep } from 'node:timers/promises'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_progress } from '#scripts/run/progress/run-progress'
import { run_progress_read } from '#scripts/run/progress/run-progress-read'
import { run_board_data_ports } from './run-board-data-ports'
import { run_board_every } from './run-board-every'
import { run_board_exit_record } from './run-board-exit-record'
import { run_board_fold_store } from './run-board-fold-store'
import { run_board_frame_preview } from './run-board-frame-preview'
import { run_board_frame_store } from './run-board-frame-store'
import { run_board_gather } from './run-board-gather'
import { run_board_gather_live } from './run-board-gather-live'
import { run_board_gather_record } from './run-board-gather-record'
import { run_board_gather_thread } from './run-board-gather-thread'
import { run_board_heap } from './run-board-heap'
import { run_board_icons, type Icons } from './run-board-icons'
import { run_board_live } from './run-board-live'
import { run_board_saved_state } from './run-board-saved-state'
import { run_board_screen } from './run-board-screen'
import { run_board_sound_option } from './run-board-sound-option'
import { run_board_sound_player } from './run-board-sound-player'
import type { BoardPorts } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'
import { run_board_tick } from './run-board-tick'
import { run_board_timing } from './run-board-timing'
import { run_board_write_port } from './run-board-write-port'

// `josh run:board` — a full-screen board of the running `backlogrun`, redrawn once a second, its
// spinners turned between redraws, for a person to keep open beside the run. What one redraw reads,
// and how often each read is taken, is `run-board-tick.ts`'s; this file wires the live reads and the
// terminal around it. A run that ended stays on screen until the next one starts; with no run in this
// checkout it reads nothing from GitHub and waits.

// What a board a person sees is drawn with: its theme, its icons (`run-board-icons.ts`) and the
// launch's sound, none where the saved switch decides (`run-board-sound-option.ts`).
interface BoardLook {
	theme: Theme | undefined
	icons: Icons
	is_sound_on?: boolean | undefined
}

interface LookChoice {
	look: BoardLook
	argv: Array<string>
}

// The line said before the usage where the theme or the icons name none.
interface Refused {
	refusal: string
}

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ONCE_FLAG = '--once'
const CHAT_FLAG = '--chat'
const EVERY_FLAG = '--every'
const FRESH_FLAG = '--fresh'
const FLAGS: ReadonlySet<string> = new Set(['', ONCE_FLAG, CHAT_FLAG])
const PASSED_ON_FLAGS: ReadonlySet<string> = new Set([CHAT_FLAG, EVERY_FLAG])
const { SIGHUP_EXIT_CODE, SIGINT_EXIT_CODE, SIGTERM_EXIT_CODE } = run_board_exit_record
const { FRAME_FLAG, FRAME_USAGE } = run_board_frame_preview
const USAGE = `Usage: josh run:board [--once | --chat [--fresh] | --every <minutes> | ${FRAME_USAGE}] [--theme ${run_board_theme.THEMES.join('|')}] [--icons emoji|letters|shapes] [--sound on|off] [--timing]`
const DISABLED_NOTICE = `\`${run_progress.DISABLED_KEY}=${run_progress.DISABLED_VALUE}\` is set, so no progress is pushed.`
const { FRESH_STATE, tick } = run_board_tick
const { CHAT_KEY, fresh } = run_board_frame_store

// A signal exits with its conventional code, so the `exit` handler restores the screen on every path.
function on_exit(leave: () => void): void {
	process.once('exit', leave)
	process.once('SIGINT', () => process.exit(SIGINT_EXIT_CODE))
	process.once('SIGTERM', () => process.exit(SIGTERM_EXIT_CODE))
	// A closed terminal hangs the board up: it leaves through `exit` too, so its sounds end with it.
	process.once('SIGHUP', () => process.exit(SIGHUP_EXIT_CODE))
}

// A live board's worker thread takes the GitHub, roster and snapshot reads with its own copy of these
// (`run-board-gather-worker.ts`); a single frame takes them through these.
const LIVE_PORTS: Omit<BoardPorts, 'gather'> = {
	...run_board_data_ports.live(),
	now: () => Date.now(),
	...run_board_write_port.port_of(process.stdout),
	link: run_board_gather_record.link,
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
}

// A live board's worker gathers, its heap readable for `--timing` (`run-board-heap.ts`); a single
// frame gathers where it draws.
function gather_ports(
	is_live: boolean,
	look?: BoardLook,
): Pick<BoardPorts, 'gather' | 'worker_heap'> {
	if (!is_live) {
		return { gather: run_board_gather.frame_gatherer(run_board_gather_live.ports_of(false)) }
	}

	const { spawn, heap } = run_board_heap.tracked(
		run_board_gather_thread.spawner(run_board_gather_record.setup_of(look?.theme, look?.icons)),
	)
	const gather = run_board_gather_thread.worker_gatherer(
		spawn,
		Date.now,
		async () => await run_board_saved_state.for_run(run_board_saved_state.file_store()),
	)

	return { gather, worker_heap: heap }
}

// A live board reads and records its frames on its worker thread, so neither stops its spinner, and
// sounds its cues and the trill (joshuafolkken/kit#8250); a single frame has no spinner to stop, reads
// where it draws, and stays silent.
function live_ports(is_live: boolean, look?: BoardLook): BoardPorts {
	const cue = is_live ? run_board_sound_player.play_cue : undefined
	const typing_sound = is_live ? run_board_sound_option.typing_sound_of(look?.theme) : undefined

	// Kept off `LIVE_PORTS`, so the profile that spreads them always reads from scratch.
	return {
		...LIVE_PORTS,
		...gather_ports(is_live, look),
		cue,
		typing_sound,
		frames: run_board_frame_store.file_store(),
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
	const key = run_board_frame_store.once_key(theme, ports.is_tty, ports.icons)
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
function ports_for(ports: BoardPorts | undefined, is_live: boolean, look?: BoardLook): BoardPorts {
	return ports ?? live_ports(is_live, look)
}

// The ports a board a person sees is drawn through, carrying its icons.
function drawn_ports(ports: BoardPorts | undefined, is_live: boolean, look: BoardLook): BoardPorts {
	const drawn = { ...ports_for(ports, is_live, look), icons: look.icons }

	return run_board_sound_option.sounded(drawn, look.is_sound_on)
}

// A live board on the process's own ports records why it ends (`run-board-exit-record.ts`); one on a
// test's ports holds no process handler. It says its timing as it leaves its screen: `watch` only ever
// returns by throwing.
async function watch(
	ports: BoardPorts | undefined,
	look: BoardLook,
	is_timing: boolean,
): Promise<void> {
	const exits = ports === undefined ? run_board_exit_record.start() : undefined
	const live = drawn_ports(ports, true, look)
	const leaving = exits?.on_exit ?? live.on_exit
	const board = run_board_timing.timed({ ...live, on_exit: leaving }, is_timing)

	await run_board_exit_record.guarded(exits, async () => {
		await run_board_live.watch(board, look.theme, exits?.failed)
	})
}

async function draw_still(
	ports: BoardPorts | undefined,
	look: BoardLook,
	is_timing: boolean,
): Promise<void> {
	const board = run_board_timing.timed(drawn_ports(ports, false, look), is_timing)

	await still(board, look.theme)
	run_board_timing.say(board, is_timing)
}

// A board a person watches, in the theme; the chat's frame and `--every`'s are passed on as they are,
// so they never take it. With `--timing`, the phases are said once the board is done
// (`run-board-timing.ts`).
async function draw(
	flag: string,
	ports: BoardPorts | undefined,
	look: BoardLook,
	is_timing: boolean,
): Promise<void> {
	if (flag === CHAT_FLAG) {
		await answer(ports_for(ports, false))

		return
	}

	const { is_tty } = ports ?? LIVE_PORTS
	const mode = run_board_screen.mode_of({ is_tty, is_once: flag === ONCE_FLAG })

	if (mode === 'live') await watch(ports, look, is_timing)
	else await draw_still(ports, look, is_timing)
}

// `--frame`: one frame in the state its flags fix (`run-board-frame-preview.ts`), in the look asked for.
async function draw_frame(
	rest: ReadonlyArray<string>,
	ports: BoardPorts,
	look: BoardLook,
): Promise<number> {
	const options = run_board_frame_preview.options_of(rest)

	if (options === undefined) return refuse()
	await run_board_frame_preview.draw(ports, options, look.theme)

	return SUCCESS_EXIT_CODE
}

function is_every(flag: string, rest: ReadonlyArray<string>): boolean {
	return flag === EVERY_FLAG && rest.length === 1
}

// The modes that answer their own exit code — `--every` and `--frame` — else undefined.
async function own_answer(
	flag: string,
	rest: ReadonlyArray<string>,
	ports: BoardPorts | undefined,
	look: BoardLook,
): Promise<number | undefined> {
	if (is_every(flag, rest)) return await push_every(rest[0], ports_for(ports, false))
	if (flag === FRAME_FLAG) return await draw_frame(rest, drawn_ports(ports, false, look), look)

	return undefined
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

// `--chat` and `--every` never take the theme or the icons, so a `JOSH_BOARD_THEME` or a
// `JOSH_BOARD_ICONS` naming none never refuses them.
function theme_environment(argv: ReadonlyArray<string>): NodeJS.ProcessEnv {
	return argv.some((argument) => PASSED_ON_FLAGS.has(argument)) ? {} : process.env
}

// The theme and the icons the arguments, else the environment, name, with the arguments left; the
// refusal line where either names none.
function look_of(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
): LookChoice | Refused {
	const sounded = run_board_sound_option.split(argv)

	if (sounded === undefined) return { refusal: '' }
	const themed = run_board_theme.choose(sounded.argv, environment)

	if (themed === undefined) return { refusal: run_board_theme.refusal(sounded.argv, environment) }
	const drawn = run_board_icons.choose(themed.argv, environment, themed.theme)

	if (drawn === undefined) return { refusal: run_board_icons.refusal(themed.argv, environment) }
	const look = { theme: themed.theme, icons: drawn.icons, is_sound_on: sounded.is_on }

	return { look, argv: drawn.argv }
}

async function run(given: ReadonlyArray<string>, ports?: BoardPorts): Promise<number> {
	const { argv, is_timing } = run_board_timing.split(given)
	const choice = look_of(argv, theme_environment(argv))

	if ('refusal' in choice) return refuse(choice.refusal)
	const [flag = '', ...rest] = choice.argv

	const answered = await own_answer(flag, rest, ports, choice.look)

	if (answered !== undefined) return answered
	if (is_refused(flag, rest)) return refuse()

	await draw(flag, chat_ports(flag, rest, ports), choice.look, is_timing)

	return SUCCESS_EXIT_CODE
}

const run_board_cli = { DISABLED_NOTICE, LIVE_PORTS, USAGE, live_ports, run }

export { run_board_cli }
