import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { lane_environment } from '#scripts/lane/lane-environment'
import { run_board_demo_keys } from './run-board-demo-keys'
import { run_board_keys, type KeyInput, type KeyReading } from './run-board-keys'
import { run_board_live_sound } from './run-board-live-sound'
import { run_board_repaint } from './run-board-repaint'
import type { CueName } from './run-board-sound-cues'
import type { BoardPorts } from './run-board-state'
import type { Theme } from './run-board-theme-defs'
import { run_board_theme_events } from './run-board-theme-events'
import type { DemoKey } from './run-board-theme-host-sample'
import {
	run_board_theme_run,
	type PlayingPart,
	type ThemeRun,
	type ThemeValue,
} from './run-board-theme-run'

// The keys of a themed live board (joshuafolkken/kit#8917, Issue 4-3 and 4-4): any key skips the
// opening to the board; Ctrl-C plays the ending, and any key during it — Ctrl-C too — leaves at once;
// `/` toggles demo mode, whose footer names the work picked and its keys in place of the legend
// (`run-board-demo-footer.ts`). In demo mode `0`-`7` pick the work, `s` `a` `d`
// `w` play IDLE, PROGRESS, ROW and NOTICE from the demo's sample texts, `q` and `e` the opening and the
// ending, and every other key — the folds, the sound switch — is taken by it. Leaving it after a switch
// keeps the new theme and saves it as `JOSH_BOARD_THEME` in `.env`, that line alone.

const { DEMO_KEY, EVENT_OF_KEY, PART_OF_KEY } = run_board_demo_keys
const THEME_ENV = 'JOSH_BOARD_THEME'
const DIGIT = /^\d$/u
const NOTICE_EVENT: DemoKey = 'n'
const NOTICE_CUE: CueName = 'alert'
const { THEME_VALUES, play_part, take_keys, tick_at } = run_board_theme_run

// The clock and pauses the keys time the ending by, where a switched theme is saved, the cue demo
// mode's NOTICE sounds, and the keys as read, whose sound switch gates a skipped opening's close.
interface ThemeKeyPorts {
	now: () => number
	sleep: (ms: number) => Promise<void>
	save: (value: ThemeValue) => void
	cue?: (name: CueName) => void
	keys?: () => KeyReading | undefined
}

// The keys as read, once `read_keys` has returned them; the claim and the quitter are made before.
interface KeyHolder {
	keys: KeyReading | undefined
}

type DemoPress = (run: ThemeRun, key: string, now_ms: number) => boolean

// `0`-`7`: the work switched to, on its idle board.
function demo_value(run: ThemeRun, key: string): boolean {
	const value = DIGIT.test(key) ? THEME_VALUES[Number(key)] : undefined

	if (value === undefined) return false
	run.value = value
	run.part = undefined
	if (run.demo !== undefined) run.demo.timeline = run_board_theme_run.IDLE

	return true
}

// `s` `a` `d` `w`: the demo's event started on this tick, over the lane's own row text for a ROW.
function demo_event(run: ThemeRun, key: string, now_ms: number): boolean {
	const event = EVENT_OF_KEY.get(key)

	if (event === undefined || run.demo === undefined) return false
	const row_text = run.built?.layout.row_text ?? ''

	run.demo.timeline = run_board_theme_events.demo_timeline(event, row_text, tick_at(run, now_ms))
	run.part = undefined

	return true
}

// `q` `e`: the opening or the ending from now.
function demo_part(run: ThemeRun, key: string, now_ms: number): boolean {
	const name = PART_OF_KEY.get(key)

	if (name === undefined) return false
	play_part(run, name, now_ms, true)

	return true
}

const DEMO_PRESSES: ReadonlyArray<DemoPress> = [demo_value, demo_event, demo_part]

// Whether a demo key did something; any other key is taken and does nothing.
function press_demo(run: ThemeRun, key: string, now_ms: number): boolean {
	return DEMO_PRESSES.some((press) => press(run, key, now_ms))
}

// The shown theme, none in no theme.
function theme_of(run: ThemeRun): Theme | undefined {
	return run.value === '' ? undefined : run.value
}

// Demo mode left: a switched theme saved, the demo's sound ended with its effect.
function leave(run: ThemeRun, ports: ThemeKeyPorts): void {
	const switched = run_board_theme_run.leave_demo(run)

	run_board_live_sound.hush()
	if (switched !== undefined) ports.save(switched)
}

// The cue a real notice sounds as it shows (`run-board-cue-decision.ts`), sounded as the demo's NOTICE
// starts — its sample is a red gate's alert — under the same sound switch; only in no theme, a theme's
// NOTICE sounding its own score instead (joshuafolkken/kit#8917).
function cued(run: ThemeRun, key: string, ports: ThemeKeyPorts): void {
	if (run.demo === undefined || run.value !== '') return
	if (EVENT_OF_KEY.get(key) === NOTICE_EVENT) ports.cue?.(NOTICE_CUE)
}

// The sound of what a demo key replaced (`before`) ended: an opening (`q`'s) it cut to the board
// skipped, closed by its last sound as the launch's is; anything else silenced.
function replaced(
	run: ThemeRun,
	before: PlayingPart | undefined,
	keys: KeyReading | undefined,
): void {
	if (before?.name === 'opening' && run.part === undefined) {
		run_board_live_sound.skipped(keys, theme_of(run))
	} else run_board_live_sound.hush()
}

// A key in demo mode played: the board redrawn at once, so its footer names what the key picked on the
// frame it starts on — a work or what plays on it alike; the sound of the effect it replaces ended, and
// the cue of the event it starts sounded.
function pressed(run: ThemeRun, key: string, ports: ThemeKeyPorts): void {
	const before = run.part

	if (!press_demo(run, key, ports.now())) return
	run_board_theme_run.switched(run)
	replaced(run, before, ports.keys?.())
	cued(run, key, ports)
}

// Each key in demo mode, in the order typed; `/` leaves it, dropping the keys after it.
function demo_chunk(run: ThemeRun, chunk: string, ports: ThemeKeyPorts): void {
	for (const key of chunk) {
		if (key === DEMO_KEY) {
			leave(run, ports)

			return
		}

		pressed(run, key, ports)
	}
}

// The board's keys' claim: `/` enters demo mode and takes every key after it until it leaves.
function claim_of(
	run: ThemeRun,
	holder: KeyHolder,
	ports: ThemeKeyPorts,
): (chunk: string) => boolean {
	return (chunk) => {
		if (!chunk.includes(DEMO_KEY)) return false
		run_board_theme_run.enter_demo(run)
		run_board_live_sound.hush()
		take_keys(run, holder.keys?.intercept, (keys = '') => {
			demo_chunk(run, keys, ports)
		})

		return true
	}
}

// The launch's opening skipped by any key: its sound cut and closed by its last sound, as the board
// shows. One playing through ends by `end_part`, which gives the keys back, so it never closes twice.
function skip_opening(run: ThemeRun, holder: KeyHolder): void {
	if (run.part?.name !== 'opening') return
	take_keys(run, holder.keys?.intercept, () => {
		run_board_theme_run.end_part(run)
		run_board_live_sound.skipped(holder.keys, theme_of(run))
	})
}

// `interrupt` called once, however many paths reach it.
function once(interrupt: () => void): () => void {
	let has_run = false

	return () => {
		if (has_run) return
		has_run = true
		interrupt()
	}
}

// The ending played to its end, a key ending it sooner; none to play leaves at once.
async function play_ending(
	run: ThemeRun,
	holder: KeyHolder,
	ports: ThemeKeyPorts,
	done: () => void,
): Promise<void> {
	const ending_ms = run_board_theme_run.part_ms(run, 'ending')

	if (ending_ms <= 0) {
		done()

		return
	}

	play_part(run, 'ending', ports.now())
	take_keys(run, holder.keys?.intercept, done)
	await ports.sleep(ending_ms)
	done()
}

// The keyboard with Ctrl-C's first press playing the ending; a second leaves at once, and the board
// leaves once however many paths reach it.
function ending_input(
	input: KeyInput | undefined,
	run: ThemeRun,
	holder: KeyHolder,
	ports: ThemeKeyPorts,
): KeyInput | undefined {
	if (input === undefined) return undefined
	const done = once(input.interrupt)
	let is_quitting = false

	return {
		...input,
		interrupt: () => {
			const is_first = !is_quitting

			is_quitting = true
			if (is_first) void play_ending(run, holder, ports, done)
			else done()
		},
	}
}

// The `.env` kit reads its environment from: the working directory's.
function environment_file(): string {
	return path.join(process.cwd(), '.env')
}

// `JOSH_BOARD_THEME=<value>` written into `file`, its line replaced or added, no other line touched;
// none (`0`) is an empty value.
function save_theme(value: ThemeValue, file: string = environment_file()): void {
	const content = existsSync(file) ? readFileSync(file, 'utf8') : ''

	writeFileSync(file, lane_environment.upsert_assignment(content, THEME_ENV, value))
}

// A switched theme saved; a `.env` that cannot be written leaves the board running on it unsaved.
function saved(value: ThemeValue): void {
	try {
		save_theme(value)
	} catch {
		// The next launch starts in the theme it was given, as it did before demo mode switched one.
	}
}

// The keys' cue, under the sound switch; read once the keys are, as a demo key is pressed.
function keys_cue(holder: KeyHolder): (name: CueName) => void {
	return (name) => {
		holder.keys?.cue?.(name)
	}
}

type ThemePorts = Pick<BoardPorts, 'keys' | 'cue' | 'typing_sound' | 'now' | 'sleep'>

// A theme run's keys read off the board's keyboard: the opening skipped by a key, Ctrl-C's ending and
// demo mode. Nothing is gated, as the ending is the theme layer's own frames; no last frame is kept for
// an exit wipe.
function read_theme_keys<Ports extends ThemePorts>(
	ports: Ports,
	run: ThemeRun,
	save: (value: ThemeValue) => void = saved,
): { keys: KeyReading; drawn: Ports; last: { text: string | undefined } } {
	const holder: KeyHolder = { keys: undefined }
	const key_ports = {
		now: ports.now,
		sleep: ports.sleep,
		save,
		cue: keys_cue(holder),
		keys: () => holder.keys,
	}
	const input = ending_input(ports.keys, run, holder, key_ports)

	holder.keys = run_board_keys.read_keys(input, {
		cue: ports.cue,
		trill: ports.typing_sound,
		claim: claim_of(run, holder, key_ports),
		redraw: () => {
			run_board_repaint.request(run.repaint)
		},
	})
	skip_opening(run, holder)

	return { keys: holder.keys, drawn: ports, last: { text: undefined } }
}

const run_board_theme_keys = {
	claim_of,
	ending_input,
	read_theme_keys,
	save_theme,
	skip_opening,
}

export { run_board_theme_keys }
export type { KeyHolder, ThemeKeyPorts }
