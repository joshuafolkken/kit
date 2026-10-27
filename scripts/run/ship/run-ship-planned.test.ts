import type { LanePlan } from '#scripts/lane/lane-plan'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const branch_mock = vi.hoisted(() => vi.fn<() => Promise<string>>())
const paths_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())
const read_mock = vi.hoisted(() => vi.fn<(issue: number) => LanePlan | undefined>())

vi.mock('#scripts/git/git-branch', () => ({ git_branch: { current: branch_mock } }))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: paths_mock },
}))
vi.mock('#scripts/lane/lane-plan', () => ({ lane_plan: { read: read_mock } }))

const { run_ship_planned } = await import('./run-ship-planned')

// joshuafolkken/kit#5152: the branch's code files the lane's `lane:plan` record never listed stop the
// ship; tests, documents and a lane with no plan record pass.

const ISSUE = 5122
const PLANNED = ['scripts/gate/whole-suite-files.ts', 'scripts/gate/test-related-scope.ts']
const UNPLANNED = 'scripts/gate/gate-plan.ts'
const CHANGED = [...PLANNED, UNPLANNED]
const NON_CODE = [
	'scripts/gate/gate-plan.test.ts',
	'docs/josh-commands-run.md',
	'docs/diagram.svg',
	'prompts/review.md',
	'.claude/skills/workflow-commands/chain-rule.md',
	'.josh/scripts/probe.ts',
	'cspell.config.yaml',
	'pnpm-lock.yaml',
]

function plan(paths: Array<string>): LanePlan {
	return { issue: ISSUE, paths, planned_at: '2026-10-27T07:01:00Z' }
}

beforeEach(() => {
	branch_mock.mockReset().mockResolvedValue(`${String(ISSUE)}-lane`)
	paths_mock.mockReset().mockResolvedValue(CHANGED)
	read_mock.mockReset().mockReturnValue(plan(PLANNED))
})

describe('run_ship_planned.unplanned_of', () => {
	it('returns the one code file of three changed that the two planned files miss', () => {
		expect(run_ship_planned.unplanned_of(PLANNED, CHANGED)).toStrictEqual([UNPLANNED])
	})

	it('never returns a test file, a document or a data file, planned or not', () => {
		expect(run_ship_planned.unplanned_of(PLANNED, NON_CODE)).toStrictEqual([])
	})

	it('holds every path under a planned directory', () => {
		expect(run_ship_planned.unplanned_of(['scripts/gate/'], CHANGED)).toStrictEqual([])
	})
})

// joshuafolkken/kit#5203: `check:related` reads the same answer, with the issue and the files it records.
describe('run_ship_planned.unplanned', () => {
	it('returns the issue, the unplanned files and the problem text the preflight prints', async () => {
		const found = await run_ship_planned.unplanned()

		expect(found).toMatchObject({ issue: ISSUE, files: [UNPLANNED] })
		expect([found?.text]).toStrictEqual(await run_ship_planned.problems())
	})

	it('returns undefined for a lane with no plan record, or with only test and document changes', async () => {
		read_mock.mockReturnValueOnce(undefined)

		await expect(run_ship_planned.unplanned()).resolves.toBeUndefined()
		paths_mock.mockResolvedValue(NON_CODE)

		await expect(run_ship_planned.unplanned()).resolves.toBeUndefined()
	})
})

describe('run_ship_planned.problems', () => {
	it('names the unplanned file and the re-plan command listing every path', async () => {
		const [problem] = await run_ship_planned.problems()

		expect(problem).toContain(`unplanned: ${UNPLANNED}`)
		expect(problem).toContain(`pnpm josh lane:plan ${String(ISSUE)} ${CHANGED.join(' ')}`)
		expect(read_mock).toHaveBeenCalledWith(ISSUE, process.cwd())
	})

	it('passes once lane:plan is re-run with the file added', async () => {
		read_mock.mockReturnValue(plan(CHANGED))

		await expect(run_ship_planned.problems()).resolves.toStrictEqual([])
	})

	it('passes a lane with no plan record without reading the diff', async () => {
		read_mock.mockReturnValue(undefined)

		await expect(run_ship_planned.problems()).resolves.toStrictEqual([])
		expect(paths_mock).not.toHaveBeenCalled()
	})

	it('passes a lane whose plan record was yielded, as no plan', async () => {
		read_mock.mockReturnValue({ ...plan(PLANNED), yielded: true })

		await expect(run_ship_planned.problems()).resolves.toStrictEqual([])
	})

	it('passes a branch with no issue number', async () => {
		branch_mock.mockResolvedValue('main')

		await expect(run_ship_planned.problems()).resolves.toStrictEqual([])
		expect(read_mock).not.toHaveBeenCalled()
	})
})
