import { describe, expect, it, vi } from 'vitest'
import { run_board_fit, type FrameParts } from './run-board-fit'
import { run_board_flash_parts } from './run-board-flash-parts'
import { run_board_frame_diff } from './run-board-frame-diff'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import type { NamedFigure } from './run-board-process-groups'
import { run_board_render, type BoardView } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_spin, type Spun } from './run-board-spin'
import { run_board_theme_defs } from './run-board-theme-defs'
import type { ThroughputRow } from './run-board-throughput'
import { run_board_type_rows, type KeyedLine } from './run-board-type-rows'

const { header, board_usage, NOW } = run_board_render_fixture
const SIZE = { rows: 100, columns: 240 }
const FIGURE = { cpu_cores: 1, memory_bytes: 0, compressed_bytes: 0 }
const NEXT_COUNT = 2
const LONG_NAME = 'application with identical prefix '
const THROUGHPUT: ThroughputRow = {
	label: '24h',
	cells: [],
	active_ms: 0,
	done: 0,
	per_hour: undefined,
	peak: undefined,
	now: 0,
}
const READING = {
	taken_ms: NOW,
	windows: [{ minutes: 1, used_percent: 1, resets_ms: NOW + 60_000 }],
}

function rendered(extra: Partial<BoardView>, board: Partial<BoardHeader>): Spun {
	const lines = run_board_render.render({
		header: header({ theme: 'matrix', is_keyed: true, spinner: '⠋', ...board }),
		notes: [],
		size: SIZE,
		folded: new Set(),
		...extra,
	})

	return run_board_spin.spun(lines, '⠋', SIZE)
}

// The same theme rendered with its change flash turned off, so only the flash keying differs.
function without_flash(render: () => Spun): Spun {
	const { live_of } = run_board_theme_defs
	const spy = vi
		.spyOn(run_board_theme_defs, 'live_of')
		.mockImplementation((theme) => ({ ...live_of(theme), flash: false }))

	try {
		return render()
	} finally {
		spy.mockRestore()
	}
}

function frame(extra: Partial<BoardView> = {}, board: Partial<BoardHeader> = {}): Array<KeyedLine> {
	return rendered(extra, board).keyed
}

function row(number: number): BoardRow {
	return {
		number,
		state: 'running',
		title: undefined,
		kind: undefined,
		status: undefined,
		waits: [],
	}
}

function lanes(numbers: ReadonlyArray<number>): Partial<BoardHeader> {
	return {
		layout: { active: numbers.map((number) => row(number)), queued: [], people: [], unreached: [] },
	}
}

function apps(entries: ReadonlyArray<NamedFigure>): Partial<BoardHeader> {
	return { usages: board_usage(new Map(), { apps: { total: FIGURE, top: entries } }) }
}

function app(name: string, instances = 1): NamedFigure {
	return { name, instances, figure: FIGURE }
}

describe('run_board_flash_parts matrix producer identity', () => {
	it('ac-713cb5e6 establishes a new base for reordered and inserted issue rows', () => {
		const base = frame({}, lanes([1, NEXT_COUNT]))
		const moved = frame({}, lanes([NEXT_COUNT, 1]))
		const inserted = frame({}, lanes([NEXT_COUNT, 1, 3]))

		expect(run_board_frame_diff.changed(base, moved)).toStrictEqual([])
		expect(
			run_board_frame_diff.changed(moved, inserted).filter((cell) => cell.key.startsWith('lanes:')),
		).toStrictEqual([])
	})

	it('ac-713cb5e6 ignores provider reordering when the scheduler changes', () => {
		const quotas = { claude: READING, codex: READING }
		const base = frame({}, { quotas, scheduler_provider: 'claude' })
		const moved = frame({}, { quotas, scheduler_provider: 'codex' })

		expect(run_board_frame_diff.changed(base, moved)).toStrictEqual([])
	})

	it('ac-713cb5e6 ignores lower rows moved by an optional throughput section', () => {
		const board = apps([app('editor')])
		const base = frame({}, board)
		const shown = frame({ throughput: [THROUGHPUT] }, board)

		expect(run_board_frame_diff.changed(base, shown)).toStrictEqual([])
		expect(run_board_frame_diff.changed(shown, base)).toStrictEqual([])
	})
})

describe('run_board process identity', () => {
	it('uses original names for reordered and replaced rows with identical truncated labels', () => {
		const first = app(`${LONG_NAME}a`)
		const second = app(`${LONG_NAME}b`)
		const base = frame({}, apps([first, second]))
		const moved = frame({}, apps([second, first]))
		const replaced = frame({}, apps([app(`${LONG_NAME}c`), first]))

		expect(run_board_frame_diff.changed(base, moved)).toStrictEqual([])
		expect(run_board_frame_diff.changed(moved, replaced)).toStrictEqual([])
	})

	it('retains identity when an application instance count changes', () => {
		const base = frame({}, apps([app('editor')]))
		const changed = frame({}, apps([app('editor', NEXT_COUNT)]))
		const cells = run_board_frame_diff.changed(base, changed)

		expect(cells.length).toBeGreaterThan(0)
		expect(cells.every((cell) => cell.key.includes('editor'))).toBe(true)
	})

	it('keys folded summaries and changing lane counts independently of displayed labels', () => {
		const extra = { folded: new Set<'lanes'>(['lanes']) }
		const base = frame(extra, lanes([1]))
		const changed = frame(extra, lanes([1, NEXT_COUNT]))
		const cells = run_board_frame_diff.changed(base, changed)

		expect(cells.length).toBeGreaterThan(0)
		// The folded lanes rule carries the progress tail's typing key, so it flashes by that key.
		expect(cells.every((cell) => cell.key.startsWith('plan:'))).toBe(true)
	})
})

describe('run_board_flash_parts metadata', () => {
	it('keys the global hidden count without changing its rendered text', () => {
		const parts: FrameParts = {
			above: [],
			plan: [
				{
					head: [''],
					lines: Array.from({ length: 10 }, (_, index) => ({
						text: String(index),
						row: { stage: 'pending', at_ms: undefined },
					})),
				},
			],
			notes: { head: [], lines: [], hidden: 0 },
			legend: [],
			footer: [],
		}
		const size = { rows: 4, columns: 80 }
		const plain = run_board_fit.fit(parts, size)
		const flashed = run_board_fit.fit(run_board_flash_parts.keyed(parts, true), size)
		const spun = run_board_spin.spun(flashed, '', size)

		expect(spun.lines).toStrictEqual(plain)
		expect(spun.keyed.at(-1)?.key).toBe('flash:more:plan')
	})
})

describe('run_board_flash_parts typing', () => {
	it('never types or emits typing bytes for newly visible flash metadata', () => {
		const quotas = { claude: READING, codex: undefined }
		const keyed = frame({ has_lamps: true }, { quotas }).filter((line) =>
			line.key.startsWith('flash:'),
		)
		const typing = run_board_type_rows.next(
			{ seen: new Set(), lines: [] },
			{ keyed, known: new Set(keyed.map((line) => line.key)) },
			NOW,
			true,
		)

		expect(keyed.length).toBeGreaterThan(0)
		expect(typing.lines).toStrictEqual([])
		expect(run_board_type_rows.type_bytes(typing, NOW)).toBe('')
	})
})

describe('run_board_flash_parts rendered output', () => {
	it.each([false, true])(
		'preserves rendered text and typing prefixes with lamps %s',
		(has_lamps) => {
			const board = {
				...apps([app('editor')]),
				...lanes([1]),
				quotas: { claude: READING, codex: READING },
			}
			const view = { throughput: [THROUGHPUT], has_lamps }
			const flashed = rendered(view, board)
			const plain = without_flash(() => rendered(view, board))
			const { keyed } = flashed

			expect(
				keyed
					.filter((line) => line.key.startsWith('flash:'))
					.every((line) => line.prefix_columns === run_board_fit.width_of(line.text)),
			).toBe(true)
			expect(flashed.lines).toStrictEqual(plain.lines)
			expect(flashed.lamps).toStrictEqual(plain.lamps)
			expect(keyed.filter((line) => line.key.startsWith('lanes:'))).toStrictEqual(
				plain.keyed.filter((line) => line.key.startsWith('lanes:')),
			)
		},
	)
})
