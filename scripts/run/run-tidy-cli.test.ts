import { issue_merged } from '#scripts/issue/issue-merged'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_tidy_cli } from './run-tidy-cli'
import { run_tidy_lanes } from './run-tidy-lanes'
import { run_tidy_stashes } from './run-tidy-stashes'

vi.mock('#scripts/issue/issue-merged', () => ({ issue_merged: { read_merged: vi.fn() } }))
vi.mock('./run-tidy-lanes', () => ({ run_tidy_lanes: { tidy_lanes: vi.fn() } }))
vi.mock('./run-tidy-stashes', () => ({ run_tidy_stashes: { tidy_stashes: vi.fn() } }))

const errors: Array<string> = []
const LANE_TARGET = 'lane #2583'
const STASH_TARGET = 'stash "On main: parked #2584"'

beforeEach(() => {
	vi.clearAllMocks()
	errors.length = 0
	vi.spyOn(console, 'error').mockImplementation((...parts: Array<unknown>) => {
		errors.push(parts.map(String).join(' '))
	})
	vi.mocked(issue_merged.read_merged).mockResolvedValue(true)
	vi.mocked(run_tidy_lanes.tidy_lanes).mockResolvedValue([])
	vi.mocked(run_tidy_stashes.tidy_stashes).mockResolvedValue([])
})

// joshuafolkken/kit#2701: the sweep runs inside `run:hold`, so it reports on stderr and never throws.
describe('run_tidy_cli.sweep', () => {
	it('reports cleaned lanes and stashes together on standard error', async () => {
		vi.mocked(run_tidy_lanes.tidy_lanes).mockResolvedValue([
			{ target: LANE_TARGET, verdict: { kind: 'clean' } },
		])
		vi.mocked(run_tidy_stashes.tidy_stashes).mockResolvedValue([
			{ target: STASH_TARGET, verdict: { kind: 'clean' } },
		])

		await run_tidy_cli.sweep()

		expect(errors.join('\n')).toBe(
			['run:tidy — cleaned:', `  ${LANE_TARGET}`, `  ${STASH_TARGET}`].join('\n'),
		)
	})

	it('prints nothing when nothing merged was found', async () => {
		await run_tidy_cli.sweep()

		expect(errors).toStrictEqual([])
	})

	it('reads each issue once across both halves', async () => {
		vi.mocked(run_tidy_lanes.tidy_lanes).mockImplementation(async (is_merged) => {
			await is_merged('2583')

			return []
		})
		vi.mocked(run_tidy_stashes.tidy_stashes).mockImplementation(async (is_merged) => {
			await is_merged('2583')

			return []
		})

		await run_tidy_cli.sweep()

		expect(issue_merged.read_merged).toHaveBeenCalledOnce()
	})

	it('notes a failure instead of throwing', async () => {
		vi.mocked(run_tidy_lanes.tidy_lanes).mockRejectedValue(new Error('git missing'))

		await expect(run_tidy_cli.sweep()).resolves.toBeUndefined()
		expect(errors.join('\n')).toContain('run:tidy could not finish')
	})
})
