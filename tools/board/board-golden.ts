import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { run_board_replay, type Beat } from '#scripts/run/board/run-board-replay'
import { run_board_theme_defs, type Theme } from '#scripts/run/board/run-board-theme-defs'
import { board_compare_report } from './board-compare-report'

// The gate's look check (joshuafolkken/kit#8766): each theme's board replayed on a fixed clock and seed
// is compared cell by cell with the replay recorded when its look was approved, so a change that moves
// a drawn cell fails the unit tests. The golden is the `board:replay` beat lines, gzipped.

// Every theme the board draws, by its value (joshuafolkken/kit#8917) — a theme added to the definitions
// is a golden recorded.
const { THEMES } = run_board_theme_defs
// joshuafolkken/kit#8917: the size the motion check replays at (`board:replay --motion`), where every
// theme's panel has its room; each sleep between the theme's frames is a tick.
const SIZE = { columns: 200, rows: 50 }
const SEED = '1'

type GoldenTheme = Theme

// The redraws each golden records: past its opening into a second of the idle board, so the golden
// checks where the theme draws its name, panel and level, not the opening alone — the matrix board's
// rain, which runs on through its idle, too large to record past its opening's start.
const TICKS: Readonly<Record<GoldenTheme, number>> = {
	wopr: 90,
	trace: 40,
	flux: 120,
	codec: 140,
	nixie: 100,
	skynet: 60,
	magi: 140,
	deviant: 154,
	isac: 120,
	ghost: 100,
}
const GOLDEN_DIRECTORY = fileURLToPath(new URL('golden/', import.meta.url))
// Set to record the golden replays again instead of comparing with them.
const UPDATE_VARIABLE = 'BOARD_GOLDEN_UPDATE'
const UPDATE_HINT = `An intended look change: record the golden replays again in this PR — ${UPDATE_VARIABLE}=1 pnpm josh test:unit tools/board/board-golden.test.ts — and commit tools/board/golden/.`

function golden_path(theme: GoldenTheme, directory: string): string {
	return `${directory}${theme}.jsonl.gz`
}

// The `board:replay` arguments the golden is recorded with, the clock taken from the ports.
function replay_argv(theme: GoldenTheme): Array<string> {
	return [
		'--theme',
		theme,
		'--seed',
		SEED,
		'--ticks',
		String(TICKS[theme]),
		'--columns',
		String(SIZE.columns),
		'--rows',
		String(SIZE.rows),
	]
}

// The directory defaults to `tools/board/golden/`; a test passes a temporary one.
async function read_golden(
	theme: GoldenTheme,
	directory = GOLDEN_DIRECTORY,
): Promise<Array<Beat> | undefined> {
	const zipped = await readFile(golden_path(theme, directory))

	return board_compare_report.beats_of(gunzipSync(zipped).toString('utf8'))
}

async function write_golden(
	theme: GoldenTheme,
	beats: ReadonlyArray<Beat>,
	directory = GOLDEN_DIRECTORY,
): Promise<void> {
	await writeFile(golden_path(theme, directory), gzipSync(run_board_replay.lines_of(beats)))
}

// The index of the beat on screen at `at_ms`: the last one written at or before it.
function beat_at(beats: ReadonlyArray<Beat>, at_ms: number): number {
	let start_ms = 0
	const starts = beats.map((beat) => {
		const start = start_ms

		start_ms += beat.ms

		return start
	})

	return Math.max(
		starts.findLastIndex((start) => start <= at_ms),
		0,
	)
}

function length_note(expected: ReadonlyArray<Beat>, actual: ReadonlyArray<Beat>): string {
	return `board:golden — the golden has ${String(expected.length)} beats, the replay ${String(actual.length)}\n`
}

// Undefined where the replay draws the golden's screens beat for beat; else the first divergence, the
// beat it falls in and how to record the golden again.
async function verdict(
	expected: ReadonlyArray<Beat>,
	actual: ReadonlyArray<Beat>,
): Promise<string | undefined> {
	const divergence = await board_compare_report.compared(expected, actual, SIZE, 'strict')

	if (divergence === undefined && expected.length === actual.length) return undefined
	const where =
		divergence === undefined
			? length_note(expected, actual)
			: `${board_compare_report.report(divergence)}  beat ${String(beat_at(actual, divergence.at_ms))} of ${String(actual.length)}\n`

	return `${where}${UPDATE_HINT}\n`
}

function is_update(environment: NodeJS.ProcessEnv): boolean {
	return environment[UPDATE_VARIABLE] === '1'
}

const board_golden = {
	THEMES,
	beat_at,
	is_update,
	read_golden,
	replay_argv,
	verdict,
	write_golden,
}

export { board_golden }
export type { GoldenTheme }
