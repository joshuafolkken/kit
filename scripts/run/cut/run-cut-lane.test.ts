import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_fixture_workspace } from '#scripts/git/git-fixture-workspace'
import { afterAll, describe, expect, it } from 'vitest'
import { run_cut, type RunCut } from './run-cut'

// joshuafolkken/kit#2484: the parent reads a lane's carried cut from outside the lane, so the record
// has to be found by the lane's path rather than by the process's own checkout.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-cut-lane-test-'))
const ISSUE = '1839'
const BRANCH = '1839-lane'
const GIT_DIR = 'GIT_DIR'
// The records `begin_cut` wrote, removed after the suite so none outlives its scratch lane.
const records: Array<string> = []

interface LaneCut {
	lane: string
	target: string
	cut: RunCut | undefined
}

async function init_repository(name: string): Promise<string> {
	const directory = path.join(scratch, name)

	await git_fixture_workspace.git(scratch, ['init', git_fixture_workspace.MAIN_BRANCH, directory])

	return directory
}

async function declared_lane(name: string): Promise<LaneCut> {
	const lane = await init_repository(name)
	const target = run_cut.cut_path(path.join(realpathSync(lane), '.git'))
	const spec = { issue: ISSUE, branch: BRANCH, phase: run_cut.PRE_GATE_PHASE }

	records.push(target)

	return { lane, target, cut: run_cut.begin_cut(target, spec) }
}

// Sets `GIT_DIR` the way a git hook exports it, runs the read, and restores the caller's value.
function with_inherited_git_directory<T>(git_directory: string, read: () => T): T {
	const previous = process.env[GIT_DIR]

	process.env[GIT_DIR] = git_directory

	try {
		return read()
	} finally {
		if (previous === undefined) Reflect.deleteProperty(process.env, GIT_DIR)
		else process.env[GIT_DIR] = previous
	}
}

afterAll(() => {
	for (const record of records) rmSync(record, { force: true })
	rmSync(scratch, { force: true, recursive: true })
})

describe('a lane’s cut read from outside the lane', () => {
	it('reads no lane cut where the directory is not a git work tree', () => {
		expect(run_cut.lane_cut_sync(scratch)).toBeUndefined()
	})

	// The positive case: a cut declared in another checkout is read from this process's own cwd, so a
	// read that ignored the lane directory would miss it and fail here.
	it('reads a lane’s declared cut from outside the lane', async () => {
		const { lane, target, cut } = await declared_lane('lane')

		expect(run_cut.lane_cut_sync(lane)).toEqual({ target, cut })
	})

	// joshuafolkken/kit#2515: a git hook exports `GIT_DIR`, which beats `cwd`, so a read that inherited
	// it answered for the hook's checkout and missed the lane's record.
	it('reads a lane’s declared cut under an inherited GIT_DIR naming another checkout', async () => {
		const { lane, target, cut } = await declared_lane('hooked-lane')
		const decoy = await init_repository('decoy')
		const read = with_inherited_git_directory(path.join(decoy, '.git'), () =>
			run_cut.lane_cut_sync(lane),
		)

		expect(read).toEqual({ target, cut })
	})
})
