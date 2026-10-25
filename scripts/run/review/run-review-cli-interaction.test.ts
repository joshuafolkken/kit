import type { ReviewSlot } from '#scripts/review/review-attest'
import type { Emit } from '#scripts/review/review-brief-cli'
import type { InteractionStatus } from '#scripts/review/review-interaction'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review } from './run-review'
import { run_review_cli } from './run-review-cli'

// joshuafolkken/kit#4802: where the interaction review is due and not yet recorded, `josh run:review`
// writes its brief after code's, so the child's round 1 reviews both and `josh ship` reruns neither.
// `--code-only` is the ship's own open, which mints the interaction brief itself.
//
// joshuafolkken/kit#4863: each brief goes to the file `josh ship` hands that slot's reviewer, and
// stdout carries only the paths, so the two briefs together never overrun the Bash output cap.

const { early_launch, early_prepare, early_push } = vi.hoisted(() => ({
	early_launch: vi.fn(),
	early_prepare: vi.fn<() => Promise<boolean>>(),
	early_push: vi.fn<() => Promise<number>>(),
}))

const { branch, brief_run, brief_run_to, interaction_status, launch_pinned, write_text_stamp } =
	vi.hoisted(() => ({
		branch: vi.fn<() => Promise<string>>(),
		brief_run: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
		brief_run_to: vi.fn<(argv: ReadonlyArray<string>, emit: Emit) => Promise<number>>(),
		interaction_status: vi.fn<(issue: number) => Promise<InteractionStatus>>(),
		launch_pinned: vi.fn<(root: string, reason?: string) => { kind: string }>(),
		write_text_stamp: vi.fn<(target: string, text: string) => string>(),
	}))

vi.mock('#scripts/git/git-command', () => ({ git_command: { branch } }))
vi.mock('#scripts/josh/stamp-file', () => ({ stamp_file: { write_text_stamp } }))
vi.mock('#scripts/lane/lane-session-broker', () => ({
	lane_session_broker: {
		review_paths: (_root: string, slot: ReviewSlot) => ({ brief: `/briefs/brief-${slot}.md` }),
	},
}))
vi.mock('#scripts/review/review-brief-cli', () => ({
	review_brief_cli: { run: brief_run, run_to: brief_run_to, scoped_refusal: async () => undefined },
}))
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: interaction_status } }
})
// joshuafolkken/kit#4907: `run-review-early-push.test.ts` owns the commit and the push themselves.
vi.mock('./run-review-early-push', () => ({
	run_review_early_push: {
		PUSH_FLAG: '--push',
		launch: early_launch,
		prepare: early_prepare,
		push: early_push,
	},
}))
vi.mock('./run-review-pinned-steps', () => ({
	run_review_pinned_steps: { launch: launch_pinned, clear: vi.fn(), is_answered: () => false },
}))
vi.mock('./run-review-steps', () => ({
	run_review_steps: {
		launch_gate: () => ({ kind: 'launched' }),
		mark_gate_starting: vi.fn(async () => {
			await Promise.resolve()
		}),
		write_timing_start: vi.fn(),
	},
}))

const ISSUE = 4802
const LANE_BRANCH = `${String(ISSUE)}-lane`
const INTERACTION_FLAG = '--interaction'
const CODE_BRIEF = 'CODE BRIEF'
const INTERACTION_BRIEF = 'INTERACTION BRIEF'
const CODE_PATH = '/briefs/brief-code.md'
const INTERACTION_PATH = '/briefs/brief-interaction.md'
const CODE: ReviewSlot = 'code'
const INTERACTION: ReviewSlot = 'interaction'

function brief_lines(slot: ReviewSlot, brief: string): string {
	return `${slot} brief: ${brief}\n${slot} prompt: ${run_ship_review.round_one_opening(brief)}\n`
}

const PATH_LINES = `${brief_lines(CODE, CODE_PATH)}${brief_lines(INTERACTION, INTERACTION_PATH)}`
const FAILURE_EXIT_CODE = 1
const UNPINNED_OK = '--unpinned-ok'
const REASON = 'a doc-only change'

const output = { stdout: [] as Array<string>, stderr: [] as Array<string> }

function capture(sink: Array<string>): (chunk: string | Uint8Array) => boolean {
	return (chunk) => {
		sink.push(String(chunk))

		return true
	}
}

function brief_of(argv: ReadonlyArray<string>): string {
	return argv.includes(INTERACTION_FLAG) ? INTERACTION_BRIEF : CODE_BRIEF
}

beforeEach(() => {
	output.stdout = []
	output.stderr = []
	branch.mockResolvedValue(LANE_BRANCH)
	interaction_status.mockReset().mockResolvedValue('missing')
	launch_pinned.mockReset().mockReturnValue({ kind: 'launched' })
	write_text_stamp.mockReset()
	brief_run.mockReset().mockImplementation(async (argv) => {
		process.stdout.write(`${brief_of(argv)}\n`)

		return 0
	})
	brief_run_to.mockReset().mockImplementation(async (argv, emit) => {
		emit(brief_of(argv))

		return 0
	})
	vi.spyOn(process.stdout, 'write').mockImplementation(capture(output.stdout))
	vi.spyOn(process.stderr, 'write').mockImplementation(capture(output.stderr))
})

beforeEach(() => {
	early_launch.mockReset()
	early_prepare.mockReset().mockResolvedValue(false)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run:review where the interaction review is due', () => {
	it('writes code’s brief, then the interaction brief, to their files, and the two-reviewer hint', async () => {
		expect(await run_review_cli.run([])).toBe(0)
		expect(interaction_status).toHaveBeenCalledWith(ISSUE)
		expect(brief_run_to.mock.calls.map(([argv]) => argv)).toStrictEqual([[], [INTERACTION_FLAG]])
		expect(write_text_stamp.mock.calls).toStrictEqual([
			[CODE_PATH, `${CODE_BRIEF}\n`],
			[INTERACTION_PATH, `${INTERACTION_BRIEF}\n`],
		])
		expect(output.stderr.join('')).toContain(run_review_cli.INTERACTION_HINT)
	})

	it('opens no interaction brief after a code brief that refused, and prints no hint', async () => {
		brief_run_to.mockResolvedValue(FAILURE_EXIT_CODE)

		expect(await run_review_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(brief_run_to).toHaveBeenCalledOnce()
		expect(write_text_stamp).not.toHaveBeenCalled()
		expect(output.stderr.join('')).not.toContain(run_review_cli.JOIN_HINT)
	})

	it('returns the interaction brief’s refusal, with no hint and no interaction file', async () => {
		brief_run_to.mockImplementation(async (argv) => (argv.includes(INTERACTION_FLAG) ? 1 : 0))

		expect(await run_review_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(write_text_stamp.mock.calls.map(([target]) => target)).toStrictEqual([CODE_PATH])
		expect(output.stderr.join('')).not.toContain(run_review_cli.JOIN_HINT)
	})

	it('writes both briefs unchanged under --unpinned-ok, its reason riding on the launch', async () => {
		expect(await run_review_cli.run([UNPINNED_OK, REASON])).toBe(0)
		expect(launch_pinned.mock.lastCall?.slice(0, 2)).toStrictEqual([expect.any(String), REASON])
		expect(output.stdout.join('')).toBe(PATH_LINES)
	})
})

describe('run:review stdout', () => {
	it('carries only the two paths, however long the briefs are', async () => {
		const long_brief = 'x'.repeat(run_review.CODE_ONLY_FLAG.length * ISSUE)

		brief_run_to.mockImplementation(async (_argv, emit) => {
			emit(long_brief)

			return 0
		})

		expect(await run_review_cli.run([])).toBe(0)
		expect(output.stdout.join('')).toBe(PATH_LINES)
		expect(write_text_stamp.mock.calls.map(([, text]) => text)).toStrictEqual([
			`${long_brief}\n`,
			`${long_brief}\n`,
		])
	})
})

describe('run:review that briefs code alone', () => {
	it.each<InteractionStatus>(['not-required', 'ok'])(
		'writes only code’s brief when the interaction review is %s',
		async (status) => {
			interaction_status.mockResolvedValue(status)

			expect(await run_review_cli.run([])).toBe(0)
			expect(brief_run_to.mock.calls.map(([argv]) => argv)).toStrictEqual([[]])
			expect(output.stdout.join('')).toBe(brief_lines(CODE, CODE_PATH))
			expect(output.stderr.join('')).not.toContain(run_review_cli.INTERACTION_HINT)
		},
	)

	it('writes only code’s brief on a branch that names no issue', async () => {
		branch.mockResolvedValue('main')

		expect(await run_review_cli.run([])).toBe(0)
		expect(interaction_status).not.toHaveBeenCalled()
		expect(brief_run_to.mock.calls.map(([argv]) => argv)).toStrictEqual([[]])
	})

	it('prints code’s brief on stdout under --code-only, the ship’s own open, writing no file', async () => {
		expect(await run_review_cli.run([run_review.CODE_ONLY_FLAG])).toBe(0)
		expect(branch).not.toHaveBeenCalled()
		expect(brief_run.mock.calls).toStrictEqual([[[]]])
		expect(write_text_stamp).not.toHaveBeenCalled()
		expect(output.stdout.join('')).toBe(`${CODE_BRIEF}\n`)
	})

	it('accepts --unpinned-ok after --code-only, with code’s brief and the reason on the launch', async () => {
		expect(await run_review_cli.run([run_review.CODE_ONLY_FLAG, UNPINNED_OK, REASON])).toBe(0)
		expect(brief_run.mock.calls).toStrictEqual([[[]]])
		expect(launch_pinned.mock.lastCall?.slice(0, 2)).toStrictEqual([expect.any(String), REASON])
		expect(output.stdout.join('')).toBe(`${CODE_BRIEF}\n`)
	})

	it('refuses an argument after --code-only that is not --unpinned-ok', async () => {
		expect(await run_review_cli.run([run_review.CODE_ONLY_FLAG, '--join'])).toBe(FAILURE_EXIT_CODE)
		expect(brief_run).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4907: the push waits on the gate this pair launched, so it follows a written brief.
describe('run:review early push', () => {
	it('launches the early push after a written brief, when the open prepared one', async () => {
		interaction_status.mockResolvedValue('ok')
		early_prepare.mockResolvedValue(true)

		expect(await run_review_cli.run([])).toBe(0)
		expect(early_launch).toHaveBeenCalledOnce()
	})

	it('launches no early push after a brief that refused', async () => {
		early_prepare.mockResolvedValue(true)
		brief_run_to.mockResolvedValue(FAILURE_EXIT_CODE)

		expect(await run_review_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(early_launch).not.toHaveBeenCalled()
	})

	it('runs the push alone under --push', async () => {
		early_push.mockResolvedValue(0)

		expect(await run_review_cli.run(['--push'])).toBe(0)
		expect(early_push).toHaveBeenCalledOnce()
		expect(brief_run_to).not.toHaveBeenCalled()
	})
})
