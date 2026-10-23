import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_dispatch } from './lane-dispatch'
import { lane_reap } from './lane-reap'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_restart } from './lane-restart'

// joshuafolkken/kit#4233: `git stash` refuses a tree with unresolved merge conflicts ("needs merge"),
// so `lane:restart` used to stop the child and then strand the lane. What is pinned against real git
// is that such a tree is refused before anything is stopped.

const ISSUE = '4233'
const FILE = 'shared.txt'
const BRANCH = 'side'

const reap_child = vi.spyOn(lane_reap, 'reap_child')
const claim_marker = vi.spyOn(lane_dispatch, 'claim_marker')

const fixture: FixtureWorkspace = {
	workspace: '',
	previous_cwd: process.cwd(),
	restore_environment: undefined,
}

function lane_at(directory: string): LaneInfo {
	return {
		issue: ISSUE,
		branch: `${ISSUE}-lane`,
		directory,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

async function commit_line(directory: string, line: string): Promise<void> {
	await writeFile(path.join(directory, FILE), `${line}\n`)
	await git_fixture_workspace.git(directory, ['commit', '-qam', line])
}

async function arrange_conflicted_merge(directory: string): Promise<void> {
	const { git } = git_fixture_workspace

	await git(directory, ['init', '-q', git_fixture_workspace.MAIN_BRANCH])
	await writeFile(path.join(directory, FILE), 'base\n')
	await git(directory, ['add', FILE])
	await git(directory, ['commit', '-qm', 'base'])
	await git(directory, ['checkout', '-qb', BRANCH])
	await commit_line(directory, 'side')
	await git(directory, ['checkout', '-q', 'main'])
	await commit_line(directory, 'main')
	await expect(git(directory, ['merge', '-q', BRANCH])).rejects.toThrow()
}

beforeEach(async () => {
	vi.clearAllMocks()
	Object.assign(fixture, git_fixture_workspace.open_workspace('josh-lane-restart-'))
	await arrange_conflicted_merge(fixture.workspace)
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(lane_at(fixture.workspace))
	vi.spyOn(lane_reap, 'is_child_running').mockReturnValue(true)
	claim_marker.mockResolvedValue({ is_applied: true })
	reap_child.mockReturnValue([1])
})

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

describe('lane_restart.restart — a lane stopped mid-merge', () => {
	it('stops nothing and says how to clear the merge', async () => {
		const outcome = await lane_restart.restart(ISSUE)

		expect(outcome).toStrictEqual({ kind: 'conflicted', directory: fixture.workspace })
		expect(claim_marker).not.toHaveBeenCalled()
		expect(reap_child).not.toHaveBeenCalled()
		expect(lane_restart.describe(outcome, ISSUE)).toContain(
			`git -C ${fixture.workspace} merge --abort`,
		)
	})
})
