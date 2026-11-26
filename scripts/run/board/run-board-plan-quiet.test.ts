import { backlog_plan_read } from '#scripts/backlog/backlog-plan-read'
import { epic_classify } from '#scripts/epic/epic-classify'
import { describe, expect, it, vi } from 'vitest'
import { run_board_plan } from './run-board-plan'

// joshuafolkken/kit#4292: the board leads a row withheld for a person with 🙋, so its live read says no ❗
// notice over the frame.

vi.mock('#scripts/backlog/backlog-plan-read', () => ({
	backlog_plan_read: {
		read_open: vi.fn(async () => ({
			listing: {
				rows: [
					{ number: 1, title: 'Open', createdAt: '2026-01-01T00:00:00Z', blockedBy: { nodes: [] } },
				],
				is_capped: false,
			},
		})),
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
		// joshuafolkken/kit#8220: the listing read beside the pool is handed on, so the epics come from it.
		expect(backlog_plan_read.classify).toHaveBeenCalledWith(
			expect.anything(),
			[],
			expect.any(Function),
			expect.objectContaining({ is_capped: false }),
		)
	})

	// joshuafolkken/kit#9007: the board draws only the cells it changed, so a notice the resolution passes
	// to its port — the defect rate above its baseline or unmeasured, an epic notice, a refusal, an
	// oversize row — must write nothing.
	it('hands the classification a report port that writes nothing', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await run_board_plan.read_plan({ issues: [], only: false })
		const report = vi.mocked(backlog_plan_read.classify).mock.calls.at(-1)?.[2]

		report?.('The defect rate 1.47 (398 / 271) is above its baseline 1.26')
		expect(report).toBeTypeOf('function')
		expect(error).not.toHaveBeenCalled()
		expect(write).not.toHaveBeenCalled()
		expect(info).not.toHaveBeenCalled()
	})
})
