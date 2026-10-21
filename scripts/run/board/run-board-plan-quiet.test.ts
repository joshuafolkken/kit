import { backlog_plan_read } from '#scripts/backlog/backlog-plan-read'
import { epic_classify } from '#scripts/epic/epic-classify'
import { describe, expect, it, vi } from 'vitest'
import { run_board_plan } from './run-board-plan'

// joshuafolkken/kit#4292: the board leads a row withheld for a person with 🙋, so its live read says no ❗
// notice over the frame.

vi.mock('#scripts/backlog/backlog-plan-read', () => ({
	backlog_plan_read: {
		fetch_open: vi.fn(async () => ({ rows: [], is_capped: false })),
		classify: vi.fn(async () => undefined),
		context_of: vi.fn(),
	},
}))

vi.mock('#scripts/auto-ok/auto-ok-cli', () => ({
	auto_ok_cli: { fetch_opted_in: vi.fn(async () => ({ kind: 'read', issues: [] })) },
}))

vi.mock('#scripts/epic/epic-classify', () => ({ epic_classify: { mute_notices: vi.fn() } }))

describe('run_board_plan.read_plan — the live ports', () => {
	it('mutes the withheld-blocker notice before it classifies', async () => {
		await run_board_plan.read_plan({ issues: [], only: false })

		expect(epic_classify.mute_notices).toHaveBeenCalled()
		expect(backlog_plan_read.classify).toHaveBeenCalled()
	})
})
