import type { InteractionStatus } from '#scripts/review/review-interaction'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review } from './run-review'
import { run_review_cli } from './run-review-cli'
import type { PinnedVerdict } from './run-review-pinned'

// joshuafolkken/kit#4802: where the interaction review is due and not yet recorded, `josh run:review`
// prints its brief after code's, so the child's round 1 reviews both and `josh ship` reruns neither.
// `--code-only` is the ship's own open, which mints the interaction brief itself.

const { branch, brief_run, interaction_status, pinned_check } = vi.hoisted(() => ({
	branch: vi.fn<() => Promise<string>>(),
	brief_run: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
	interaction_status: vi.fn<(issue: number) => Promise<InteractionStatus>>(),
	pinned_check: vi.fn<(reason: string | undefined) => Promise<PinnedVerdict>>(),
}))

vi.mock('#scripts/git/git-command', () => ({ git_command: { branch } }))
vi.mock('#scripts/review/review-brief-cli', () => ({ review_brief_cli: { run: brief_run } }))
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: interaction_status } }
})
vi.mock('./run-review-pinned', async (import_original) => {
	const { run_review_pinned } = await import_original<Record<'run_review_pinned', object>>()

	return { run_review_pinned: { ...run_review_pinned, check: pinned_check } }
})
vi.mock('./run-review-pinned-steps', () => ({
	run_review_pinned_steps: { launch: () => ({ kind: 'launched' }), clear: vi.fn() },
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
const ACCEPTED_LIST = `unpinned 1 · unchecked 0\nUnpinned accepted by the implementer: ${REASON}\n`

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
	pinned_check.mockReset().mockResolvedValue({ kind: 'accepted', text: ACCEPTED_LIST })
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

	it('puts the --unpinned-ok accepted list under code’s brief, before the interaction header', async () => {
		expect(await run_review_cli.run([UNPINNED_OK, REASON])).toBe(0)
		expect(pinned_check).toHaveBeenCalledWith(REASON)
		expect(output.stdout.join('')).toBe(
			`${CODE_BRIEF}${ACCEPTED_LIST}${run_review_cli.INTERACTION_HEADER}\n${INTERACTION_BRIEF}`,
		)
	})

	it('sends the accepted list to stderr when code’s brief refused', async () => {
		brief_run.mockResolvedValue(FAILURE_EXIT_CODE)

		expect(await run_review_cli.run([UNPINNED_OK, REASON])).toBe(FAILURE_EXIT_CODE)
		expect(output.stdout.join('')).not.toContain(ACCEPTED_LIST)
		expect(output.stderr.join('')).toContain(ACCEPTED_LIST)
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

	it('accepts --unpinned-ok after --code-only, with code’s brief and the accepted list', async () => {
		expect(await run_review_cli.run([run_review.CODE_ONLY_FLAG, UNPINNED_OK, REASON])).toBe(0)
		expect(brief_run.mock.calls).toStrictEqual([[[]]])
		expect(output.stdout.join('')).toBe(`${CODE_BRIEF}${ACCEPTED_LIST}`)
	})

	it('refuses an argument after --code-only that is not --unpinned-ok', async () => {
		expect(await run_review_cli.run([run_review.CODE_ONLY_FLAG, '--join'])).toBe(FAILURE_EXIT_CODE)
		expect(brief_run).not.toHaveBeenCalled()
	})
})
