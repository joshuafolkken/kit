#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { run_board_cli } from './run-board-cli'
import { run_board_frame_preview, type FrameOptions } from './run-board-frame-preview'
import type { IntroPorts } from './run-board-intro'
import { run_board_live } from './run-board-live'
import type { Beat } from './run-board-reveal-blocks'
import { run_board_seeded } from './run-board-seeded'
import type { BoardPorts } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'

// The live board's drawing path replayed under a virtual clock and a seeded random source, each beat
// it writes as one JSON `Beat` line (joshuafolkken/kit#8750). It reads the run once, as `--frame` does,
// and draws through the live `watch` on the `--frame` fixed ports: the opening, the reveal and `--ticks`
// redraws. Each sleep closes a beat and moves the clock on by its length, so one read, one `--at` and
// one `--seed` write the same bytes. The matrix rain draws from the seed.

const USAGE =
	'Usage: josh board:replay [--theme wargames|matrix|bttf] [--seed <n>] [--at <epoch ms>] [--ticks <n>] [--mute] [--columns <n>] [--rows <n>]'
const OWN_OPTIONS = {
	seed: { type: 'string' },
	at: { type: 'string' },
	ticks: { type: 'string' },
} as const
const DEFAULT_SEED = 1
const DEFAULT_TICKS = 1
const COUNT = /^\d+$/u
const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 2
// Thrown from the redraw sleep once the asked redraws are drawn: the live board never returns on its own.
const REPLAY_END = new Error('replay end')

interface Counts {
	readonly seed: number
	readonly at_ms: number | undefined
	readonly ticks: number
}

interface ReplayOptions extends Counts {
	readonly frame: FrameOptions
	readonly theme: Theme | undefined
}

interface Recorder {
	readonly beats: Array<Beat>
	text: string
	now_ms: number
	ticks_left: number
}

type Token = NonNullable<ReturnType<typeof parseArgs>['tokens']>[number]
type Rain = NonNullable<IntroPorts['rain']>

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

// The options the arguments name; undefined for an unknown theme, anything `--frame` refuses, a notice
// (the live board starts with none) or an own flag without a count.
function options_of(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
): ReplayOptions | undefined {
	const themed = run_board_theme.choose(argv, environment)

	if (themed === undefined) return undefined
	const { counts, rest } = split(themed.argv)
	const frame = run_board_frame_preview.options_of(rest)

	if (frame === undefined || is_refused(frame, counts)) return undefined

	return { ...counts, frame, theme: themed.theme }
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

function stay(): void {
	// The replay holds no exit handler: it ends when its redraws are drawn.
}

// The `--frame` fixed ports on the virtual clock, writing into the open beat, with no keys, exit
// handler or sound, the rain drawn from the seed.
function replay_ports(
	ports: BoardPorts,
	options: ReplayOptions,
	recorder: Recorder,
): BoardPorts & { rain: Rain } {
	function write(text: string): void {
		recorder.text += text
	}

	const fixed = run_board_frame_preview.fixed_ports(ports, options.frame, write, options.theme)

	return {
		...fixed,
		now: () => recorder.now_ms,
		intro_sleep: async (ms) => {
			advanced(recorder, ms)
		},
		sleep: async (ms) => {
			await redraw_sleep(recorder, ms)
		},
		keys: undefined,
		on_exit: stay,
		typing_sound: undefined,
		rain: { random: run_board_seeded.seeded(options.seed), is_colored: () => true },
	}
}

// The beats the live board writes for one read: the opening, the reveal and the asked redraws, any
// bytes written after the last sleep as a closing beat that waits for nothing.
async function replay(ports: BoardPorts, options: ReplayOptions): Promise<Array<Beat>> {
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET), run_board_cli.live_ports(false))
}

const run_board_replay = { lines_of, options_of, replay }

export { run_board_replay }
