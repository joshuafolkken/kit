import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_close } from '#scripts/lane/lane-close'
import { run_carry } from '#scripts/run/carry/run-carry'
import { describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4300: a close a process outlived exits non-zero. The merge is already done, so the
// run logs the incomplete close and carries on — the supervisor closes the lane again.

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_add_label: vi.fn(), issue_try_comment: vi.fn() },
}))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))
vi.mock('#scripts/lane/lane-reap', () => ({ lane_reap: { reap_child: vi.fn() } }))
vi.mock('#scripts/epic/epic-close', () => ({ epic_close: { close_completed_epics: vi.fn() } }))

const { run_merge_steps } = await import('./run-merge-steps')

const CONTEXT = {
	child: '4300',
	epic: undefined,
	repo: undefined,
	over: true as const,
	owner: run_carry.NO_OWNER,
}
// No `.git` in it, so the merged path closes it without a stash.
const LANE_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'lane-close-'))
const LANE_CLOSE_COMMAND = 'lane:close'
const REASON = 'Closing the lane for #4300 left this behind: process 912 (owned by root).'

async function run_with(
	command: string | undefined,
): Promise<{ code: number; out: string; err: string }> {
	await Promise.resolve()

	return command === LANE_CLOSE_COMMAND
		? { code: 1, out: '', err: REASON }
		: { code: 0, out: '', err: '' }
}

describe('run_merge_steps.do_merged — an incomplete lane close', () => {
	it('logs the incomplete close and finishes the merged step', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue()

		vi.spyOn(lane_close, 'resolve_lane').mockResolvedValue({
			existing: undefined,
			targets: { directory: LANE_DIRECTORY, branch: `${CONTEXT.child}-lane` },
		})
		vi.spyOn(josh_command, 'josh_run').mockImplementation(
			async ([command]) => await run_with(command),
		)

		await expect(run_merge_steps.do_merged(CONTEXT, vi.fn())).resolves.toBeUndefined()
		expect(error).toHaveBeenCalledWith(REASON)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('lane:close is incomplete'))
	})
})
