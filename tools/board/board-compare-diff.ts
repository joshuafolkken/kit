import type { Cell, Shot } from './board-compare-screen'

// Two screen streams compared by the time each screen shows (joshuafolkken/kit#8754): at every moment
// either side writes a beat, the screen each side shows then. Strict compares every cell; loose
// compares what a random source drawn in another order still keeps — the characters and colors used and
// how many cells are drawn — so the same effect from another random sequence reads as the same.

interface Sample {
	readonly where: string
	readonly expected: string
	readonly actual: string
}

// The first moment the two screens differ: how many cells (or loose aspects) differ, the first few.
interface Divergence {
	readonly at_ms: number
	readonly count: number
	readonly samples: ReadonlyArray<Sample>
}

type Mode = 'strict' | 'loose'

const SAMPLE_LIMIT = 5
// Loose: the drawn cell counts may differ by this share of the larger one.
const DENSITY_TOLERANCE = 0.1
const BLANK = ' '

function cell_text(cell: Cell): string {
	return `'${cell.char}' fg ${cell.fg} bg ${cell.bg} style ${cell.style === '' ? '-' : cell.style}`
}

function is_same(left: Cell, right: Cell): boolean {
	return (
		left.char === right.char &&
		left.fg === right.fg &&
		left.bg === right.bg &&
		left.style === right.style
	)
}

function row_samples(
	expected: ReadonlyArray<Cell>,
	actual: ReadonlyArray<Cell>,
	y: number,
): Array<Sample> {
	return expected
		.map((cell, x) => ({ cell, x, other: actual[x] }))
		.filter(({ cell, other }) => other === undefined || !is_same(cell, other))
		.map(({ cell, x, other }) => ({
			where: `row ${String(y)} col ${String(x)}`,
			expected: cell_text(cell),
			actual: other ? cell_text(other) : '-',
		}))
}

function strict_samples(expected: Shot, actual: Shot): Array<Sample> {
	return expected.cells.flatMap((row, y) => row_samples(row, actual.cells[y] ?? [], y))
}

function drawn(shot: Shot): Array<Cell> {
	return shot.cells.flat().filter((cell) => cell.char !== BLANK)
}

function set_text(values: ReadonlyArray<string>): string {
	return [...new Set(values)].toSorted((left, right) => left.localeCompare(right)).join(' ')
}

function is_dense_alike(expected: number, actual: number): boolean {
	return Math.abs(expected - actual) <= Math.max(expected, actual) * DENSITY_TOLERANCE
}

function loose_samples(expected: Shot, actual: Shot): Array<Sample> {
	const [left, right] = [drawn(expected), drawn(actual)]
	const aspects: Array<Sample> = [
		{
			where: 'chars',
			expected: set_text(left.map((cell) => cell.char)),
			actual: set_text(right.map((cell) => cell.char)),
		},
		{
			where: 'colors',
			expected: set_text(expected.cells.flat().flatMap((cell) => [cell.fg, cell.bg])),
			actual: set_text(actual.cells.flat().flatMap((cell) => [cell.fg, cell.bg])),
		},
	]
	const density = { where: 'density', expected: String(left.length), actual: String(right.length) }
	const differing = aspects.filter((aspect) => aspect.expected !== aspect.actual)

	return is_dense_alike(left.length, right.length) ? differing : [...differing, density]
}

// The shot a side shows at `at_ms`: its last one written by then.
function shown(shots: ReadonlyArray<Shot>, at_ms: number): Shot | undefined {
	return shots.findLast((shot) => shot.at_ms <= at_ms)
}

// Every moment either side writes, up to the last write both sides reach.
function moments(expected: ReadonlyArray<Shot>, actual: ReadonlyArray<Shot>): Array<number> {
	const end = Math.min(expected.at(-1)?.at_ms ?? -1, actual.at(-1)?.at_ms ?? -1)
	const times = [...expected, ...actual].map((shot) => shot.at_ms).filter((at_ms) => at_ms <= end)

	return [...new Set(times)].toSorted((left, right) => left - right)
}

function divergence_at(
	expected: Shot,
	actual: Shot,
	at_ms: number,
	mode: Mode,
): Divergence | undefined {
	const samples =
		mode === 'strict' ? strict_samples(expected, actual) : loose_samples(expected, actual)

	if (samples.length === 0) return undefined

	return { at_ms, count: samples.length, samples: samples.slice(0, SAMPLE_LIMIT) }
}

function first_divergence(
	expected: ReadonlyArray<Shot>,
	actual: ReadonlyArray<Shot>,
	mode: Mode,
): Divergence | undefined {
	for (const at_ms of moments(expected, actual)) {
		const [left, right] = [shown(expected, at_ms), shown(actual, at_ms)]
		const found = left && right && divergence_at(left, right, at_ms, mode)

		if (found) return found
	}

	return undefined
}

const board_compare_diff = { first_divergence }

export { board_compare_diff }
export type { Divergence, Mode, Sample }
