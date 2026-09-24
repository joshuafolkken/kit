import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_fixture_workspace } from '#scripts/git/git-fixture-workspace'
import { afterAll, describe, expect, it } from 'vitest'
import { run_cut } from './run-cut'

// joshuafolkken/kit#2484: the parent reads a lane's carried cut from outside the lane, resolving the
// record from the lane's path rather than its own cwd.

const TEST_PREFIX = 'run-cut-lane-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))

const ISSUE = '1839'
const BRANCH = '1839-lane'

// A fixture repository with a declared pre-gate cut, answering the lane directory and what
// `lane_cut_sync` is expected to return for it.
async function declared_lane(
	name: string,
): Promise<{ lane: string; expected: ReturnType<typeof run_cut.lane_cut_sync> }> {
	const lane = path.join(scratch, name)

	await git_fixture_workspace.git(scratch, ['init', git_fixture_workspace.MAIN_BRANCH, lane])
	const target = run_cut.cut_path(path.join(realpathSync(lane), '.git'))
	const cut = run_cut.begin_cut(target, {
		issue: ISSUE,
		branch: BRANCH,
		phase: run_cut.PRE_GATE_PHASE,
	})

	// Thrown rather than returned, so an unwritten record can never pass as an expected `undefined`.
	if (cut === undefined) throw new Error(`the ${name} record was claimed by something else`)

	return { lane, expected: { target, cut } }
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('a lane’s cut read from outside the lane', () => {
	it('reads no lane cut where the directory is not a git work tree', () => {
		expect(run_cut.lane_cut_sync(scratch)).toBeUndefined()
	})

	// The positive case: a cut declared in another checkout is read from this process's own cwd, so a
	// read that ignored the lane directory would miss it and fail here.
	it('reads a lane’s declared cut from outside the lane', async () => {
		const { lane, expected } = await declared_lane('lane')

		expect(run_cut.lane_cut_sync(lane)).toEqual(expected)
	})

	// joshuafolkken/kit#2517: under the pre-push hook this process inherits `GIT_DIR`, which beats
	// `cwd` outright — a read that passed it on would answer about a different repository.
	it('reads the lane’s cut while an inherited GIT_DIR points at another repository', async () => {
		const { lane, expected } = await declared_lane('pointed-lane')
		const decoy = path.join(scratch, 'decoy')

		await git_fixture_workspace.git(scratch, ['init', git_fixture_workspace.MAIN_BRANCH, decoy])
		const previous = process.env['GIT_DIR']

		process.env['GIT_DIR'] = path.join(decoy, '.git')

		try {
			expect(run_cut.lane_cut_sync(lane)).toEqual(expected)
		} finally {
			if (previous === undefined) Reflect.deleteProperty(process.env, 'GIT_DIR')
			else process.env['GIT_DIR'] = previous
		}
	})
})
