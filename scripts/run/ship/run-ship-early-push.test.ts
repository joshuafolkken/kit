import { josh_command } from '#scripts/josh/josh-run'
import { early_push_record } from '#scripts/run/early-push-record'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_early_push } from './run-ship-early-push'
import { run_ship_probe } from './run-ship-probe'
import type { ShipArguments } from './run-ship-steps'

const ARGS: ShipArguments = {
	title: 'Overlap CI #6251',
	number: '6251',
	body: ['--body-file', '/draft.md'],
	body_path: '/draft.md',
	notify: [],
	cites: [],
	is_review: true,
	is_detach: false,
	unpinned_ok: [],
}
const COMMITTED = { is_committed: true, is_pushed: false, is_merged: false }

beforeEach(() => {
	vi.spyOn(run_ship_probe, 'read_state').mockResolvedValue(COMMITTED)
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })
	vi.spyOn(early_push_record, 'record').mockResolvedValue()
})
afterEach(() => vi.restoreAllMocks())

describe('run_ship_early_push.push', () => {
	it('pushes the committed tree and opens the PR with the body', async () => {
		await run_ship_early_push.push(ARGS)

		expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(
			['git', '-y', '--skip-commit', ...ARGS.body, ARGS.title],
			true,
		)
		expect(early_push_record.record).toHaveBeenCalledWith('ship', 'pushed')
	})

	it.each([
		[{ ...COMMITTED, is_committed: false }, 'uncommitted'],
		[{ ...COMMITTED, is_pushed: true }, 'already-pushed'],
	])('skips a tree with state %o and records %s', async (state, reason) => {
		vi.mocked(run_ship_probe.read_state).mockResolvedValue(state)
		await run_ship_early_push.push(ARGS)

		expect(josh_command.josh_run).not.toHaveBeenCalled()
		expect(early_push_record.record).toHaveBeenCalledWith('ship', reason)
	})

	it('records a failed push so the ordinary commit stage can retry', async () => {
		vi.mocked(josh_command.josh_run).mockResolvedValue({ code: 1, out: 'refused' })
		await expect(run_ship_early_push.push(ARGS)).resolves.toBeUndefined()

		expect(early_push_record.record).toHaveBeenCalledWith('ship', 'push-failed')
	})
})
