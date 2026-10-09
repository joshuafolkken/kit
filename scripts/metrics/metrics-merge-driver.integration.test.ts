import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { merge_drivers } from '#scripts/git/merge-drivers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { metrics_logic, type Metrics } from './metrics-logic'
import type { Baseline } from './metrics-ratchet'

// joshuafolkken/kit#3517: the conflict a backlogrun's lanes kept hitting, reproduced on real git — main
// moved on and both sides raised the totals — and merged through the driver `josh main:merge` passes.

const BASELINE_FILE = '.josh/metrics-baseline.json'
const ATTRIBUTES = `${BASELINE_FILE} merge=josh-metrics\n`
const BASE: Metrics = {
	scripts: { files: 10, code_lines: 1000, comment_lines: 400, comment_ratio: 0.4 },
	rules: { files: 3, lines: 200 },
	guards: 5,
	ai_cost: { resident_bytes: 9000, on_demand_bytes: 300_000 },
}
const LANE_ACCEPTED = { reason: 'Lane grew for #2', date: '2026-10-09' }

const fixture: FixtureWorkspace = {
	previous_cwd: '',
	restore_environment: undefined,
	workspace: '',
}

function write_baseline(code_lines: number, reason: string): void {
	const baseline: Baseline = {
		...BASE,
		scripts: { ...BASE.scripts, code_lines },
		accepted: { ...LANE_ACCEPTED, reason },
	}

	writeFileSync(path.join(fixture.workspace, BASELINE_FILE), metrics_logic.baseline_text(baseline))
}

async function commit_baseline(code_lines: number, reason: string): Promise<void> {
	write_baseline(code_lines, reason)
	await git_fixture_workspace.git(fixture.workspace, ['commit', '-am', reason])
}

async function commit_base(): Promise<void> {
	const { workspace } = fixture

	await git_fixture_workspace.git(workspace, ['init', git_fixture_workspace.MAIN_BRANCH])
	mkdirSync(path.join(workspace, '.josh'))
	writeFileSync(path.join(workspace, '.gitattributes'), ATTRIBUTES)
	write_baseline(BASE.scripts.code_lines, 'base')
	await git_fixture_workspace.git(workspace, ['add', '.'])
	await git_fixture_workspace.git(workspace, ['commit', '-m', 'base'])
}

// main and `lane` each raise `scripts.code_lines` from the same base: +50 on main, +100 on the lane.
async function diverge(): Promise<void> {
	const { workspace } = fixture

	await commit_base()
	await git_fixture_workspace.git(workspace, ['checkout', '-b', 'lane'])
	await commit_baseline(1100, LANE_ACCEPTED.reason)
	await git_fixture_workspace.git(workspace, ['checkout', 'main'])
	await commit_baseline(1050, 'Main grew for #1')
	await git_fixture_workspace.git(workspace, ['checkout', 'lane'])
}

function merge_arguments(): ReadonlyArray<string> {
	return ['merge', '-m', 'Merge main into lane', 'main']
}

describe('merging the metrics baseline through the josh-metrics driver', () => {
	beforeEach(async () => {
		Object.assign(fixture, git_fixture_workspace.open_workspace('metrics-merge-driver-'))
		await diverge()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('merges two raises without a conflict and keeps both', async () => {
		const options = merge_drivers.git_options()

		await git_fixture_workspace.git(fixture.workspace, [...options, ...merge_arguments()])

		const merged: unknown = JSON.parse(
			readFileSync(path.join(fixture.workspace, BASELINE_FILE), 'utf8'),
		)

		expect(merged).toStrictEqual({
			...BASE,
			scripts: { ...BASE.scripts, code_lines: 1150, comment_ratio: 0.35 },
			accepted: LANE_ACCEPTED,
		})
	})

	// The control: without the driver the same merge is the conflict the lanes kept hitting.
	it('conflicts on the same merge without the driver', async () => {
		await expect(
			git_fixture_workspace.git(fixture.workspace, [...merge_arguments()]),
		).rejects.toThrow(/CONFLICT/u)
	})
})
