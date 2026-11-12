import { stripVTControlCharacters } from 'node:util'
import type { CoreRateLimit } from '#scripts/gh/gh-core-rate-limit'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { Quotas } from './run-board-quota-read'
import { run_board_render_quota, type QuotaView } from './run-board-render-quota'
import type { GithubRateLimit } from './run-board-render-quota-github'

// joshuafolkken/kit#6822: the github row draws the REST core and GraphQL allowances as two 20-wide
// gauges on one row, each with its own calls left and reset time (joshuafolkken/kit#6828), two spaces
// apart, ▶ marking the session's transport in place of the former `(auto)` setting, and the usage
// legend names ▶.

const { LEGEND, usage_part } = run_board_render_quota
const MINUTE_MS = 60_000
const NOW_MS = new Date(2026, 9, 29, 12, 0).getTime()
const QUOTAS: Quotas = { claude: undefined, codex: undefined }
const CORE: CoreRateLimit = { remaining: 3123, limit: 5000, reset_ms: NOW_MS + 33 * MINUTE_MS }
const GRAPHQL: CoreRateLimit = { remaining: 4952, limit: 5000, reset_ms: NOW_MS + 40 * MINUTE_MS }
const BOTH: GithubRateLimit = { core: CORE, graphql: GRAPHQL }
// The board's rule beside the usage rows, as the Issue measured it.
const BOARD_WIDTH = 115
const BAR_WIDTH = 20
const BARS = /[■─┊]{2,}/gu

function row_of(view: Partial<QuotaView>): string {
	const part = usage_part({ quotas: QUOTAS, now_ms: NOW_MS, ...view })

	return stripVTControlCharacters(part?.lines.at(-1)?.text ?? '')
}

function summary_of(rate_limit: GithubRateLimit): string {
	return usage_part({ quotas: QUOTAS, now_ms: NOW_MS, rate_limit })?.summary ?? ''
}

describe('run_board_render_quota.usage_part github row gauges', () => {
	it('draws REST and GraphQL two spaces apart, each with its own calls left and bare reset time', () => {
		const row = row_of({ rate_limit: BOTH })

		expect(row).toMatch(
			/^ {2}GitHub {6}REST {2}38% \S{20} 3123 {5}12:33 {2}GraphQL {3}1% \S{20} 4952 {5}12:40$/u,
		)
		expect(row).not.toMatch(/↻| · |▶/u)
	})

	it('keeps both gauges 20 wide and the widest row within the board', () => {
		const spent = { remaining: 0, limit: 5000, reset_ms: NOW_MS + 59 * MINUTE_MS }
		const rate_limit: GithubRateLimit = { core: spent, graphql: spent, transport: 'graphql' }
		const row = row_of({ rate_limit, scheduler_provider: 'claude' })

		expect(row.match(BARS)?.map((bar) => bar.length)).toStrictEqual([BAR_WIDTH, BAR_WIDTH])
		expect(run_board_fit.width_of(row)).toBeLessThanOrEqual(BOARD_WIDTH)
	})

	it('draws REST alone where GraphQL could not be read', () => {
		expect(row_of({ rate_limit: { core: CORE, graphql: undefined } })).not.toContain('GraphQL')
	})
})

describe('run_board_render_quota.usage_part github row transport', () => {
	it('marks GraphQL with ▶ and a space while the session reads through it', () => {
		const row = row_of({ rate_limit: { ...BOTH, transport: 'graphql' } })

		expect(row).toContain('  GitHub      REST  38% ')
		expect(row).toContain('12:33  ▶ GraphQL   1% ')
	})

	it('moves ▶ to REST once the session falls back to it, REST kept in its column', () => {
		const row = row_of({ rate_limit: { ...BOTH, transport: 'rest' } })

		expect(row).toContain('  GitHub    ▶ REST  38% ')
		expect(row).toContain('12:33  GraphQL   1% ')
	})

	it('names the transport setting nowhere, `(auto)` included', () => {
		const rate_limit: GithubRateLimit = { ...BOTH, transport: 'graphql' }

		expect(`${row_of({ rate_limit })}\n${summary_of(rate_limit)}`).not.toContain('(auto)')
	})

	it('sums both allowances up in the folded line, ▶ on the transport', () => {
		expect(summary_of({ ...BOTH, transport: 'graphql' })).toBe(
			'Claude — · Codex — · GitHub REST 38% 1877/5000 ↻12:33 · ▶ GraphQL 1% 48/5000 ↻12:40',
		)
	})

	it('names ▶ in the usage legend', () => {
		expect(LEGEND).toContain('▶ transport')
	})
})
