import type { Beat } from '#scripts/run/board/run-board-reveal-blocks'
import { board_compare_diff, type Divergence, type Mode } from './board-compare-diff'
import { board_compare_screen, type Size } from './board-compare-screen'

// The beat reading, screen comparison and report `josh board:compare` prints, apart from its CLI so the
// gate's golden check (`board-golden.ts`, joshuafolkken/kit#8766) shares them without loading the CLI.

function is_beat(value: unknown): value is Beat {
	if (typeof value !== 'object' || value === null) return false

	return (
		typeof Reflect.get(value, 'text') === 'string' && typeof Reflect.get(value, 'ms') === 'number'
	)
}

function parsed(line: string): unknown {
	try {
		return JSON.parse(line)
	} catch {
		return undefined
	}
}

function beat_of(line: string): Beat | undefined {
	const value = parsed(line)

	return is_beat(value) ? value : undefined
}

// One beat per JSON line; undefined where any line is not one, as a demo without the beats form writes.
function beats_of(lines: string): Array<Beat> | undefined {
	const beats = lines
		.split('\n')
		.filter((line) => line !== '')
		.map((line) => beat_of(line))

	return beats.length > 0 && beats.every((beat) => beat !== undefined) ? beats : undefined
}

// The first moment the two beat streams draw different screens; undefined where none differs.
async function compared(
	expected: ReadonlyArray<Beat>,
	actual: ReadonlyArray<Beat>,
	size: Size,
	mode: Mode,
): Promise<Divergence | undefined> {
	const [left, right] = await Promise.all([
		board_compare_screen.shots_of(expected, size),
		board_compare_screen.shots_of(actual, size),
	])

	return board_compare_diff.first_divergence(left, right, mode)
}

function report(divergence: Divergence | undefined): string {
	if (divergence === undefined) return 'board:compare — 0 differences\n'
	const head = `board:compare — diverged at ${String(divergence.at_ms)} ms: ${String(divergence.count)} differences`
	const samples = divergence.samples.map(
		(sample) => `  ${sample.where}: expected ${sample.expected} · actual ${sample.actual}`,
	)

	return `${[head, ...samples].join('\n')}\n`
}

const board_compare_report = { beats_of, compared, report }

export { board_compare_report }
