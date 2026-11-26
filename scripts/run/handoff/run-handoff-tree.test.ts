import { lane_open } from '#scripts/lane/lane-open'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { WorkflowHandoff, WorkflowKeyword } from './run-handoff-args'
import { run_handoff_tree } from './run-handoff-tree'

// joshuafolkken/kit#8994: a numbered run that edits runs in a lane, never in the primary checkout.

const ROOT = '/repo'
const LANE = '/home/dev/.kit-lanes/12'
const NEW_LINE = 'fullrun new Add a flag'
const CROSS_REPOSITORY_LINE = 'fullrun owner/repo#12'

function handoff(keyword: WorkflowKeyword, line: string): WorkflowHandoff {
	return { kind: 'workflow', keyword, line, brief_file: undefined }
}

const FULLRUN = handoff('fullrun', 'fullrun #12')

function ports(
	directory: string | undefined,
	branch = 'main',
): {
	cwd: string
	branch_at: (directory: string) => Promise<string>
	lane_directory: Mock<(issue: string) => Promise<string | undefined>>
} {
	return {
		cwd: ROOT,
		branch_at: async () => branch,
		lane_directory: vi.fn<(issue: string) => Promise<string | undefined>>(async () => directory),
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_handoff_tree.work_tree', () => {
	it.each(['fullrun', 'halfrun', 'prrun'] as const)(
		'opens the lane of %s #12 and runs there',
		async (keyword) => {
			const fake = ports(LANE)

			const tree = await run_handoff_tree.work_tree(handoff(keyword, `${keyword} #12`), fake)

			expect(tree).toStrictEqual({ kind: 'tree', directory: LANE })
			expect(fake.lane_directory).toHaveBeenCalledWith('12')
		},
	)

	it.each([
		['fullrun', NEW_LINE],
		['kickoff', 'kickoff #12'],
		['retrospective', 'retrospective'],
		['fullrun', CROSS_REPOSITORY_LINE],
	] as const)('keeps %s (`%s`) in the checkout it was typed in', async (keyword, line) => {
		const fake = ports(LANE)

		const tree = await run_handoff_tree.work_tree(handoff(keyword, line), fake)

		expect(tree).toStrictEqual({ kind: 'tree', directory: ROOT })
		expect(fake.lane_directory).not.toHaveBeenCalled()
	})

	it('refuses, naming lane:close, when every lane seat is taken', async () => {
		const tree = await run_handoff_tree.work_tree(FULLRUN, ports(undefined))

		expect(tree).toMatchObject({ kind: 'refused', note: expect.stringContaining('lane:close') })
	})
})

// joshuafolkken/kit#8994 review: a checkout already on the issue's branch keeps its work, and a lane
// that cannot open refuses rather than throwing.
describe('run_handoff_tree.work_tree — the checkout it was typed in', () => {
	it.each(['12-add-a-flag', '12-lane'])(
		'keeps the run in a checkout already on the issue branch %s',
		async (branch) => {
			const fake = ports(LANE, branch)

			const tree = await run_handoff_tree.work_tree(handoff('prrun', 'prrun #12'), fake)

			expect(tree).toStrictEqual({ kind: 'tree', directory: ROOT })
			expect(fake.lane_directory).not.toHaveBeenCalled()
		},
	)

	it('opens the lane from a checkout on another issue branch', async () => {
		const tree = await run_handoff_tree.work_tree(FULLRUN, ports(LANE, '120-other'))

		expect(tree).toStrictEqual({ kind: 'tree', directory: LANE })
	})

	it('refuses with the reason when lane:open throws', async () => {
		const fake = ports(LANE)

		fake.lane_directory.mockRejectedValue(new Error('lane 12 is stranded'))

		const tree = await run_handoff_tree.work_tree(FULLRUN, fake)

		expect(tree).toMatchObject({ kind: 'refused', note: expect.stringContaining('stranded') })
	})
})

describe('run_handoff_tree.lane_directory', () => {
	it('answers the directory of the lane lane:open opened or already had', async () => {
		const lane: LaneInfo = {
			issue: '12',
			branch: '12-lane',
			directory: LANE,
			seat: 1,
			development_port: undefined,
			preview_port: undefined,
			output: undefined,
			is_stranded: false,
		}

		vi.spyOn(lane_open, 'open_lane').mockResolvedValue({ kind: 'already-open', lane })

		await expect(run_handoff_tree.lane_directory('12')).resolves.toBe(LANE)
	})

	it('answers undefined when lane:open found no free seat', async () => {
		vi.spyOn(lane_open, 'open_lane').mockResolvedValue({ kind: 'full' })

		await expect(run_handoff_tree.lane_directory('12')).resolves.toBeUndefined()
	})
})

describe('run_handoff_tree.issue_of', () => {
	it('reads the first #N of the line, and none from an unnumbered one', () => {
		expect(run_handoff_tree.issue_of('prrun #34 then #35')).toBe('34')
		expect(run_handoff_tree.issue_of(NEW_LINE)).toBeUndefined()
		expect(run_handoff_tree.issue_of(CROSS_REPOSITORY_LINE)).toBeUndefined()
	})
})
