import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_close } from '#scripts/lane/lane-close'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3442: a parent that counted a closed child by hand (`run:carry --merged`) and then
// ran `run:merge` for it must not count the merge twice — the run is owed only the merge event, which
// `run:merge` writes after `do_merged`. The carry record is real, so the duplicate guard in
// `run-carry-change.ts` is exercised through the merge step rather than restated.

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_add_label: vi.fn(),
		issue_remove_label: vi.fn(),
		issue_try_comment: vi.fn(),
	},
}))

vi.mock('#scripts/lane/lane-reap', () => ({
	lane_reap: { reap_child: vi.fn().mockReturnValue([]) },
}))

const { run_merge_steps } = await import('./run-merge-steps')

const CHILD = 3441
const CONTEXT = {
	child: String(CHILD),
	epic: undefined,
	repo: undefined,
	over: CONTEXT_CUT_THRESHOLD,
	owner: run_carry.NO_OWNER,
}

function counted_carry(): RunCarry {
	return {
		invocation: `backlogrun #${String(CHILD)} --only`,
		started_at: new Date().toISOString(),
		merged: 1,
		merged_issues: [CHILD],
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
	}
}

const LANE_PARENT = mkdtempSync(path.join(tmpdir(), 'merged-again-lane-'))
const MISSING_LANE = path.join(LANE_PARENT, 'no-such-lane')

function write_carry(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'merged-again-'))

	writeFileSync(run_carry.carry_path(directory), JSON.stringify(counted_carry()))
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)

	return run_carry.carry_path(directory)
}

beforeEach(() => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })
	vi.spyOn(lane_close, 'resolve_lane').mockResolvedValue({
		existing: undefined,
		targets: { directory: MISSING_LANE, branch: `${String(CHILD)}-lane` },
	})
})

describe('run_merge_steps.do_merged — a child already counted by hand', () => {
	it('leaves the merged count and issue list unchanged', async () => {
		const target = write_carry()

		expect(await run_merge_steps.do_merged(CONTEXT)).toBeUndefined()

		const read = run_carry.read_carry(target)

		expect(read.kind === 'carried' ? read.carry : undefined).toMatchObject({
			merged: 1,
			merged_issues: [CHILD],
		})
	})
})
