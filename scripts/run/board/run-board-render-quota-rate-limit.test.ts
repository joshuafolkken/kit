import { stripVTControlCharacters } from 'node:util'
import type { CoreRateLimit } from '#scripts/gh/gh-core-rate-limit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { Quotas } from './run-board-quota-read'
import { run_board_render_quota, type QuotaView } from './run-board-render-quota'
import type { GithubRateLimit } from './run-board-render-quota-github'

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
const REST_ONLY: GithubRateLimit = { core: CORE, graphql: undefined }
const PASSED: GithubRateLimit = { core: { ...CORE, reset_ms: NOW_MS - 1 }, graphql: undefined }

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
	const core = { ...CORE, remaining, reset_ms: NOW_MS + reset_minutes * MINUTE_MS }
	const rate_limit = { core, graphql: undefined }
	const row = String(usage_part({ quotas: QUOTAS, now_ms: NOW_MS, rate_limit })?.lines[2]?.text)

	return row.slice(row.indexOf('%') + 1, row.indexOf('■'))
}

describe('run_board_render_quota.usage_part rate limit row', () => {
	it('draws the rest calls spent as a gauge, the calls left and the bare reset time after the usage limits', () => {
		const { rows } = part_of({ rate_limit: REST_ONLY })

		expect(rows).toHaveLength(3)
		expect(rows[2]).toBe(
			`  GitHub      REST  38% ${'■'.repeat(8)}─┊${'─'.repeat(10)} 3123     12:33`,
		)
	})

	it('starts the GitHub name at the Codex name column while a scheduler is marked', () => {
		const { rows } = part_of({ rate_limit: REST_ONLY, scheduler_provider: 'claude' })

		expect(rows[2]?.indexOf('GitHub')).toBe(rows[1]?.indexOf('Codex'))
		expect(rows[2]).toMatch(/^ {5}GitHub {3}REST {2}38% \S{20} 3123 {5}12:33$/u)
	})

	it('puts the pace mark where the clock is through the hour-long window', () => {
		const core = { ...CORE, remaining: 5000, reset_ms: NOW_MS + 15 * MINUTE_MS }

		expect(part_of({ rate_limit: { core, graphql: undefined } }).rows[2]).toContain(
			`  0% ${'─'.repeat(15)}┊${'─'.repeat(4)}`,
		)
	})

	it('shades the gauge yellow from half, red from nine tenths, a step up past the pace mark', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const [normal, yellow, red] = [shade_of(4500, 10), shade_of(2000, 10), shade_of(250, 10)]

		expect(new Set([normal, yellow, red]).size).toBe(3)
		expect(shade_of(4500, 55)).toBe(yellow)
		expect(shade_of(2000, 45)).toBe(red)
	})

	it('draws the allowance unspent, its whole limit left and without a reset once its reset has passed', () => {
		expect(part_of({ rate_limit: PASSED }).rows[2]).toBe(
			`  GitHub      REST   0% ┊${'─'.repeat(19)} 5000`,
		)
	})
})

describe('run_board_render_quota.usage_part rate limit row beside 7d-only rows', () => {
	it('draws the usage limits as before, without the allowance, where it could not be read', () => {
		const { rows } = part_of({ rate_limit: undefined })

		expect(rows).toHaveLength(2)
		expect(rows.join('\n')).not.toContain('GitHub')
	})

	it('starts the 7d gauges and the GitHub REST gauge at one column, GitHub without `1h`', () => {
		const week = { minutes: 10_080, used_percent: 46, resets_ms: NOW_MS + 24 * HOUR_MS }
		const reading = { windows: [week], taken_ms: NOW_MS }
		const { rows } = part_of({ quotas: { claude: reading, codex: reading }, rate_limit: REST_ONLY })

		expect(rows.map((row) => row.indexOf('%'))).toStrictEqual([22, 22, 22])
		expect(rows.join('\n')).not.toMatch(/ {2}—|1h/u)
	})
})

// joshuafolkken/kit#6828: label, percent, count and reset time end on one column in all three rows.
function end_of(row: string, text: string): number {
	return run_board_fit.width_of(row.slice(0, row.indexOf(text) + text.length))
}

describe('run_board_render_quota.usage_part column alignment', () => {
	const WEEK = 10_080
	const week = { minutes: WEEK, used_percent: 46, resets_ms: NOW_MS + 24 * HOUR_MS }

	it('lines up the Claude, Codex and GitHub rows column by column', () => {
		const claude = { windows: [week], taken_ms: NOW_MS, per_task: { [WEEK]: 0.125 } }
		const codex = { windows: [week], taken_ms: NOW_MS - HOUR_MS, per_task: { [WEEK]: 1 } }
		const quotas = { claude, codex }
		const { rows } = part_of({ quotas, rate_limit: REST_ONLY, scheduler_provider: 'claude' })
		const cells = [
			['7d', '46%', '≈432', 'Fri 12:00'],
			['7d', '46%', '≈54', 'Fri 12:00'],
			['REST', '38%', '3123', '12:33'],
		]
		const ends = cells.map((texts, index) => texts.map((text) => end_of(rows[index] ?? '', text)))

		expect(ends).toStrictEqual([
			[18, 23, 49, 59],
			[18, 23, 49, 59],
			[18, 23, 49, 59],
		])
		expect(rows[1]).toMatch(/Fri 12:00 60′$/u)
	})

	it('keeps REST in the 7d column with ▶ while the session reads through REST', () => {
		const quotas = { claude: { windows: [week], taken_ms: NOW_MS }, codex: undefined }
		const rate_limit: GithubRateLimit = { ...REST_ONLY, transport: 'rest' }
		const { rows } = part_of({ quotas, rate_limit })
		const claude = rows.at(0) ?? ''
		const github = rows.at(-1) ?? ''

		expect(github).toContain(' ▶ REST ')
		expect([end_of(github, 'REST'), end_of(github, '38%')]).toStrictEqual([
			end_of(claude, '7d'),
			end_of(claude, '46%'),
		])
	})
})

describe('run_board_render_quota.usage_part rate limit summary', () => {
	it('sums the allowance up in the folded line', () => {
		expect(part_of({ rate_limit: REST_ONLY }).summary).toBe(
			'Claude 42 · Codex — · GitHub REST 38% 1877/5000 ↻12:33',
		)
	})

	it('sums the allowance up without a reset once it has passed', () => {
		expect(part_of({ rate_limit: PASSED }).summary).toBe(
			'Claude 42 · Codex — · GitHub REST 0% 0/5000',
		)
	})

	it('sums the usage limits up as before where the allowance could not be read', () => {
		expect(part_of({ rate_limit: undefined }).summary).toBe('Claude 42 · Codex —')
	})
})
