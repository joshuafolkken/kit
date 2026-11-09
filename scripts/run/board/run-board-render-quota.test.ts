import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { QuotaReading, Quotas } from './run-board-quota-read'
import { run_board_render_quota, type QuotaView } from './run-board-render-quota'

const { LEGEND, usage_part } = run_board_render_quota
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const NOW_MS = new Date(2026, 9, 29, 12, 0).getTime()
const FIVE_HOURS = 300
const SEVEN_DAYS = 10_080
const THIRTY_DAYS = 43_200
const HALF_EMPTY_BAR = '──────────┊─────────'

function reading(windows: QuotaReading['windows'], taken_ms = NOW_MS): QuotaReading {
	return { windows, taken_ms }
}

// A window `used` percent full whose reset is `left_ms` away.
function window_of(
	minutes: number,
	used: number,
	left_ms: number,
): QuotaReading['windows'][number] {
	return { minutes, used_percent: used, resets_ms: NOW_MS + left_ms }
}

function rows_of(view: Partial<QuotaView>): Array<string> {
	const part = usage_part({ now_ms: NOW_MS, ...view })

	return (part?.lines ?? []).map((line) => stripVTControlCharacters(line.text))
}

function raw_row(observation: QuotaReading, now_ms: number): string {
	const part = usage_part({ quotas: { claude: observation, codex: undefined }, now_ms })

	return part?.lines[0]?.text ?? ''
}

const CLAUDE = reading([
	window_of(FIVE_HOURS, 42, 2 * HOUR_MS),
	window_of(SEVEN_DAYS, 68, 3 * 24 * HOUR_MS),
])
const CODEX = reading([window_of(SEVEN_DAYS, 45, 10 * 24 * HOUR_MS)])
const QUOTAS: Quotas = { claude: CLAUDE, codex: CODEX }

afterEach(() => {
	vi.unstubAllEnvs()
})

function column_at(row: string, value: string): number {
	return run_board_fit.width_of(row.slice(0, row.indexOf(value)))
}

function expect_percent_columns(row: string, used: number): void {
	const last_percent = row.lastIndexOf(`${String(used)}%`)
	const last_column = run_board_fit.width_of(row.slice(0, last_percent))

	expect(column_at(row, `${String(used)}%`) + String(used).length).toBe(22)
	expect(last_column + String(used).length).toBe(71)
}

describe('run_board_render_quota twenty-step bars', () => {
	it.each([
		{ used: 0, bar: HALF_EMPTY_BAR },
		{ used: 25, bar: '■■■■■─────┊─────────' },
		{ used: 50, bar: '■■■■■■■■■■┊─────────' },
		{ used: 75, bar: '■■■■■■■■■■┊■■■■─────' },
		{ used: 100, bar: '■■■■■■■■■■┊■■■■■■■■■' },
	])('draws $used% in both windows and providers under a label-free rule', ({ used, bar }) => {
		const windows = [FIVE_HOURS, SEVEN_DAYS].map((minutes) =>
			window_of(minutes, used, (minutes * MINUTE_MS) / 2),
		)
		const quotas = { claude: reading(windows), codex: reading(windows) }
		const head = stripVTControlCharacters(usage_part({ quotas, now_ms: NOW_MS })?.head[1] ?? '')
		const rows = rows_of({ quotas })

		expect(head).toMatch(/^── ⛽ usage ─+$/u)

		for (const row of rows) {
			expect(row.split(bar)).toHaveLength(3)
			expect_percent_columns(row, used)
		}
	})
})

describe('run_board_render_quota twenty-step elapsed markers', () => {
	it.each([
		{ elapsed: 0, bar: '┊───────────────────' },
		{ elapsed: 0.25, bar: '─────┊──────────────' },
		{ elapsed: 0.5, bar: HALF_EMPTY_BAR },
		{ elapsed: 0.75, bar: '───────────────┊────' },
		{ elapsed: 1, bar: '───────────────────┊' },
	])('places the elapsed marker at $elapsed on twenty cells', ({ elapsed, bar }) => {
		const windows = [FIVE_HOURS, SEVEN_DAYS].map((minutes) =>
			window_of(minutes, 0, Math.max(1, minutes * MINUTE_MS * (1 - elapsed))),
		)
		const quotas = { claude: reading(windows), codex: reading(windows) }
		const rows = rows_of({ quotas })

		for (const row of rows) expect(row.split(bar)).toHaveLength(3)
	})
})

describe('run_board_render_quota scheduler', () => {
	it.each([
		{ scheduler_provider: 'claude', name: 'Claude', value: '42%', weekly: '68%' },
		{ scheduler_provider: 'codex', name: 'Codex', value: '45%', weekly: '11/08' },
	] as const)(
		'puts scheduler %s first, named in its proper case, without moving its gauges',
		({ scheduler_provider, name, value, weekly }) => {
			const view = { quotas: QUOTAS, scheduler_provider }
			const [first = '', second = ''] = rows_of(view)
			const plain = rows_of({ quotas: QUOTAS }).find((row) => row.includes(name)) ?? ''

			expect(first).toMatch(new RegExp(`^  🤖 ${name} `, 'u'))
			expect(second).toMatch(/^ {5}(Claude|Codex) /u)
			expect(second).not.toContain('🤖')
			expect(column_at(first, value)).toBe(column_at(plain, value))
			expect(column_at(first, weekly)).toBe(column_at(plain, weekly))
			expect(usage_part({ ...view, now_ms: NOW_MS })?.summary).toMatch(
				new RegExp(`^🤖 ${name} `, 'u'),
			)
		},
	)
})

describe('run_board_render_quota.usage_part', () => {
	it('draws no section where no reader is open', () => {
		expect(usage_part({ quotas: undefined, now_ms: NOW_MS })).toBeUndefined()
	})

	it('draws each reported window shortest first after the name, led by its length and ended by its reset time, summed up folded', () => {
		const part = usage_part({ quotas: QUOTAS, now_ms: NOW_MS })
		const [claude, codex] = rows_of({ quotas: QUOTAS }) as [string, string]

		expect(part?.label).toBe('⛽ usage')
		expect(part?.summary).toBe('Claude 42/68 · Codex 45')
		expect(claude).toMatch(
			/^ {2}Claude {8}5h {2}42% ■■■■■■■■────┊─────── {10}14:00 {6}7d {2}68% ■■■■■■■■■■■┊■■────── {6}Sun 12:00$/u,
		)
		expect(codex).toBe(`  Codex${' '.repeat(9)}7d  45% ┊■■■■■■■■───────────${' '.repeat(10)}11/08`)
		expect(column_at(codex, '45%')).toBe(column_at(claude, '42%'))
		expect(`${claude}\n${codex}`).not.toContain('↻')
	})

	it('leads a 30-day window with its length, right-aligned in the label column', () => {
		const quotas = { claude: undefined, codex: reading([window_of(THIRTY_DAYS, 7, HOUR_MS)]) }
		const [claude, codex = ''] = rows_of({ quotas })

		expect(claude).toBe('  Claude    —')
		expect(codex).toMatch(/^ {2}Codex {8}30d {3}7% \S{20} {10}13:00$/u)
		expect(column_at(codex, '7%')).toBe(21)
	})

	it('draws a window whose reset has passed as empty, its reset rolled on a window', () => {
		const quotas = { claude: reading([window_of(FIVE_HOURS, 80, -HOUR_MS)]), codex: undefined }
		const [claude] = rows_of({ quotas })

		expect(claude).toMatch(/ 0% \S{20} {10}16:00$/u)
	})
})

describe('run_board_render_quota.usage_part tasks left', () => {
	const PER_TASK = { [FIVE_HOURS]: 6, [SEVEN_DAYS]: 6 }

	it('puts ≈ the tasks left right-aligned before each reset time, the next window unmoved', () => {
		const quotas = { claude: { ...CLAUDE, per_task: PER_TASK }, codex: CODEX }
		const [claude = ''] = rows_of({ quotas })

		expect(claude).toMatch(
			/^ {2}Claude {8}5h {2}42% ■■■■■■■■────┊─────── {3}≈9 {5}14:00 {6}7d {2}68% ■■■■■■■■■■■┊■■────── {3}≈5 Sun 12:00$/u,
		)
		expect(usage_part({ quotas, now_ms: NOW_MS })?.summary).toBe('Claude 42/68 ≈9/5 · Codex 45')
	})

	it('leaves the place blank and marks the untold count beside a told one in the summary', () => {
		const told = reading([window_of(SEVEN_DAYS, 68, HOUR_MS), window_of(FIVE_HOURS, 42, HOUR_MS)])
		const quotas = { claude: { ...told, per_task: { [SEVEN_DAYS]: 8 } }, codex: QUOTAS.codex }
		const [claude = ''] = rows_of({ quotas })
		const part = usage_part({ quotas, now_ms: NOW_MS })

		expect(claude).toMatch(
			/^ {2}Claude {8}5h {2}42% \S{20} {10}13:00 {6}7d {2}68% \S{20} {3}≈4 {5}13:00$/u,
		)
		expect(part?.summary).toBe('Claude 42/68 ≈—/4 · Codex 45')
	})

	it('counts a window whose reset has passed from empty, and none for a spend of zero', () => {
		const passed = {
			...reading([window_of(FIVE_HOURS, 80, -HOUR_MS)]),
			per_task: { [FIVE_HOURS]: 30 },
		}
		const zero = { ...reading([window_of(FIVE_HOURS, 10, HOUR_MS)]), per_task: { [FIVE_HOURS]: 0 } }

		expect(rows_of({ quotas: { claude: passed, codex: zero } })).toEqual([
			expect.stringMatching(/ 0% \S{20} {3}≈3 {5}16:00$/u),
			expect.not.stringContaining('≈'),
		])
	})
})

describe('run_board_render_quota.usage_part spend under one percent', () => {
	it('counts the tasks left off a mean spend under one percent', () => {
		const told = reading([window_of(SEVEN_DAYS, 68, HOUR_MS)])
		const quotas = { claude: { ...told, per_task: { [SEVEN_DAYS]: 2 / 3 } }, codex: QUOTAS.codex }

		expect(usage_part({ quotas, now_ms: NOW_MS })?.summary).toBe('Claude 68 ≈48 · Codex 45')
	})

	it('counts a whole number of tasks a fractional mean spend divides into', () => {
		const told = reading([window_of(SEVEN_DAYS, 65, HOUR_MS)])
		const quotas = { claude: { ...told, per_task: { [SEVEN_DAYS]: 7 / 3 } }, codex: QUOTAS.codex }

		expect(usage_part({ quotas, now_ms: NOW_MS })?.summary).toBe('Claude 65 ≈15 · Codex 45')
	})
})

describe('run_board_render_quota.usage_part hold and age', () => {
	it.each([11, 45])(
		'dims only the age, `N′` after the reset time, after %s minutes on repeated draws',
		(minutes) => {
			vi.stubEnv('FORCE_COLOR', '1')
			const old = reading([window_of(FIVE_HOURS, 10, HOUR_MS)], NOW_MS - 11 * MINUTE_MS)
			const now_ms = NOW_MS + (minutes - 11) * MINUTE_MS
			const fresh = reading(old.windows, now_ms)

			expect(raw_row(old, now_ms)).toBe(
				`${raw_row(fresh, now_ms)} \u{1B}[2m${String(minutes)}′\u{1B}[22m`,
			)
		},
	)

	it('labels a reading without an event time as unknown, dimming only that annotation', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const old: QuotaReading = { windows: [window_of(FIVE_HOURS, 42, HOUR_MS)], taken_ms: undefined }
		const fresh = reading(old.windows)

		expect(raw_row(old, NOW_MS)).toBe(`${raw_row(fresh, NOW_MS)} \u{1B}[2m(time unknown)\u{1B}[22m`)
	})
})

describe('run_board_render_quota.usage_part missing and hold', () => {
	it('keeps missing and empty readings distinct from zero usage and aged observations', () => {
		const quotas = { claude: undefined, codex: reading([], NOW_MS - HOUR_MS) }
		const rows = rows_of({ quotas })

		for (const row of rows) {
			expect(row).toMatch(/^ {2}(Claude|Codex) +—$/u)
			expect(row).not.toMatch(/0%|ago|unknown/u)
		}

		expect(usage_part({ quotas, now_ms: NOW_MS })?.summary).toBe('Claude — · Codex —')
	})

	it("reads Claude's row as the hold while a usage limit stops the launches", () => {
		const hold = { reset_ms: NOW_MS + 2 * HOUR_MS, parked: 3 }
		const [claude, codex] = rows_of({ quotas: QUOTAS, hold })

		expect(claude).toBe('  Claude    🛑 limit · resumes ↻ 14:00 · 3 parked')
		expect(codex).toContain('45%')
	})
})

describe('run_board_render_quota gauge colors', () => {
	it.each([
		{ used: 10, remaining: 0.2, shade: 32 },
		{ used: 40, remaining: 0.9, shade: 33 },
		{ used: 55, remaining: 0.2, shade: 33 },
		{ used: 95, remaining: 0.02, shade: 31 },
	])(
		'keeps $used% plain while coloring both providers and windows with $shade',
		({ used, remaining, shade }) => {
			vi.stubEnv('FORCE_COLOR', '1')
			const windows = [FIVE_HOURS, SEVEN_DAYS].map((minutes) =>
				window_of(minutes, used, minutes * MINUTE_MS * remaining),
			)
			const quotas = {
				claude: reading(windows, NOW_MS - HOUR_MS),
				codex: reading(windows, NOW_MS - HOUR_MS),
			}
			const part = usage_part({ quotas, now_ms: NOW_MS })
			const lines = part?.lines ?? []

			expect(lines).toHaveLength(2)

			for (const line of lines) {
				expect(line.text.split(`${String(used)}% `)).toHaveLength(3)

				expect(line.text.split(`\u{1B}[${String(shade)}m■`).length).toBeGreaterThan(2)
				expect(line.text.endsWith('\u{1B}[2m60′\u{1B}[22m')).toBe(true)
			}
		},
	)

	it('names ⛽, ┊, ↻ and ▶ in the legend', () => {
		expect(LEGEND.join(' ')).toBe('⛽ usage 🤖 scheduler ┊ pace ↻ reset ≈ tasks left ▶ transport')
	})
})
