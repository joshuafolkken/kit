import type { InteractionStatus } from '#scripts/review/review-interaction'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review } from './run-review'
import { run_review_cli } from './run-review-cli'

// joshuafolkken/kit#4802: where the interaction review is due and not yet recorded, `josh run:review`
// prints its brief after code's, so the child's round 1 reviews both and `josh ship` reruns neither.
// `--code-only` is the ship's own open, which mints the interaction brief itself.

const { branch, brief_run, interaction_status, launch_pinned } = vi.hoisted(() => ({
	branch: vi.fn<() => Promise<string>>(),
	brief_run: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
	interaction_status: vi.fn<(issue: number) => Promise<InteractionStatus>>(),
	launch_pinned: vi.fn<(root: string, reason?: string) => { kind: string }>(),
}))

vi.mock('#scripts/git/git-command', () => ({ git_command: { branch } }))
vi.mock('#scripts/review/review-brief-cli', () => ({
	review_brief_cli: { run: brief_run, scoped_refusal: async () => undefined },
}))
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: interaction_status } }
})
vi.mock('./run-review-pinned-steps', () => ({
	run_review_pinned_steps: { launch: launch_pinned, clear: vi.fn() },
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
const CODE_BRIEF = 'CODE BRIEF\n'
const INTERACTION_BRIEF = 'INTERACTION BRIEF\n'
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
	brief_run.mockReset().mockImplementation(async (argv) => {
		process.stdout.write(brief_of(argv))

		return 0
	})
	vi.spyOn(process.stdout, 'write').mockImplementation(capture(output.stdout))
	vi.spyOn(process.stderr, 'write').mockImplementation(capture(output.stderr))
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run:review where the interaction review is due', () => {
	it('prints the interaction brief under its header after code’s, and the two-reviewer hint', async () => {
		expect(await run_review_cli.run([])).toBe(0)
		expect(interaction_status).toHaveBeenCalledWith(ISSUE)
		expect(brief_run.mock.calls).toStrictEqual([[[]], [[INTERACTION_FLAG]]])
		expect(output.stdout.join('')).toBe(
			`${CODE_BRIEF}${run_review_cli.INTERACTION_HEADER}\n${INTERACTION_BRIEF}`,
		)
		expect(output.stderr.join('')).toContain(run_review_cli.INTERACTION_HINT)
	})

	it('opens no interaction brief after a code brief that refused, and prints no hint', async () => {
		brief_run.mockResolvedValue(FAILURE_EXIT_CODE)

		expect(await run_review_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(brief_run).toHaveBeenCalledOnce()
		expect(output.stderr.join('')).not.toContain(run_review_cli.JOIN_HINT)
	})

	it('returns the interaction brief’s refusal, with no hint', async () => {
		brief_run.mockImplementation(async (argv) => (argv.includes(INTERACTION_FLAG) ? 1 : 0))

		expect(await run_review_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(output.stderr.join('')).not.toContain(run_review_cli.JOIN_HINT)
	})

	it('prints both briefs unchanged under --unpinned-ok, its reason riding on the launch', async () => {
		expect(await run_review_cli.run([UNPINNED_OK, REASON])).toBe(0)
		expect(launch_pinned.mock.lastCall?.slice(0, 2)).toStrictEqual([expect.any(String), REASON])
		expect(output.stdout.join('')).toBe(
			`${CODE_BRIEF}${run_review_cli.INTERACTION_HEADER}\n${INTERACTION_BRIEF}`,
		)
	})
})

describe('run:review that briefs code alone', () => {
	it.each<InteractionStatus>(['not-required', 'ok'])(
		'prints only code’s brief when the interaction review is %s',
		async (status) => {
			interaction_status.mockResolvedValue(status)

			expect(await run_review_cli.run([])).toBe(0)
			expect(brief_run.mock.calls).toStrictEqual([[[]]])
			expect(output.stdout.join('')).toBe(CODE_BRIEF)
			expect(output.stderr.join('')).not.toContain(run_review_cli.INTERACTION_HINT)
		},
	)

	it('prints only code’s brief on a branch that names no issue', async () => {
		branch.mockResolvedValue('main')

		expect(await run_review_cli.run([])).toBe(0)
		expect(interaction_status).not.toHaveBeenCalled()
		expect(brief_run.mock.calls).toStrictEqual([[[]]])
	})

	it('prints only code’s brief under --code-only, the ship’s own open, without asking', async () => {
		expect(await run_review_cli.run([run_review.CODE_ONLY_FLAG])).toBe(0)
		expect(branch).not.toHaveBeenCalled()
		expect(brief_run.mock.calls).toStrictEqual([[[]]])
	})

	it('accepts --unpinned-ok after --code-only, with code’s brief and the reason on the launch', async () => {
		expect(await run_review_cli.run([run_review.CODE_ONLY_FLAG, UNPINNED_OK, REASON])).toBe(0)
		expect(brief_run.mock.calls).toStrictEqual([[[]]])
		expect(launch_pinned.mock.lastCall?.slice(0, 2)).toStrictEqual([expect.any(String), REASON])
		expect(output.stdout.join('')).toBe(CODE_BRIEF)
	})

	it('refuses an argument after --code-only that is not --unpinned-ok', async () => {
		expect(await run_review_cli.run([run_review.CODE_ONLY_FLAG, '--join'])).toBe(FAILURE_EXIT_CODE)
		expect(brief_run).not.toHaveBeenCalled()
	})
})
