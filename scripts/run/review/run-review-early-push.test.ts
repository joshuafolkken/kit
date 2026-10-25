import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review } from './run-review'
import { run_review_early_push } from './run-review-early-push'

// joshuafolkken/kit#4907: a lane child's `josh run:review` commits before the brief and pushes at the
// first green gate, so the pull request's CI runs beside round 1.

type JoshRun = (
	args: ReadonlyArray<string>,
	forward?: boolean,
) => Promise<{ code: number; out: string }>
type LaunchJosh = (args: ReadonlyArray<string>, log_path: string) => { kind: string }

const { is_tree_dirty, josh_run, launch_josh, wait_for_gate_finish, existing } = vi.hoisted(() => ({
	is_tree_dirty: vi.fn<() => Promise<boolean>>(),
	josh_run: vi.fn<JoshRun>(),
	launch_josh: vi.fn<LaunchJosh>(),
	wait_for_gate_finish: vi.fn<() => Promise<string>>(),
	existing: vi.fn<(issue: string) => Promise<string | undefined>>(),
}))

vi.mock('#scripts/git/git-command', () => ({
	git_command: { branch: async () => '4907-lane' },
}))
vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run } }))
vi.mock('#scripts/run/hold/run-hold', () => ({ run_hold: { is_tree_dirty } }))
vi.mock('#scripts/run/ship/run-ship-body-draft', async (import_original) => {
	const { run_ship_body_draft } = await import_original<Record<'run_ship_body_draft', object>>()

	return { run_ship_body_draft: { ...run_ship_body_draft, existing } }
})
vi.mock('./run-review-steps', () => ({ run_review_steps: { launch_josh, wait_for_gate_finish } }))

const LANE = { JOSH_LANE_CHILD: '4907' }
const LANE_DIRECTORY = '/home/dev/.kit-lanes/4907'
const CODE_PLAN = { is_code_only: false, slots: ['code'] as const }
const DRAFT = '/git/josh-ship-body-4907.md'
const COMMIT = ['git', '-y', '--skip-push', '--skip-pr']
const PUSH = ['git', '-y', '--skip-commit']

beforeEach(() => {
	is_tree_dirty.mockReset().mockResolvedValue(false)
	josh_run.mockReset().mockResolvedValue({ code: 0, out: '' })
	launch_josh.mockReset().mockReturnValue({ kind: 'launched' })
	wait_for_gate_finish.mockReset().mockResolvedValue(run_review.GATE_GREEN)
	existing.mockReset().mockResolvedValue(undefined)
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

describe('run_review_early_push.is_due', () => {
	it('is due for a lane child briefing code alone', () => {
		expect(run_review_early_push.is_due(CODE_PLAN, LANE, LANE_DIRECTORY)).toBe(true)
	})

	it.each([
		['outside a lane child', CODE_PLAN, {}],
		['under a mark leaked from another lane', CODE_PLAN, { JOSH_LANE_CHILD: '4900' }],
		['for the ship’s own --code-only open', { is_code_only: true, slots: ['code'] as const }, LANE],
		[
			'while an interaction brief is due',
			{ is_code_only: false, slots: ['code', 'interaction'] as const },
			LANE,
		],
	])('is not due %s', (_name, plan, environment) => {
		expect(run_review_early_push.is_due(plan, environment, LANE_DIRECTORY)).toBe(false)
	})
})

describe('run_review_early_push.prepare', () => {
	it('commits a dirty tree locally, without pushing or opening a pull request', async () => {
		is_tree_dirty.mockResolvedValue(true)

		expect(await run_review_early_push.prepare(CODE_PLAN, LANE, LANE_DIRECTORY)).toBe(true)
		expect(josh_run).toHaveBeenCalledExactlyOnceWith(COMMIT)
	})

	it('commits nothing on a clean tree and still pushes early', async () => {
		expect(await run_review_early_push.prepare(CODE_PLAN, LANE, LANE_DIRECTORY)).toBe(true)
		expect(josh_run).not.toHaveBeenCalled()
	})

	it('pushes nothing early when the commit is refused', async () => {
		is_tree_dirty.mockResolvedValue(true)
		josh_run.mockResolvedValue({ code: 1, out: 'refused' })

		expect(await run_review_early_push.prepare(CODE_PLAN, LANE, LANE_DIRECTORY)).toBe(false)
	})

	it('touches nothing when not due', async () => {
		expect(await run_review_early_push.prepare(CODE_PLAN, {}, LANE_DIRECTORY)).toBe(false)
		expect(is_tree_dirty).not.toHaveBeenCalled()
	})
})

describe('run_review_early_push.launch', () => {
	it('leaves `josh run:review --push` running in the background', () => {
		run_review_early_push.launch()

		expect(launch_josh.mock.lastCall?.[0]).toStrictEqual([
			'run:review',
			run_review_early_push.PUSH_FLAG,
		])
	})
})

describe('run_review_early_push.push', () => {
	it('pushes and opens the pull request with the body draft on a green gate over a clean tree', async () => {
		existing.mockResolvedValue(DRAFT)

		expect(await run_review_early_push.push()).toBe(0)
		expect(existing).toHaveBeenCalledWith('4907')
		expect(josh_run).toHaveBeenCalledExactlyOnceWith([...PUSH, '--body-file', DRAFT], true)
	})

	it('pushes without a body file when no draft exists', async () => {
		await run_review_early_push.push()

		expect(josh_run).toHaveBeenCalledExactlyOnceWith(PUSH, true)
	})

	it('returns the push’s own exit code', async () => {
		josh_run.mockResolvedValue({ code: 1, out: 'push refused' })

		expect(await run_review_early_push.push()).toBe(1)
	})

	it.each([run_review.GATE_RED, run_review.GATE_MOVED])(
		'pushes nothing on a %s gate',
		async (state) => {
			wait_for_gate_finish.mockResolvedValue(state)

			expect(await run_review_early_push.push()).toBe(0)
			expect(josh_run).not.toHaveBeenCalled()
		},
	)

	it('pushes nothing on a tree a round-1 fix moved after the gate', async () => {
		is_tree_dirty.mockResolvedValue(true)

		expect(await run_review_early_push.push()).toBe(0)
		expect(josh_run).not.toHaveBeenCalled()
	})
})
