import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit, type DetailPart, type FrameParts } from './run-board-fit'
import { run_board_fold } from './run-board-fold'
import { run_board_quota_lamps } from './run-board-quota-lamps'
import type { QuotaReading } from './run-board-quota-read'
import { run_board_render_quota } from './run-board-render-quota'
import { run_board_render_throughput } from './run-board-render-throughput'
import { run_board_spot } from './run-board-spot'
import type { Theme } from './run-board-theme-defs'
import type { ThroughputRow } from './run-board-throughput'
import { run_board_tick_draw } from './run-board-tick-draw'

// joshuafolkken/kit#8644: a stale reading's age that would reach the lamp panel is left off the usage
// rows so both keep their panel; one that fits stays, and a board with no panel draws it as before.

const { LAMP } = run_board_spot
const { rows_part } = run_board_render_throughput
const { width_of } = run_board_fit
const HOUR = 3_600_000
const MINUTE = 60_000
const NOW_MS = new Date(2026, 10, 22, 12, 0).getTime()
const SEVEN_DAYS = 10_080
const GAP = 2
const PANEL_WIDTH = 41
const FOUR_DIGITS = 1128
const THREE_DIGITS = 128
const PANEL_ROWS = 5
const THEMES: ReadonlyArray<Theme> = ['wargames', 'matrix']

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
const PANEL_START =
	width_of(stripVTControlCharacters(rows_part(ROWS, false).lines[0]?.text ?? '')) + GAP

// A 7-day reading `age_minutes` old (`undefined`: its time unknown), counting tasks left as a live
// board's Codex row does.
function reading_of(age_minutes: number | undefined): QuotaReading {
	const window = { minutes: SEVEN_DAYS, used_percent: 28, resets_ms: NOW_MS + 30 * HOUR }
	const taken_ms = age_minutes === undefined ? undefined : NOW_MS - age_minutes * MINUTE

	return { windows: [window], taken_ms, per_task: { [SEVEN_DAYS]: 0.5 } }
}

function usage_of(
	age_minutes: number | undefined,
	has_panel: boolean,
	claude_age = 0,
): DetailPart | undefined {
	return run_board_render_quota.usage_part({
		quotas: { claude: reading_of(claude_age), codex: reading_of(age_minutes) },
		scheduler_provider: 'claude',
		now_ms: NOW_MS,
		has_lamps: has_panel,
	})
}

function drawn(usage: DetailPart | undefined, throughput?: DetailPart): Array<string> {
	const parts: FrameParts = {
		above: [],
		plan: [],
		legend: [],
		footer: [],
		notes: { head: [], lines: [], hidden: 0 },
		throughput,
		usage,
		rule_width: PANEL_START + PANEL_WIDTH,
	}

	return run_board_fold.bounded(parts, {}).map((line) => stripVTControlCharacters(line))
}

// A live frame whose Codex reading is `age_minutes` old.
function frame_of(age_minutes: number | undefined, has_panel = true): Array<string> {
	return drawn(usage_of(age_minutes, has_panel), rows_part(ROWS, has_panel))
}

function codex_of(lines: ReadonlyArray<string>): string {
	return lines.find((line) => line.includes('Codex')) ?? ''
}

function lamped(lines: ReadonlyArray<string>): number {
	return lines.filter((line) => line.includes(LAMP)).length
}

// Where the Codex row, drawn with no panel, would start one.
function reach_of(age_minutes: number | undefined): number {
	return width_of(codex_of(frame_of(age_minutes, false))) + 1
}

describe('the usage rows’ fixture (joshuafolkken/kit#8644)', () => {
	it('reaches the panel with a four-digit age only', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(reach_of(FOUR_DIGITS)).toBeGreaterThanOrEqual(PANEL_START)
		expect(reach_of(undefined)).toBeGreaterThanOrEqual(PANEL_START)
		expect(reach_of(THREE_DIGITS)).toBeLessThan(PANEL_START)
		expect(reach_of(0)).toBeLessThan(PANEL_START)
	})
})

describe('a stale reading’s age on the lamp panel’s usage rows (joshuafolkken/kit#8644)', () => {
	it.each(THEMES)(
		'keeps both usage rows’ panels and leaves the age off on the %s board',
		(theme) => {
			vi.stubEnv('FORCE_COLOR', '3')
			const has_panel = run_board_tick_draw.has_lamps({ types_rows: true, theme, is_tty: true })
			const lines = frame_of(FOUR_DIGITS, has_panel)

			expect(has_panel).toBe(true)
			expect(lamped(lines)).toBe(PANEL_ROWS)
			expect(codex_of(lines)).not.toContain('′')
			expect(codex_of(lines)).toContain(LAMP)
		},
	)

	it('draws an age that fits, keeping both usage rows’ panels', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const lines = frame_of(THREE_DIGITS)

		expect(lamped(lines)).toBe(PANEL_ROWS)
		expect(codex_of(lines)).toContain(`${String(THREE_DIGITS)}′`)
	})

	it('leaves an unknown time off where it reaches the panel', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const lines = frame_of(undefined)

		expect(lamped(lines)).toBe(PANEL_ROWS)
		expect(codex_of(lines)).not.toContain('(time unknown)')
	})
})

describe('a stale age on a usage row that fits the panel (joshuafolkken/kit#8644)', () => {
	it('keeps the age on a row that fits beside one whose age is left off', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const frame = drawn(usage_of(FOUR_DIGITS, true, THREE_DIGITS), rows_part(ROWS, true))
		const claude = frame.find((line) => line.includes('Claude')) ?? ''

		expect(lamped(frame)).toBe(PANEL_ROWS)
		expect(claude).toContain(`${String(THREE_DIGITS)}′`)
		expect(codex_of(frame)).not.toContain('′')
	})
})

// The usage part with its first row run on to the panel's start.
function reaching(usage: DetailPart): DetailPart {
	const [long = ''] = run_board_quota_lamps.provider_rows(['x'.repeat(PANEL_START)], true)
	const lines = usage.lines.map((line, index) => (index === 0 ? { ...line, text: long } : line))

	return { ...usage, lines }
}

// The Codex row of a usage part drawn with lamps as given.
function codex_line(has_panel: boolean): DetailPart['lines'][number] {
	return usage_of(FOUR_DIGITS, has_panel)?.lines[1] ?? { text: '', is_detail: false }
}

describe('a stale reading’s age where the usage rows run no panel (joshuafolkken/kit#8644)', () => {
	it('draws a four-digit age as it is on a board with no panel', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const unlit = frame_of(FOUR_DIGITS, false)
		const alone = drawn(usage_of(FOUR_DIGITS, true))

		for (const lines of [unlit, alone]) {
			expect(lamped(lines)).toBe(0)
			expect(codex_of(lines)).toContain(`${String(FOUR_DIGITS)}′`)
		}
	})

	// joshuafolkken/kit#8695: the panel is kept; the age goes first, then a row reaching it still is cut.
	it('keeps both usage rows’ panels where a row reaches the panel without its age, cutting that row', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const usage = usage_of(FOUR_DIGITS, true)
		const frame = drawn(usage && reaching(usage), rows_part(ROWS, true))
		const cut = frame.find((line) => line.trimStart().startsWith('x')) ?? ''
		const kept = cut.slice(0, cut.indexOf(LAMP)).trimEnd()

		expect(lamped(frame)).toBe(PANEL_ROWS)
		expect(codex_of(frame)).not.toContain('′')
		expect(width_of(kept)).toBe(PANEL_START - GAP)
	})
})

describe('run_board_render_quota.usage_part’s age aside (joshuafolkken/kit#8644)', () => {
	it('sets the age aside on a lamped frame’s rows only, their text unchanged', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const lit = codex_line(true)
		const plain = codex_line(false)
		const aside = ` \u{1B}[2m${String(FOUR_DIGITS)}′\u{1B}[22m`

		expect(lit.aside).toBe(aside)
		expect(plain.aside).toBeUndefined()
		expect(plain.text.endsWith(aside)).toBe(true)
		expect(lit.text.startsWith(`${plain.text} `)).toBe(true)
	})
})
