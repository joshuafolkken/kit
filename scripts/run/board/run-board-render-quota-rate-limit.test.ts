import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { Quotas } from './run-board-quota-read'
import type { CoreRateLimit } from './run-board-rate-limit'
import { run_board_render_quota, type QuotaView } from './run-board-render-quota'

// joshuafolkken/kit#6559: GitHub's core rate limit is drawn after the usage-limit rows and summed up in
// the folded line; where it could not be read, the usage row is drawn as before without it.

const { usage_part } = run_board_render_quota
const HOUR_MS = 3_600_000
const NOW_MS = new Date(2026, 9, 29, 12, 0).getTime()
const QUOTAS: Quotas = {
	claude: {
		windows: [{ minutes: 300, used_percent: 42, resets_ms: NOW_MS + HOUR_MS }],
		taken_ms: NOW_MS,
	},
	codex: undefined,
}
const CORE: CoreRateLimit = { remaining: 4321, limit: 5000, reset_ms: NOW_MS + HOUR_MS }

function part_of(view: Partial<QuotaView>): { rows: Array<string>; summary: string } {
	const part = usage_part({ quotas: QUOTAS, now_ms: NOW_MS, ...view })
	const rows = (part?.lines ?? []).map((line) => stripVTControlCharacters(line.text))

	return { rows, summary: part?.summary ?? '' }
}

describe('run_board_render_quota.usage_part rate limit', () => {
	it('draws the core allowance and its reset on a row after the usage limits', () => {
		const { rows } = part_of({ rate_limit: CORE })

		expect(rows).toHaveLength(3)
		expect(rows[2]).toBe('  github       4321/5000 ↻ 13:00')
	})

	it('starts the github name at the codex name column while a scheduler is marked', () => {
		const { rows } = part_of({ rate_limit: CORE, scheduler_provider: 'claude' })

		expect(rows[2]?.indexOf('github')).toBe(rows[1]?.indexOf('codex'))
		expect(rows[2]).toBe('     github    4321/5000 ↻ 13:00')
	})

	it('draws the allowance full and without a reset once its reset has passed', () => {
		const passed = { ...CORE, remaining: 0, reset_ms: NOW_MS - 1 }

		expect(part_of({ rate_limit: passed }).rows[2]).toBe('  github       5000/5000')
	})

	it('sums the allowance up in the folded line', () => {
		expect(part_of({ rate_limit: CORE }).summary).toBe(
			'claude 42/— · codex —/— · github 4321/5000 ↻ 13:00',
		)
	})

	it('draws the usage limits as before, without the allowance, where it could not be read', () => {
		const { rows, summary } = part_of({ rate_limit: undefined })

		expect(rows).toHaveLength(2)
		expect(rows.join('\n')).not.toContain('github')
		expect(summary).toBe('claude 42/— · codex —/—')
	})
})
