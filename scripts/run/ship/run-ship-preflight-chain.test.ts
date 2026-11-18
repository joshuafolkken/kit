import type { Unmet } from '#scripts/git/git-preflight'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const problems_mock = vi.hoisted(() => vi.fn<(input: unknown) => Promise<Array<Unmet>>>())
const paths_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())
const pr_body_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())
const planned_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())
const lock_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())
const acceptance_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())
const removed_mock = vi.hoisted(() =>
	vi.fn<(body: string | undefined) => Promise<string | undefined>>(),
)

vi.mock('#scripts/git/git-preflight', () => ({
	git_preflight: { PRECONDITION: {}, problems_of: problems_mock },
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: paths_mock },
}))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { pr_get_body: pr_body_mock },
}))
vi.mock('#scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn().mockResolvedValue('7773-lane') },
}))
vi.mock('#scripts/review/acceptance-map-check', () => ({
	acceptance_map_check: { body_refusal: acceptance_mock },
}))
vi.mock('#scripts/review/removed-tests-check', () => ({
	removed_tests_check: { body_refusal: removed_mock },
}))
vi.mock('./run-ship-lock', () => ({ run_ship_lock: { lock_problems: lock_mock } }))
vi.mock('./run-ship-planned', () => ({
	run_ship_planned: { PRECONDITION: 'unplanned', problems: planned_mock },
}))
vi.mock('./run-ship-body-draft', () => ({
	run_ship_body_draft: { existing: vi.fn().mockResolvedValue(undefined) },
}))

const { run_ship_preflight } = await import('./run-ship-preflight')

// joshuafolkken/kit#7773: `run:chain` asks the ship's preflight judgments that need no PR before the
// review, through the same calls, each problem carrying the kind the ship would stop on.

const CLASSIFICATION_UNMET = {
	kind: 'classification',
	problem: 'Choose one release classification',
}
const REMOVED = '`board > shades` has no disposition'
const UNPLANNED = 'unplanned: scripts/gate/gate-plan.ts'
const LOCK_DRIFT = 'pnpm-lock.yaml does not match its inputs'
const RUNTIME_PATHS = ['scripts/run/ship/run-ship-cli.ts']
const LIVE_EVIDENCE = 'live-evidence'

beforeEach(() => {
	problems_mock.mockReset().mockResolvedValue([])
	paths_mock.mockReset().mockResolvedValue(['docs/josh-commands.md'])
	pr_body_mock.mockReset().mockResolvedValue(undefined)
	planned_mock.mockReset().mockResolvedValue([])
	lock_mock.mockReset().mockResolvedValue([LOCK_DRIFT])
	acceptance_mock.mockReset().mockResolvedValue('`ac-12345678` has no row')
	removed_mock.mockReset().mockResolvedValue(undefined)
})

describe('run_ship_preflight.chain_problems — the tree judgments before the review', () => {
	it('names classification, live-evidence, removed-tests and unplanned by their ship kinds', async () => {
		problems_mock.mockResolvedValue([CLASSIFICATION_UNMET])
		paths_mock.mockResolvedValue(RUNTIME_PATHS)
		removed_mock.mockResolvedValue(REMOVED)
		planned_mock.mockResolvedValue([UNPLANNED])

		const problems = await run_ship_preflight.chain_problems()

		expect(problems.map(({ kind }) => kind)).toStrictEqual([
			'classification',
			LIVE_EVIDENCE,
			'removed-tests',
			'unplanned',
		])
	})

	it('asks the git preflight of the branch as a pull request to open, with no title', async () => {
		await run_ship_preflight.chain_problems()

		expect(problems_mock).toHaveBeenCalledWith({ cli_input: undefined, will_open_pr: true })
	})

	it('asks for the evidence as the draft when no body is written yet', async () => {
		paths_mock.mockResolvedValue(RUNTIME_PATHS)

		expect(await run_ship_preflight.chain_problems()).toStrictEqual([
			{ kind: LIVE_EVIDENCE, problem: run_ship_preflight.EVIDENCE_PENDING },
		])
	})

	it('leaves the acceptance map and the lock file to their own checks', async () => {
		expect(await run_ship_preflight.chain_problems()).toStrictEqual([])
		expect(lock_mock).not.toHaveBeenCalled()
		expect(acceptance_mock).not.toHaveBeenCalled()
	})
})
