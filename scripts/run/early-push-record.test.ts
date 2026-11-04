import { git_command } from '#scripts/git/git-command'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { early_push_record } from './early-push-record'

const METHOD = 'record_early_push'
const SOURCE = 'review'
const REASON = 'dirty-tree'

afterEach(() => vi.restoreAllMocks())

describe('early_push_record.record', () => {
	it('records the decision with its source and issue', async () => {
		vi.spyOn(git_command, 'branch').mockResolvedValue('6251-lane')
		const record = vi.spyOn(lane_ledger_write, METHOD).mockResolvedValue()

		await early_push_record.record(SOURCE, REASON)

		expect(record).toHaveBeenCalledWith({ source: SOURCE, result: REASON, issue: 6251 })
	})

	it('does not fail the push when the branch cannot be read', async () => {
		vi.spyOn(git_command, 'branch').mockRejectedValue(new Error('not a repository'))

		await expect(early_push_record.record('ship', 'pushed')).resolves.toBeUndefined()
	})
})
