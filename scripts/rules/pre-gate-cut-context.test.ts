import path from 'node:path'
import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_cut } from '#scripts/run/cut/run-cut'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pre_gate_cut } from './pre-gate-cut'

// joshuafolkken/kit#6973: the cut record is the call's work tree's, not the process's.

const ISSUE = '6973'
const GATE = 'pnpm josh gate'
const WORK_DIRECTORY = temporary_directory('suite')('pre-gate-cut-context-')
const LANE_DIRECTORY = path.join(WORK_DIRECTORY, '.kit-lanes', ISSUE)
const GIT_DIRECTORY = path.join(LANE_DIRECTORY, '.git')

afterEach(() => {
	vi.restoreAllMocks()
})

describe('pre_gate_cut.is_uncut_gate_in — the call context', () => {
	it("reads the cut record under the call context's cwd", () => {
		const directory = vi
			.spyOn(run_cut, 'worktree_git_directory_sync')
			.mockReturnValue(GIT_DIRECTORY)
		const carried = vi.spyOn(run_cut, 'carried_cut_sync').mockReturnValue(undefined)

		vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('over')
		const context = hook_context_fixture.of(LANE_DIRECTORY, { [lane_child_marker.KEY]: ISSUE })

		expect(pre_gate_cut.is_uncut_gate_in(GATE, context)).toBe(true)
		expect(directory).toHaveBeenCalledWith(LANE_DIRECTORY)
		expect(carried).toHaveBeenCalledWith(undefined, GIT_DIRECTORY)
	})
})
