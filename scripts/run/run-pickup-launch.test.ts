import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_pickup_launch } from './run-pickup-launch'

const josh_run_mock = vi.hoisted(() => vi.fn())
const repo_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/gh/git-gh-repo', () => ({
	git_gh_repo: { repo_get_name_with_owner: repo_mock },
}))
vi.mock('#scripts/issue/session-cite', () => ({
	session_cite: { issue: (issue: string) => `#${issue}` },
}))

const REPO = 'joshuafolkken/kit'
const LANE_LAUNCH = 'lane:launch'

function answer(out: string, code = 0, error = ''): { code: number; out: string; err: string } {
	return { code, out, err: error }
}

beforeEach(() => {
	josh_run_mock.mockReset()
	repo_mock.mockReset()
	repo_mock.mockResolvedValue(REPO)
})

describe('run:pickup launching the offered children', () => {
	it('asks epic:next --lanes and launches each offered child in turn', async () => {
		josh_run_mock
			.mockResolvedValueOnce(answer('21\n22'))
			.mockResolvedValueOnce(answer('4001'))
			.mockResolvedValueOnce(answer('', 1, 'checking out\nlane:open refused — every seat is taken'))

		const result = await run_pickup_launch.launch(['20', '30'])

		expect(josh_run_mock.mock.calls).toStrictEqual([
			[['epic:next', '20', '30', '--repo', REPO, '--lanes'], true],
			[[LANE_LAUNCH, '21'], true],
			[[LANE_LAUNCH, '22'], true],
		])
		expect(result).toStrictEqual({
			lines: [
				'#21 launched — pid 4001',
				'#22 not launched — lane:open refused — every seat is taken',
			],
			is_refused: false,
		})
	})

	it('prints a verdict token such as triage and launches nothing', async () => {
		josh_run_mock.mockResolvedValueOnce(answer('triage'))

		const result = await run_pickup_launch.launch(['20'])

		expect(josh_run_mock).toHaveBeenCalledTimes(1)
		expect(result.lines).toStrictEqual(['epic:next: triage'])
	})
})

describe('run:pickup naming why a launch was refused', () => {
	it('names the exit code when a refused launch printed only pnpm lines', async () => {
		josh_run_mock
			.mockResolvedValueOnce(answer('23'))
			.mockResolvedValueOnce(
				answer('', 1, '$ node --import tsx scripts/josh/josh.ts lane:dispatch 23\n[ELIFECYCLE] x'),
			)

		const result = await run_pickup_launch.launch(['20'])

		expect(result.lines).toStrictEqual(['#23 not launched — exit 1'])
	})
})

describe('run:pickup when the offer cannot be read', () => {
	it('reports a refused epic:next and launches nothing', async () => {
		josh_run_mock.mockResolvedValueOnce(
			answer('', 1, '#20 is not an epic\n[ELIFECYCLE] Command failed with exit code 1.'),
		)

		expect(await run_pickup_launch.launch(['20'])).toStrictEqual({
			lines: ['epic:next refused — #20 is not an epic'],
			is_refused: true,
		})
		expect(josh_run_mock).toHaveBeenCalledTimes(1)
	})

	it('asks nothing when the repository is unreadable', async () => {
		repo_mock.mockResolvedValue(undefined)

		const result = await run_pickup_launch.launch(['20'])

		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(result).toStrictEqual({
			lines: ['epic:next not asked — the repository is unreadable'],
			is_refused: true,
		})
	})
})
