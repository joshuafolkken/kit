#!/usr/bin/env tsx
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { board_compare_diff, type Divergence, type Mode } from './board-compare-diff'
import { board_compare_screen, type Size } from './board-compare-screen'
import { run_board_cli } from './run-board-cli'
import { run_board_replay } from './run-board-replay'
import type { Beat } from './run-board-reveal-blocks'

// `josh board:compare` (joshuafolkken/kit#8754): a theme demo and the live board replayed under one seed,
// both beat streams drawn through a terminal emulator and compared screen by screen at each moment
// either writes. A match prints 0 differences and exits 0; a divergence prints its first moment, how
// many cells differ and the first few, and exits 1.

const USAGE =
	'Usage: josh board:compare <demo.mjs> --theme <theme> [--scene <n>] [--seed <n>] [--steps <n>] [--loose] [--columns <n>] [--rows <n>]'
const OPTIONS = {
	theme: { type: 'string' },
	scene: { type: 'string', default: '1' },
	seed: { type: 'string', default: '1' },
	steps: { type: 'string', default: '40' },
	columns: { type: 'string', default: '120' },
	rows: { type: 'string', default: '40' },
	loose: { type: 'boolean', default: false },
} as const
const NO_BEATS =
	'board:compare — the demo wrote no beat lines: it needs the DEMO_BEATS=1 form (.claude/skills/board-theme/demo-template.md)'
const COUNT = /^\d+$/u
const ARGV_OFFSET = 2
const DIVERGED_EXIT_CODE = 1
const FAILURE_EXIT_CODE = 2
// The board's clock start (`board:replay --at`): fixed, as the demo's virtual clock is, so the time and
// date the board draws are the same every run.
const BOARD_CLOCK_START_MS = '0'
// Room for a demo's beats, which hold every frame's bytes.
const DEMO_BUFFER_BYTES = 268_435_456

interface CompareOptions {
	readonly demo: string
	readonly theme: string
	readonly scene: string
	readonly seed: string
	readonly steps: string
	readonly size: Size
	readonly mode: Mode
}

interface ComparePorts {
	// The demo's beats: the script run with `DEMO_BEATS=1`, its seed and step count, on the scene.
	// Undefined where the script writes something other than beat lines.
	readonly demo_beats: (options: CompareOptions) => Promise<Array<Beat> | undefined>
	// The live board's beats replayed by `board:replay`; undefined where it refuses the arguments.
	readonly board_beats: (argv: ReadonlyArray<string>) => Promise<Array<Beat> | undefined>
	readonly write: (text: string) => void
}

type Parsed = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>

function is_counted(values: Parsed['values']): boolean {
	return [values.seed, values.steps, values.columns, values.rows].every((value) =>
		COUNT.test(value),
	)
}

// The arguments parsed; undefined for an unknown flag or a flag without its value.
function parsed(argv: ReadonlyArray<string>): Parsed | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true })
	} catch {
		return undefined
	}
}

function options_from({ values, positionals }: Parsed): CompareOptions | undefined {
	const [demo] = positionals

	if (demo === undefined || values.theme === undefined || !is_counted(values)) return undefined

	return {
		demo,
		theme: values.theme,
		scene: values.scene,
		seed: values.seed,
		steps: values.steps,
		size: { columns: Number(values.columns), rows: Number(values.rows) },
		mode: values.loose ? 'loose' : 'strict',
	}
}

function options_of(argv: ReadonlyArray<string>): CompareOptions | undefined {
	const read = parsed(argv)

	return read && options_from(read)
}

// The replay's arguments: the same seed, as many redraws as the demo draws frames, the same screen.
function board_argv(options: CompareOptions): Array<string> {
	const { theme, seed, steps, size } = options

	return [
		'--theme',
		theme,
		'--seed',
		seed,
		'--at',
		BOARD_CLOCK_START_MS,
		'--ticks',
		steps,
		'--columns',
		String(size.columns),
		'--rows',
		String(size.rows),
	]
}

function report(divergence: Divergence | undefined): string {
	if (divergence === undefined) return 'board:compare — 0 differences\n'
	const head = `board:compare — diverged at ${String(divergence.at_ms)} ms: ${String(divergence.count)} differences`
	const samples = divergence.samples.map(
		(sample) => `  ${sample.where}: expected ${sample.expected} · actual ${sample.actual}`,
	)

	return `${[head, ...samples].join('\n')}\n`
}

async function compared(
	options: CompareOptions,
	expected: Array<Beat>,
	actual: Array<Beat>,
): Promise<Divergence | undefined> {
	const [left, right] = await Promise.all([
		board_compare_screen.shots_of(expected, options.size),
		board_compare_screen.shots_of(actual, options.size),
	])

	return board_compare_diff.first_divergence(left, right, options.mode)
}

// The report for two beat streams, or the refusal when the demo wrote no beats.
async function verdict(
	options: CompareOptions,
	ports: ComparePorts,
	actual: Array<Beat>,
): Promise<{ text: string; code: number }> {
	const expected = await ports.demo_beats(options)

	if (expected === undefined) return { text: `${NO_BEATS}\n`, code: FAILURE_EXIT_CODE }
	const divergence = await compared(options, expected, actual)

	return { text: report(divergence), code: divergence === undefined ? 0 : DIVERGED_EXIT_CODE }
}

async function compared_run(argv: ReadonlyArray<string>, ports: ComparePorts): Promise<number> {
	const options = options_of(argv)
	const actual = options && (await ports.board_beats(board_argv(options)))

	if (options === undefined || actual === undefined) {
		ports.write(`${USAGE}\n`)

		return FAILURE_EXIT_CODE
	}

	const { text, code } = await verdict(options, ports, actual)

	ports.write(text)

	return code
}

// A demo or replay that fails (a non-zero exit, a missing script) is a refusal, not a divergence.
async function run(argv: ReadonlyArray<string>, ports: ComparePorts): Promise<number> {
	try {
		return await compared_run(argv, ports)
	} catch (error) {
		ports.write(`board:compare — ${error instanceof Error ? error.message : String(error)}\n`)

		return FAILURE_EXIT_CODE
	}
}

function is_beat(value: unknown): value is Beat {
	if (typeof value !== 'object' || value === null) return false

	return (
		typeof Reflect.get(value, 'text') === 'string' && typeof Reflect.get(value, 'ms') === 'number'
	)
}

function beat_of(line: string): Beat | undefined {
	try {
		const value: unknown = JSON.parse(line)

		return is_beat(value) ? value : undefined
	} catch {
		return undefined
	}
}

// One beat per JSON line; undefined where any line is not one, as a demo without the beats form writes.
function beats_of(lines: string): Array<Beat> | undefined {
	const beats = lines
		.split('\n')
		.filter((line) => line !== '')
		.map((line) => beat_of(line))

	return beats.length > 0 && beats.every((beat) => beat !== undefined) ? beats : undefined
}

async function demo_beats(options: CompareOptions): Promise<Array<Beat> | undefined> {
	const environment = {
		...process.env,
		DEMO_BEATS: '1',
		DEMO_SEED: options.seed,
		DEMO_STEPS: options.steps,
	}
	const { stdout } = await promisify(execFile)(process.execPath, [options.demo, options.scene], {
		env: environment,
		maxBuffer: DEMO_BUFFER_BYTES,
	})

	return beats_of(stdout)
}

async function board_beats(argv: ReadonlyArray<string>): Promise<Array<Beat> | undefined> {
	const options = run_board_replay.options_of(argv, process.env)

	return options && (await run_board_replay.replay(run_board_cli.live_ports(false), options))
}

function write(text: string): void {
	process.stdout.write(text)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET), { demo_beats, board_beats, write })
}

const board_compare_cli = { beats_of, board_argv, options_of, run }

export { board_compare_cli }
export type { CompareOptions, ComparePorts }
