import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { expect, test, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'

const ACTIVE = new Date().toISOString()
const CARRY = {
	invocation: 'backlogrun #1 #2 --max 1',
	started_at: ACTIVE,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const CONTEXT = { is_only: false, forwarded: ['--max', '1'], owner: String(process.pid) }

test('honors the merged maximum before the second named issue', async () => {
	const carry = { ...CARRY, done: [1], merged: 1 }
	const state = backlog_drive.initial_state([], ACTIVE)
	const offer = await backlog_drive_named_offer.read(carry, state, CONTEXT)

	expect(offer?.verdict).toBe('stop')
})

test('hands a named epic to the judgment session instead of launching the root', async () => {
	const state = backlog_drive.initial_state([], ACTIVE)
	const read = vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: ['epic'], is_human_review: false },
	})

	const offer = await backlog_drive_named_offer.read(CARRY, state, CONTEXT)

	expect(offer?.verdict).toBe('epic #1')
	read.mockRestore()
})
