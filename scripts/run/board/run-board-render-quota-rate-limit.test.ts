import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Quotas } from './run-board-quota-read'
import type { CoreRateLimit } from './run-board-rate-limit'
import { run_board_render_quota, type QuotaView } from './run-board-render-quota'

// joshuafolkken/kit#6559, joshuafolkken/kit#6621: GitHub's core rate limit is drawn as a usage gauge
// after the usage-limit rows and summed up in the folded line; where it could not be read, the usage
// row is drawn as before without it.

const { usage_part } = run_board_render_quota
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
const NOW_MS = new Date(2026, 9, 29, 12, 0).getTime()
const QUOTAS: Quotas = {
	claude: {
		windows: [{ minutes: 300, used_percent: 42, resets_ms: NOW_MS + HOUR_MS }],
		taken_ms: NOW_MS,
	},
	codex: undefined,
}
const RESET_MINUTES = 33
const CORE: CoreRateLimit = {
	remaining: 3123,
	limit: 5000,
	reset_ms: NOW_MS + RESET_MINUTES * MINUTE_MS,
}
const PASSED: CoreRateLimit = { ...CORE, reset_ms: NOW_MS - 1 }

afterEach(() => {
	vi.unstubAllEnvs()
})

function part_of(view: Partial<QuotaView>): { rows: Array<string>; summary: string } {
	const part = usage_part({ quotas: QUOTAS, now_ms: NOW_MS, ...view })
	const rows = (part?.lines ?? []).map((line) => stripVTControlCharacters(line.text))

	return { rows, summary: part?.summary ?? '' }
}

// The color escape the gauge's bar opens its filled cells with.
function shade_of(remaining: number, reset_minutes: number): string {
	const rate_limit = { ...CORE, remaining, reset_ms: NOW_MS + reset_minutes * MINUTE_MS }
	const row = String(usage_part({ quotas: QUOTAS, now_ms: NOW_MS, rate_limit })?.lines[2]?.text)

	return row.slice(row.indexOf('%') + 1, row.indexOf('■'))
}

describe('run_board_render_quota.usage_part rate limit row', () => {
	it('draws the calls spent as a gauge, its reset and the spent count after the usage limits', () => {
		const { rows } = part_of({ rate_limit: CORE })

		expect(rows).toHaveLength(3)
		expect(rows[2]).toBe(
			`  github        38% ${'■'.repeat(8)}─┊${'─'.repeat(10)}  ↻ 12:33      1877/5000`,
		)
	})

	it('starts the github name at the codex name column while a scheduler is marked', () => {
		const { rows } = part_of({ rate_limit: CORE, scheduler_provider: 'claude' })

		expect(rows[2]?.indexOf('github')).toBe(rows[1]?.indexOf('codex'))
		expect(rows[2]).toMatch(/^ {5}github\s+38% .*↻ 12:33\s+1877\/5000$/u)
	})

	it('puts the pace mark where the clock is through the hour-long window', () => {
		const rate_limit = { ...CORE, remaining: 5000, reset_ms: NOW_MS + 15 * MINUTE_MS }

		expect(part_of({ rate_limit }).rows[2]).toContain(`  0% ${'─'.repeat(15)}┊${'─'.repeat(4)}`)
	})

	it('shades the gauge yellow from half, red from nine tenths, a step up past the pace mark', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const [normal, yellow, red] = [shade_of(4500, 10), shade_of(2000, 10), shade_of(250, 10)]

		expect(new Set([normal, yellow, red]).size).toBe(3)
		expect(shade_of(4500, 55)).toBe(yellow)
		expect(shade_of(2000, 45)).toBe(red)
	})

	it('draws the allowance unspent, empty and without a reset once its reset has passed', () => {
		expect(part_of({ rate_limit: PASSED }).rows[2]).toBe(
			`  github         0% ┊${'─'.repeat(19)}               0/5000`,
		)
	})

	it('draws the usage limits as before, without the allowance, where it could not be read', () => {
		const { rows } = part_of({ rate_limit: undefined })

		expect(rows).toHaveLength(2)
		expect(rows.join('\n')).not.toContain('github')
	})
})

describe('run_board_render_quota.usage_part rate limit summary', () => {
	it('sums the allowance up in the folded line', () => {
		expect(part_of({ rate_limit: CORE }).summary).toBe(
			'claude 42/— · codex —/— · github 38% 1877/5000 ↻ 12:33',
		)
	})

	it('sums the allowance up without a reset once it has passed', () => {
		expect(part_of({ rate_limit: PASSED }).summary).toBe(
			'claude 42/— · codex —/— · github 0% 0/5000',
		)
	})

	it('sums the usage limits up as before where the allowance could not be read', () => {
		expect(part_of({ rate_limit: undefined }).summary).toBe('claude 42/— · codex —/—')
	})
})
