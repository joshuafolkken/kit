import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuotaReading, Quotas } from './run-board-quota-read'
import { run_board_render_quota, type QuotaView } from './run-board-render-quota'

const { LEGEND, usage_part } = run_board_render_quota
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const NOW_MS = new Date(2026, 9, 29, 12, 0).getTime()
const FIVE_HOURS = 300
const SEVEN_DAYS = 10_080
const THIRTY_DAYS = 43_200

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

const QUOTAS: Quotas = {
	claude: reading([
		window_of(FIVE_HOURS, 42, 2 * HOUR_MS),
		window_of(SEVEN_DAYS, 68, 3 * 24 * HOUR_MS),
	]),
	codex: reading([window_of(SEVEN_DAYS, 45, 10 * 24 * HOUR_MS)]),
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_render_quota.usage_part', () => {
	it('draws no section where no reader is open', () => {
		expect(usage_part({ quotas: undefined, now_ms: NOW_MS })).toBeUndefined()
	})

	it('draws a row per provider under 5h and 7d, with ┊ and ↻, and sums them up folded', () => {
		const part = usage_part({ quotas: QUOTAS, now_ms: NOW_MS })
		const [claude, codex] = rows_of({ quotas: QUOTAS })

		expect(part?.label).toBe('⛽ usage')
		expect(part?.summary).toBe('claude 42/68 · codex —/45')
		expect(stripVTControlCharacters(part?.head.join('\n') ?? '')).toContain('5h')
		expect(claude).toBe('  claude        42% ■■■■──┊───  ↻ 14:00      68% ■■■■■┊■───  ↻ Sun 12:00')
		expect(codex).toBe('  codex          —                           45% ┊■■■■─────  ↻ 11/08')
	})

	it('places a 30-day window under 7d and ends the row on its length', () => {
		const quotas = { claude: undefined, codex: reading([window_of(THIRTY_DAYS, 7, HOUR_MS)]) }
		const [claude, codex] = rows_of({ quotas })

		expect(claude).toBe('  claude         —                            —')
		expect(codex).toMatch(/↻ 13:00 *30d$/u)
		expect(codex).toContain(' 7% ')
	})

	it('draws a window whose reset has passed as empty, its reset rolled on a window', () => {
		const quotas = { claude: reading([window_of(FIVE_HOURS, 80, -HOUR_MS)]), codex: undefined }
		const [claude] = rows_of({ quotas })

		expect(claude).toMatch(/ 0% .*↻ 16:00/u)
	})
})

describe('run_board_render_quota.usage_part hold and age', () => {
	it('dims a reading older than ten minutes and says how old it is', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const old = reading([window_of(FIVE_HOURS, 10, HOUR_MS)], NOW_MS - 11 * MINUTE_MS)
		const part = usage_part({ quotas: { claude: old, codex: undefined }, now_ms: NOW_MS })
		const [claude] = rows_of({ quotas: { claude: old, codex: undefined } })

		expect(part?.lines[0]?.text).toContain('\u{1B}[2m')
		expect(claude).toMatch(/\(11′ ago\)$/u)
	})

	it("reads Claude's row as the hold while a usage limit stops the launches", () => {
		const hold = { reset_ms: NOW_MS + 2 * HOUR_MS, parked: 3 }
		const [claude, codex] = rows_of({ quotas: QUOTAS, hold })

		expect(claude).toBe('  claude       🛑 limit · resumes ↻ 14:00 · 3 parked')
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
			const quotas = { claude: reading(windows), codex: reading(windows) }
			const part = usage_part({ quotas, now_ms: NOW_MS })
			const lines = part?.lines ?? []

			expect(lines).toHaveLength(2)

			for (const line of lines) {
				expect(line.text.split(`${String(used)}% `)).toHaveLength(3)

				expect(line.text.split(`\u{1B}[${String(shade)}m■`).length).toBeGreaterThan(2)
			}
		},
	)

	it('names ⛽, ┊ and ↻ in the legend', () => {
		expect(LEGEND).toEqual(['⛽ usage', '┊ pace', '↻ reset'])
	})
})
