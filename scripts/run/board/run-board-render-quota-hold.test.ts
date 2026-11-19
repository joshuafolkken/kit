import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_render_quota, type QuotaHold } from './run-board-render-quota'

const { usage_part } = run_board_render_quota
const HOUR_MS = 3_600_000
const NOW_MS = new Date(2026, 9, 29, 12, 0).getTime()
const RESET_MS = NOW_MS + 2 * HOUR_MS
const LIMIT_ROW = '     Claude    🛑 limit · resumes ↻ 14:00 · 3 parked'

function claude_row(hold: QuotaHold): string {
	const part = usage_part({ quotas: { claude: undefined, codex: undefined }, now_ms: NOW_MS, hold })

	return stripVTControlCharacters(part?.lines[0]?.text ?? '')
}

describe('run_board_render_quota.usage_part hold cause', () => {
	it('reads an authentication-failure hold as a recheck, not a usage limit', () => {
		const row = claude_row({ reset_ms: RESET_MS, parked: 8, cause: 'auth' })

		expect(row).toBe('     Claude    🔑 auth failed · recheck ↻ 14:00 · 8 parked')
		expect(row).not.toMatch(/limit|resumes/u)
	})

	it.each([undefined, 'limit' as const])(
		'keeps the usage-limit row where the cause is %s',
		(cause) => {
			expect(claude_row({ reset_ms: RESET_MS, parked: 3, cause })).toBe(LIMIT_ROW)
		},
	)
})
