import { parseArgs } from 'node:util'
import { run_board_frame_preview, type FrameOptions } from './run-board-frame-preview'
import { run_board_icons, type Icons } from './run-board-icons'
import { run_board_live } from './run-board-live'
import { run_board_paint } from './run-board-paint'
import type { BoardPorts } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'

// The live board's drawing path replayed under a virtual clock, each beat it writes as one JSON `Beat`
// line (joshuafolkken/kit#8750). It reads the run once, as `--frame` does, and draws through the live
// `watch` on the `--frame` fixed ports: the theme's opening and `--ticks` redraws. Each sleep closes a
// beat and moves the clock on by its length, so one read and one `--at` write the same bytes; the theme
// host draws its randomness from the moment and the place (joshuafolkken/kit#8917), so `--seed` is
// taken and changes nothing.

// One write the replay records: its bytes and how long the screen holds them before the next.
interface Beat {
	text: string
	ms: number
}

const USAGE = `Usage: josh board:replay [--theme ${run_board_theme.THEMES.join('|')}] [--icons emoji|letters|shapes] [--seed <n>] [--at <epoch ms>] [--ticks <n>] [--mute] [--columns <n>] [--rows <n>]`
const OWN_OPTIONS = {
	seed: { type: 'string' },
	at: { type: 'string' },
	ticks: { type: 'string' },
} as const
const DEFAULT_SEED = 1
const DEFAULT_TICKS = 1
const COUNT = /^\d+$/u
const FAILURE_EXIT_CODE = 2
// Thrown from the redraw sleep once the asked redraws are drawn: the live board never returns on its own.
const REPLAY_END = new Error('replay end')
// The `FORCE_COLOR` level of 24-bit color, and the variables a replay sets for its run: the board's text
// is colored by what stdout answers (`run-board-paint.ts`), which a pipe or a file answers with none.
const RGB_COLOR_LEVEL = '3'
const FORCE_COLOR = 'FORCE_COLOR'
const NO_COLOR = 'NO_COLOR'

interface Counts {
	readonly seed: number
	readonly at_ms: number | undefined
	readonly ticks: number
}

interface ReplayOptions extends Counts {
	readonly frame: FrameOptions
	readonly theme: Theme | undefined
	readonly icons: Icons
}

interface Look {
	readonly theme: Theme | undefined
	readonly icons: Icons
	readonly argv: Array<string>
}

interface Recorder {
	readonly beats: Array<Beat>
	text: string
	now_ms: number
	ticks_left: number
}

type Token = NonNullable<ReturnType<typeof parseArgs>['tokens']>[number]

function written(token: Extract<Token, { kind: 'option' }>): string {
	return token.inlineValue === true ? `${token.rawName}=${token.value}` : token.rawName
}

// A token handed on to `--frame`'s options as it was written; the replay's own ones are kept back.
function passed(token: Token): Array<string> {
	if (token.kind === 'positional') return [token.value]
	if (token.kind !== 'option' || Object.hasOwn(OWN_OPTIONS, token.name)) return []

	return [written(token)]
}

// A count as written; NaN for a value that is none, undefined where the flag is not given.
function count_of(value: string | boolean | undefined): number | undefined {
	if (value === undefined) return undefined

	return typeof value === 'string' && COUNT.test(value) ? Number(value) : NaN
}

function counted(values: Partial<Record<keyof typeof OWN_OPTIONS, string | boolean>>): Counts {
	return {
		seed: count_of(values.seed) ?? DEFAULT_SEED,
		at_ms: count_of(values.at),
		ticks: count_of(values.ticks) ?? DEFAULT_TICKS,
	}
}

// The replay's own counts taken out of the arguments, the rest left for `--frame`'s options.
function split(argv: ReadonlyArray<string>): { counts: Counts; rest: Array<string> } {
	const { values, tokens } = parseArgs({
		args: [...argv],
		options: OWN_OPTIONS,
		strict: false,
		tokens: true,
	})

	return { counts: counted(values), rest: tokens.flatMap((token) => passed(token)) }
}

function is_refused(frame: FrameOptions, counts: Counts): boolean {
	return frame.cause !== undefined || Object.values(counts).some((count) => Number.isNaN(count))
}

// The theme and the icons the arguments, else the environment, name, as the live board takes them, with
// the arguments left; undefined where either names none.
function look_of(argv: ReadonlyArray<string>, environment: NodeJS.ProcessEnv): Look | undefined {
	const themed = run_board_theme.choose(argv, environment)

	if (themed === undefined) return undefined
	const drawn = run_board_icons.choose(themed.argv, environment, themed.theme)

	return drawn && { theme: themed.theme, icons: drawn.icons, argv: drawn.argv }
}

// The options the arguments name; undefined for an unknown theme, anything `--frame` refuses, a notice
// (the live board starts with none) or an own flag without a count.
function options_of(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
): ReplayOptions | undefined {
	const look = look_of(argv, environment)

	if (look === undefined) return undefined
	const { counts, rest } = split(look.argv)
	const frame = run_board_frame_preview.options_of(rest)

	if (frame === undefined || is_refused(frame, counts)) return undefined

	return { ...counts, frame, theme: look.theme, icons: look.icons }
}

// The beat open now closed after `ms`, the clock moved on by it.
function advanced(recorder: Recorder, ms: number): void {
	recorder.beats.push({ text: recorder.text, ms })
	recorder.text = ''
	recorder.now_ms += ms
}

async function redraw_sleep(recorder: Recorder, ms: number): Promise<void> {
	if (recorder.ticks_left <= 0) throw REPLAY_END
	recorder.ticks_left -= 1
	advanced(recorder, ms)
}

// Every clock the board reads on the recorder's virtual time.
function virtual_clock(recorder: Recorder): Pick<Required<BoardPorts>, 'now' | 'sleep'> {
	return {
		now: () => recorder.now_ms,
		sleep: async (ms) => {
			await redraw_sleep(recorder, ms)
		},
	}
}

function stay(): void {
	// The replay holds no exit handler: it ends when its redraws are drawn.
}

// The `--frame` fixed ports on the virtual clock, writing into the open beat, with no keys, exit
// handler or sound, in 24-bit color — a theme is drawn by its theme run only there
// (joshuafolkken/kit#8917), so a replay on any terminal draws the theme it names.
function replay_ports(ports: BoardPorts, options: ReplayOptions, recorder: Recorder): BoardPorts {
	function write(text: string): void {
		recorder.text += text
	}

	const fixed = run_board_frame_preview.fixed_ports(ports, options.frame, write, options.theme)

	return {
		...fixed,
		icons: options.icons,
		...virtual_clock(recorder),
		keys: undefined,
		on_exit: stay,
		typing_sound: undefined,
		color_depth: () => run_board_paint.RGB_COLOR_DEPTH,
	}
}

function restore(name: string, value: string | undefined): void {
	if (value === undefined) Reflect.deleteProperty(process.env, name)
	else process.env[name] = value
}

// joshuafolkken/kit#8917: `draw` run with stdout drawing 24-bit color, as the ports' `color_depth` says,
// the environment put back after. Every color the board paints — and the lamp panel a theme lays out
// by, drawn only where stdout draws color — reads stdout, so a replay written to a pipe or a file would
// otherwise draw its themed board in no color and no theme at all.
async function in_color<Result>(draw: () => Promise<Result>): Promise<Result> {
	const saved = { force: process.env[FORCE_COLOR], no: process.env[NO_COLOR] }

	process.env[FORCE_COLOR] = RGB_COLOR_LEVEL
	Reflect.deleteProperty(process.env, NO_COLOR)

	try {
		return await draw()
	} finally {
		restore(FORCE_COLOR, saved.force)
		restore(NO_COLOR, saved.no)
	}
}

// The beats the live board writes for one read: the opening, the reveal and the asked redraws, any
// bytes written after the last sleep as a closing beat that waits for nothing.
async function replay_in_color(ports: BoardPorts, options: ReplayOptions): Promise<Array<Beat>> {
	const read = await ports.gather('settled')
	const recorder: Recorder = {
		beats: [],
		text: '',
		now_ms: options.at_ms ?? ports.now(),
		ticks_left: options.ticks,
	}
	const replayed = replay_ports({ ...ports, gather: async () => read }, options, recorder)

	try {
		await run_board_live.watch(replayed, options.theme)
	} catch (error) {
		if (error !== REPLAY_END) throw error
	}

	return recorder.text === '' ? recorder.beats : [...recorder.beats, { text: recorder.text, ms: 0 }]
}

// A themed replay drawn in 24-bit color, wherever its stdout goes; one in no theme as stdout draws.
async function replay(ports: BoardPorts, options: ReplayOptions): Promise<Array<Beat>> {
	if (options.theme === undefined) return await replay_in_color(ports, options)

	return await in_color(async () => await replay_in_color(ports, options))
}

function lines_of(beats: ReadonlyArray<Beat>): string {
	return beats.map((beat) => `${JSON.stringify(beat)}\n`).join('')
}

async function run(argv: ReadonlyArray<string>, ports: BoardPorts): Promise<number> {
	const options = options_of(argv, process.env)

	if (options === undefined) {
		process.stderr.write(`${USAGE}\n`)

		return FAILURE_EXIT_CODE
	}

	process.stdout.write(lines_of(await replay(ports, options)))

	return 0
}

const run_board_replay = { lines_of, options_of, replay, run }

export { run_board_replay }
export type { Beat }
