import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit, type FrameParts } from './run-board-fit'
import { run_board_fold } from './run-board-fold'
import { run_board_labels } from './run-board-labels'
import { run_board_machine } from './run-board-machine'
import type { QuotaReading } from './run-board-quota-read'
import { run_board_render_quota, type QuotaView } from './run-board-render-quota'
import { run_board_render_quota_cell, type Cell } from './run-board-render-quota-cell'
import type { GithubRateLimit } from './run-board-render-quota-github'
import { run_board_render_throughput } from './run-board-render-throughput'
import { run_board_spot } from './run-board-spot'
import type { ThroughputRow } from './run-board-throughput'

// joshuafolkken/kit#8695: the usage rows beside a lamp panel — gauge-less where a row draws 5h and 7d,
// GitHub's always — so the panel stays on every usage row, six rows down to GitHub's.

const { LAMP } = run_board_spot
const { rows_part } = run_board_render_throughput
const { width_of } = run_board_fit
const HOUR = 3_600_000
const MINUTE = 60_000
const NOW_MS = new Date(2026, 10, 22, 21, 0).getTime()
const FIVE_HOURS = 300
const SEVEN_DAYS = 10_080
const GAP = 2
const PANEL_WIDTH = 41
const WIDE_ROW = 111
const SHORT_ROW = 67
const ONE_CELL_ROW = 62
const PANEL_ROWS = 6
const BARS = /[■─┊]{20}/u
const NAMES = ['Claude', 'Codex', 'GitHub'] as const
const CELL: Cell = { label: '7d', used_percent: 0, pace: 1, count: '≈412', reset: 'Sat 10:00' }

afterEach(() => {
	vi.unstubAllEnvs()
})

function row_of(label: ThroughputRow['label'], now: number | undefined): ThroughputRow {
	return {
		label,
		cells: [{ start_ms: 0, end_ms: HOUR, done: 2, active_ms: HOUR }],
		active_ms: HOUR,
		done: 2,
		per_hour: 2,
		peak: undefined,
		now,
	}
}

const ROWS = [row_of('24h', 5), row_of('7d', undefined)]
const PANEL_START = width_of(rows_part(ROWS, false).lines[0]?.text ?? '') + GAP
const RATE_LIMIT: GithubRateLimit = {
	core: { remaining: 4827, limit: 5000, reset_ms: NOW_MS + 17 * MINUTE },
	graphql: { remaining: 4906, limit: 5000, reset_ms: NOW_MS + 31 * MINUTE },
	transport: 'graphql',
}

function reading_of(five_hour: number | undefined, week: number): QuotaReading {
	const week_window = { minutes: SEVEN_DAYS, used_percent: week, resets_ms: NOW_MS + 100 * HOUR }
	const short =
		five_hour === undefined
			? []
			: [{ minutes: FIVE_HOURS, used_percent: five_hour, resets_ms: NOW_MS + 3 * HOUR }]

	return {
		windows: [...short, week_window],
		taken_ms: NOW_MS,
		per_task: { [SEVEN_DAYS]: 0.5, [FIVE_HOURS]: 4 },
	}
}

function view_of(five_hour: boolean, has_lamps: boolean): QuotaView {
	return {
		quotas: {
			claude: reading_of(five_hour ? 22 : undefined, 40),
			codex: reading_of(five_hour ? 12 : undefined, 28),
		},
		scheduler_provider: 'claude',
		now_ms: NOW_MS,
		rate_limit: RATE_LIMIT,
		has_lamps,
	}
}

function frame_of(view: QuotaView): Array<string> {
	const has_lamps = view.has_lamps === true
	const parts: FrameParts = {
		above: [],
		plan: [],
		legend: [],
		footer: [],
		notes: { head: [], lines: [], hidden: 0 },
		throughput: rows_part(ROWS, has_lamps),
		usage: run_board_render_quota.usage_part(view),
		rule_width: PANEL_START + PANEL_WIDTH,
	}

	return run_board_fold.bounded(parts, {}).map((line) => stripVTControlCharacters(line))
}

// Each usage row's text before its panel, by name.
function bodies_of(lines: ReadonlyArray<string>): Array<string> {
	return NAMES.map((name) => {
		const line = lines.find((text) => text.includes(name)) ?? ''
		const end = line.includes(LAMP) ? line.indexOf(LAMP) : line.length

		return line.slice(0, end).trimEnd()
	})
}

function lamped(lines: ReadonlyArray<string>): Array<string> {
	return lines.filter((line) => line.includes(LAMP))
}

describe('the usage rows by 5h with no panel (joshuafolkken/kit#8695)', () => {
	it('1 — 5h, no panel: gauges on every row, all three ending at 111 with the cells aligned', () => {
		const bodies = bodies_of(frame_of(view_of(true, false)))

		expect(bodies.map((body) => width_of(body))).toStrictEqual([WIDE_ROW, WIDE_ROW, WIDE_ROW])
		for (const body of bodies) expect(body).toMatch(BARS)
		expect(bodies[2]).toContain('21:17   ▶ GQL   2%')
		expect(bodies[2]?.indexOf('GQL')).toBe((bodies[0]?.lastIndexOf('7d') ?? 0) - 1)
	})

	it('4 — no 5h, no panel: the 7d rows at 62 and GitHub at 111, all with gauges', () => {
		const bodies = bodies_of(frame_of(view_of(false, false)))

		expect(bodies.map((body) => width_of(body))).toStrictEqual([
			ONE_CELL_ROW,
			ONE_CELL_ROW,
			WIDE_ROW,
		])
		for (const body of bodies) expect(body).toMatch(BARS)
	})
})

describe('the usage rows by 5h under a panel (joshuafolkken/kit#8695)', () => {
	it('2 — 5h, panel: three gauge-less rows ending at 67, each running the panel', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const lines = frame_of(view_of(true, true))
		const bodies = bodies_of(lines)

		expect(bodies.map((body) => width_of(body))).toStrictEqual([SHORT_ROW, SHORT_ROW, SHORT_ROW])
		expect(bodies[0]).toMatch(/Claude {5}5h {2}22% {2}≈19 Mon 00:00 {4}7d {2}40% ≈120 Fri 01:00$/u)
		expect(bodies[2]).toMatch(/GitHub {3}REST {3}3% 4827 {5}21:17 ▶ GQL {3}2% 4906 {5}21:31$/u)
		for (const body of bodies) expect(body).not.toMatch(BARS)
		expect(lamped(lines)).toHaveLength(PANEL_ROWS)
	})

	it('3 — no 5h, panel: the 7d rows keep their gauges at 62, GitHub gauge-less at 67', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const lines = frame_of(view_of(false, true))
		const bodies = bodies_of(lines)

		expect(bodies.map((body) => width_of(body))).toStrictEqual([
			ONE_CELL_ROW,
			ONE_CELL_ROW,
			SHORT_ROW,
		])
		expect(bodies[0]).toMatch(BARS)
		expect(lamped(lines)).toHaveLength(PANEL_ROWS)
	})
})

describe('the usage rows beside the panel (joshuafolkken/kit#8695)', () => {
	it('draws both provider rows gauge-less where only one of them has two windows', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const view = view_of(true, true)
		const quotas = { claude: reading_of(22, 40), codex: reading_of(undefined, 28) }
		const bodies = bodies_of(frame_of({ ...view, quotas }))

		expect(bodies.slice(0, 2).join('')).not.toMatch(BARS)
		expect(bodies[1]).toMatch(/Codex {6}7d {2}28% ≈144 Fri 01:00$/u)
	})

	it.each([
		['usage limit', { reset_ms: NOW_MS + HOUR, parked: 3 }],
		['authentication failure', { reset_ms: NOW_MS + HOUR, parked: 0, cause: 'auth' as const }],
	])('keeps the panel on every usage row with Claude held by a %s', (_, hold) => {
		vi.stubEnv('FORCE_COLOR', '3')
		const lines = frame_of({ ...view_of(true, true), hold })

		expect(lamped(lines)).toHaveLength(PANEL_ROWS)
	})

	it('rains on the rule’s row as well, a seventh panel row on a rain frame', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const lines = frame_of({ ...view_of(true, true), has_rain: true })

		expect(lamped(lines)).toHaveLength(PANEL_ROWS + 1)
		expect(lamped(lines).some((line) => line.includes('usage'))).toBe(true)
	})
})

describe('a gauge-less row’s percent (joshuafolkken/kit#8695)', () => {
	it.each([
		{ used_percent: 20, level: 'normal' },
		{ used_percent: 60, level: 'yellow' },
		{ used_percent: 95, level: 'red' },
	] as const)('paints a gauge-less $used_percent% $level, as the bar’s fill was', (sample) => {
		vi.stubEnv('FORCE_COLOR', '3')
		const cell = { ...CELL, used_percent: sample.used_percent }
		const percent = run_board_machine.percent_text(sample.used_percent)
		const shaded = run_board_labels.painted(run_board_labels.GAUGE_SHADES[sample.level], percent)

		expect(run_board_render_quota_cell.short_row_text([cell])).toContain(shaded)
		expect(shaded).not.toBe(percent)
	})
})
