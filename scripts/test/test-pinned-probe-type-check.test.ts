import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_ledger } from './test-pinned-ledger'
import { test_pinned_probe, type Checked, type Probe } from './test-pinned-probe'
import { test_pinned_stage } from './test-pinned-stage'
import { test_pinned_type_check } from './test-pinned-type-check'
import { test_red } from './test-red'

const { DRIVER_FILE, TEST_FILE, CHANGED_DRIVER } = test_pinned_fixture
const RUN_TIMEOUT = 60_000
const OLD_RETURN = '\treturn result.token'
const PROBE: Probe = {
	hunk: { file: DRIVER_FILE, new_start: 7, new_count: 1, old_lines: [OLD_RETURN] },
	index: 0,
	reach: test_pinned_stage.WIDE_REACH,
}
const fixture: { current?: FixtureWorkspace } = {}

beforeEach(async () => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-type-probe-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await test_pinned_fixture.build_change_branch()
	vi.spyOn(test_pinned_stage, 'plan_over').mockReturnValue({
		direct: [TEST_FILE],
		reach: [DRIVER_FILE],
	})
	vi.spyOn(test_pinned_type_check, 'scope_of').mockResolvedValue([DRIVER_FILE])
	vi.spyOn(test_red, 'probe_in').mockResolvedValue({ verdict: 'green', failed: [] })
	vi.spyOn(test_pinned_ledger, 'record').mockResolvedValue(undefined)
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function checked(
	on_verdict: () => Promise<void> = vi.fn(),
): Promise<Awaited<ReturnType<typeof test_pinned_probe.checked_on>>> {
	return await test_pinned_probe.checked_on([DRIVER_FILE], [PROBE], on_verdict)
}

function expect_type_pin(result: Checked, contents: ReadonlyArray<string>): void {
	expect(result.verdicts).toEqual([{ verdict: 'red', failed: [], pinned_by: 'type-check' }])
	expect(contents[0]).toBe(CHANGED_DRIVER)
	expect(contents[1]).toContain(OLD_RETURN)
	expect(contents[2]).toBe(CHANGED_DRIVER)
	expect(test_red.probe_in).toHaveBeenCalledOnce()
}

// joshuafolkken/kit#5385: the type check must compare the two trees, never pin an existing error.
describe('test_pinned_probe type check with a reverted hunk', () => {
	it(
		'checks the unchanged tree first, then the revert, and restores the file',
		async () => {
			const contents: Array<string> = []
			const held = { target: '' }
			const is_red = vi.spyOn(test_pinned_type_check, 'is_red').mockImplementation(async (tree) => {
				held.target = path.join(tree.tree, DRIVER_FILE)
				const content = await readFile(held.target, 'utf8')

				contents.push(content)

				return !content.includes("argv.includes('--driver')")
			})
			const result = await checked(async () => {
				contents.push(await readFile(held.target, 'utf8'))
			})

			expect_type_pin(result, contents)
			expect(is_red).toHaveBeenCalledTimes(2)
		},
		RUN_TIMEOUT,
	)

	it(
		'escalates without checking the revert when the unchanged tree already has type errors',
		async () => {
			const is_red = vi.spyOn(test_pinned_type_check, 'is_red').mockResolvedValue(true)
			const result = await checked()

			expect(result.verdicts).toEqual([{ verdict: 'green', failed: [] }])
			expect(result.staged).toEqual({ direct: 0, typed: 0, escalated: 1 })
			expect(is_red).toHaveBeenCalledOnce()
			expect(test_red.probe_in).toHaveBeenCalledTimes(2)
		},
		RUN_TIMEOUT,
	)
})
