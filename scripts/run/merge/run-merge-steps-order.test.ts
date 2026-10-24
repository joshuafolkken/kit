import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_close } from '#scripts/lane/lane-close'
import { poll } from '#scripts/lib/poll'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_merge } from './run-merge'

// joshuafolkken/kit#4734: the merge is put on record dated to the ownership check, ahead of the lane
// close, and only once the primary checkout synced — a failed sync leaves the child for the next pass.

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_add_label: vi.fn(), issue_try_comment: vi.fn() },
}))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))
vi.mock('#scripts/lane/lane-reap', () => ({ lane_reap: { reap_child: vi.fn() } }))
vi.mock('#scripts/epic/epic-close', () => ({ epic_close: { close_completed_epics: vi.fn() } }))

const { run_merge_steps } = await import('./run-merge-steps')

const CONTEXT = {
	child: '4734',
	epic: undefined,
	repo: undefined,
	over: CONTEXT_CUT_THRESHOLD,
	owner: run_carry.NO_OWNER,
}
// No `.git` in it, so the merged path closes it without a stash.
const LANE_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'lane-order-'))
const CARRY: RunCarry = {
	invocation: 'backlogrun #4734',
	started_at: new Date().toISOString(),
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

const SYNC = 'main:sync'
const CLOSE = 'lane:close'
const RECORD = `record ${CONTEXT.child}`
const CHECKED_AT = new Date('2026-10-24T00:00:00.000Z')
const SYNCED_AT = new Date('2026-10-24T00:00:15.000Z')
const steps: Array<string> = []
const recorded_at: Array<Date> = []

// Settles on a timer, later than any stubbed step, so a recorder the step did not await lands after
// the lane close.
async function record(child: string, at: Date): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, 0)
	})
	steps.push(`record ${child}`)
	recorded_at.push(at)
}

function stub_carry(carry: RunCarry): void {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/stub')
	vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry })
	vi.spyOn(run_carry, 'apply_change').mockImplementation(() => {
		steps.push('count')

		return carry
	})
}

beforeEach(() => {
	steps.length = 0
	recorded_at.length = 0
	vi.spyOn(lane_close, 'resolve_lane').mockResolvedValue({
		existing: undefined,
		targets: { directory: LANE_DIRECTORY, branch: `${CONTEXT.child}-lane` },
	})
	vi.spyOn(josh_command, 'josh_run').mockImplementation(async ([command = '']) => {
		await Promise.resolve()
		steps.push(command)

		return { code: 0, out: '' }
	})
})

describe('run_merge_steps.do_merged — the order of a merged child’s steps', () => {
	it('syncs, counts and puts the merge on record before the lane closes', async () => {
		stub_carry(CARRY)

		await run_merge_steps.do_merged(CONTEXT, record)

		expect(steps).toStrictEqual([SYNC, 'count', RECORD, CLOSE])
	})

	it('neither counts nor records a child whose sync failed', async () => {
		stub_carry(CARRY)
		vi.spyOn(poll, 'sleep').mockResolvedValue()
		vi.mocked(josh_command.josh_run).mockResolvedValue({ code: 1, out: '' })

		await expect(run_merge_steps.do_merged(CONTEXT, record)).rejects.toThrow(/main:sync/u)

		expect(steps).not.toContain('count')
		expect(steps).not.toContain(RECORD)
	})

	it('mirrors the count it applied onto the epic', async () => {
		stub_carry(CARRY)

		await run_merge_steps.do_merged({ ...CONTEXT, epic: '4700' }, record)

		expect(git_gh_issue_write.issue_try_comment).toHaveBeenCalledWith(
			'4700',
			run_merge.counters_comment(CARRY),
		)
	})

	it('records nothing for a session whose carry was handed off', async () => {
		stub_carry({ ...CARRY, is_handed_off: true })

		await run_merge_steps.do_merged(CONTEXT, record)

		expect(steps).toStrictEqual([])
	})
})

describe('run_merge_steps.do_merged — the date a merged child is recorded at', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('dates the record to the ownership check, not to the end of the sync', async () => {
		stub_carry(CARRY)
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(CHECKED_AT)
		vi.mocked(josh_command.josh_run).mockImplementation(async () => {
			await Promise.resolve()
			vi.setSystemTime(SYNCED_AT)

			return { code: 0, out: '' }
		})

		await run_merge_steps.do_merged(CONTEXT, record)

		expect(recorded_at).toStrictEqual([CHECKED_AT])
	})
})
