import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InteractionStatus } from './review-interaction'
import { review_record_interaction } from './review-record-interaction'

// joshuafolkken/kit#4835: a round-1 fix reached the run tooling, the record said nothing, and the
// ship's review stage ran the interaction review alone and stopped on its finding.

const { status_mock } = vi.hoisted(() => ({ status_mock: vi.fn() }))

vi.mock('./review-interaction', () => ({ review_interaction: { status: status_mock } }))

const ISSUE = 4835
const ROOT = '/ledger-root'

async function printed_for(status: InteractionStatus): Promise<string> {
	status_mock.mockResolvedValue(status)

	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	await review_record_interaction.report_due(ISSUE, ROOT)

	return info.mock.calls.map((call) => String(call[0])).join('\n')
}

describe('review_record_interaction.report_due', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		status_mock.mockReset()
	})

	it('names the interaction brief when the pass is due and unrecorded', async () => {
		const out = await printed_for('missing')

		expect(out).toBe(review_record_interaction.due_line(ISSUE))
		expect(out).toContain('pnpm josh review:brief --interaction')
		expect(status_mock).toHaveBeenCalledWith(ISSUE, ROOT)
	})

	// A reviewer that already ran beside round 1 is recorded, not run again.
	it('records first and runs the pass only where none ran beside the round', () => {
		const line = review_record_interaction.due_line(ISSUE)

		expect(line).toContain(
			'record it with `pnpm josh review:record --from-slot --interaction --issue 4835 [<n>=<disposition> ...]`',
		)
		expect(line).toContain('if no interaction reviewer ran beside this round, first open its brief')
	})

	// joshuafolkken/kit#5656: a run-tooling change that only edits comments is not due either.
	it('names the comment-only change among the reasons no pass is due', () => {
		expect(review_record_interaction.NOT_REQUIRED_LINE).toContain('changes only comments in it')
	})

	it.each<InteractionStatus>(['ok', 'not-required'])('prints nothing on %s', async (status) => {
		expect(await printed_for(status)).toBe('')
	})

	it('prints nothing and does not throw when the status cannot be read', async () => {
		status_mock.mockRejectedValue(new Error('git failed'))

		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await expect(review_record_interaction.report_due(ISSUE, ROOT)).resolves.toBeUndefined()
		expect(info).not.toHaveBeenCalled()
	})
})
