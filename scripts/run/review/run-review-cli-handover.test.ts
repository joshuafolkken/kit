import type { Emit } from '#scripts/review/review-brief-cli'
import { run_step_section } from '#scripts/run/run-step-section'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review } from './run-review'
import { run_review_cli } from './run-review-cli'

// joshuafolkken/kit#4850: a lane child that had recorded round 1 reopened `josh run:review` and was
// handed a round-2 brief. Its open is refused, pointing at the ship; nothing is launched.

const { branch, brief_run, handed_over, launch_gate, launch_pinned, wait_gate } = vi.hoisted(
	() => ({
		wait_gate: vi.fn(async () => 'red'),
		branch: vi.fn<() => Promise<string>>(),
		brief_run: vi.fn<(argv: ReadonlyArray<string>, emit?: Emit) => Promise<number>>(),
		handed_over: vi.fn<(issue: number) => Promise<boolean>>(),
		launch_gate: vi.fn(() => ({ kind: 'launched' })),
		launch_pinned: vi.fn(() => ({ kind: 'launched' })),
	}),
)

vi.mock('#scripts/git/git-command', () => ({ git_command: { branch } }))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: { remove_stamp: vi.fn(), write_text_stamp: vi.fn() },
}))
vi.mock('#scripts/lane/lane-session-broker', () => ({
	lane_session_broker: { review_paths: () => ({ brief: '/briefs/brief.md' }) },
}))
vi.mock('#scripts/review/review-brief-cli', () => ({
	review_brief_cli: { run: brief_run, run_to: brief_run, scoped_refusal: async () => undefined },
}))
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return {
		review_interaction: {
			...review_interaction,
			reading: async () => ({ status: 'not-required' }),
		},
	}
})
vi.mock('#scripts/review/review-lane-handover', () => ({
	review_lane_handover: {
		is_reopen_refused: handed_over,
		refusal: (issue: number) => `REFUSED #${String(issue)} pnpm josh ship --detach --review`,
	},
}))
vi.mock('./run-review-join-read', () => ({
	run_review_join_read: { mark_due: vi.fn(), read: async () => undefined },
}))
vi.mock('./run-review-pinned-steps', () => ({
	run_review_pinned_steps: { launch: launch_pinned, clear: vi.fn() },
}))
vi.mock('./run-review-steps', () => ({
	run_review_steps: {
		launch_gate,
		mark_gate_starting: vi.fn(async () => {
			await Promise.resolve()
		}),
		write_timing_start: vi.fn(),
		wait_for_gate_finish: wait_gate,
		complete_timing: () => undefined,
		read_gate_log: () => undefined,
	},
}))
vi.mock('#scripts/gate/check-related-unplanned', () => ({
	check_related_unplanned: { show: vi.fn(async () => undefined) },
}))

const ISSUE = 4850
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const PRINT_EXIT_CODE = 7
const SHIP_STEP = 'ship --detach --review'

const output = { stderr: [] as Array<string> }

function stderr_text(): string {
	return output.stderr.join('')
}

beforeEach(() => {
	output.stderr = []
	branch.mockResolvedValue(`${String(ISSUE)}-lane`)
	brief_run.mockResolvedValue(SUCCESS_EXIT_CODE)
	vi.spyOn(run_step_section, 'print_once').mockReturnValue(SUCCESS_EXIT_CODE)
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
		output.stderr.push(String(chunk))

		return true
	})
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('run_review_cli.run — a lane child after its recorded round 1', () => {
	it('refuses the open with the ship as the next step, minting no brief and launching nothing', async () => {
		handed_over.mockResolvedValue(true)

		expect(await run_review_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(stderr_text()).toContain(SHIP_STEP)
		expect(handed_over).toHaveBeenCalledWith(ISSUE)
		expect(brief_run).not.toHaveBeenCalled()
		expect(launch_gate).not.toHaveBeenCalled()
		expect(launch_pinned).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#5655: the refusal guards the open alone; the join that closes round 1 still runs.
	it('still joins the pair after an attested round 1', async () => {
		handed_over.mockResolvedValue(true)

		await run_review_cli.run(['--join'])

		expect(wait_gate).toHaveBeenCalledOnce()
		expect(handed_over).not.toHaveBeenCalled()
	})

	it('briefs as before when round 1 is not attested (an interrupted review, or outside a lane)', async () => {
		handed_over.mockResolvedValue(false)

		expect(await run_review_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(brief_run).toHaveBeenCalledWith([], expect.any(Function))
		expect(stderr_text()).not.toContain(SHIP_STEP)
	})
})

describe('run_review_cli.run — opens never asked', () => {
	it('never refuses the ship’s own --code-only open', async () => {
		handed_over.mockResolvedValue(true)

		expect(await run_review_cli.run([run_review.CODE_ONLY_FLAG])).toBe(SUCCESS_EXIT_CODE)
		expect(handed_over).not.toHaveBeenCalled()
		expect(brief_run).toHaveBeenCalledWith([])
		expect(run_step_section.print_once).not.toHaveBeenCalled()
	})

	it('briefs a branch that names no issue without asking', async () => {
		branch.mockResolvedValue('main')

		expect(await run_review_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(handed_over).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#5626: the open prints the section that governs it once its argv is accepted, and a
// print that fails stops the open before any brief.
describe('run_review_cli.run — the governing section', () => {
	it('prints the run:review section before the brief', async () => {
		handed_over.mockResolvedValue(false)

		expect(await run_review_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(run_step_section.print_once).toHaveBeenCalledExactlyOnceWith('run:review')
	})

	it('stops with the print exit code, minting no brief', async () => {
		vi.mocked(run_step_section.print_once).mockReturnValue(PRINT_EXIT_CODE)

		expect(await run_review_cli.run([])).toBe(PRINT_EXIT_CODE)
		expect(brief_run).not.toHaveBeenCalled()
	})

	it('prints nothing for a refused argv, only its usage line', async () => {
		expect(await run_review_cli.run(['--nope'])).toBe(FAILURE_EXIT_CODE)
		expect(run_step_section.print_once).not.toHaveBeenCalled()
	})
})
