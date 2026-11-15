import type { ReviewSlot } from '#scripts/review/review-attest'
import type { Emit } from '#scripts/review/review-brief-cli'
import type { InteractionStatus } from '#scripts/review/review-interaction'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_briefs } from './run-review-briefs'

const { branch, brief_run, brief_run_to, reading, remove_stamp, write_text_stamp } = vi.hoisted(
	() => ({
		branch: vi.fn<() => Promise<string>>(),
		brief_run: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
		brief_run_to: vi.fn<(argv: ReadonlyArray<string>, emit: Emit) => Promise<number>>(),
		reading: vi.fn<() => Promise<{ inert_line?: string; status: InteractionStatus }>>(),
		remove_stamp: vi.fn<(target: string) => void>(),
		write_text_stamp: vi.fn<(target: string, text: string) => string>(),
	}),
)

vi.mock('#scripts/git/git-command', () => ({ git_command: { branch } }))
vi.mock('#scripts/josh/stamp-file', () => ({ stamp_file: { remove_stamp, write_text_stamp } }))
vi.mock('#scripts/lane/lane-session-broker', () => ({
	lane_session_broker: {
		review_paths: (_root: string, slot: ReviewSlot) => ({
			brief: `/briefs/brief-${slot}.md`,
			findings: `/briefs/findings-${slot}.txt`,
		}),
	},
}))
vi.mock('#scripts/review/review-brief-cli', () => ({
	review_brief_cli: { run: brief_run, run_to: brief_run_to },
}))
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, reading } }
})
vi.mock('#scripts/review/review-pair', () => ({ review_pair: { offer: () => undefined } }))

const CODE: ReviewSlot = 'code'
const INTERACTION: ReviewSlot = 'interaction'
const CODE_PATH = '/briefs/brief-code.md'
const CODE_BRIEF = 'CODE BRIEF'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const INERT_LINE = 'Interaction review not due'

const output = { stdout: [] as Array<string>, stderr: [] as Array<string> }

function capture(sink: Array<string>): (chunk: string | Uint8Array) => boolean {
	return (chunk) => {
		sink.push(String(chunk))

		return true
	}
}

beforeEach(() => {
	output.stdout = []
	output.stderr = []
	branch.mockResolvedValue('7598-lane')
	reading.mockReset().mockResolvedValue({ status: 'missing' })
	brief_run.mockReset().mockResolvedValue(SUCCESS_EXIT_CODE)
	brief_run_to.mockReset().mockImplementation(async (argv, emit) => {
		emit(argv.length > 0 ? 'INTERACTION BRIEF' : CODE_BRIEF)

		return await SUCCESS_EXIT_CODE
	})
	write_text_stamp.mockReset()
	remove_stamp.mockReset()
	vi.spyOn(process.stdout, 'write').mockImplementation(capture(output.stdout))
	vi.spyOn(process.stderr, 'write').mockImplementation(capture(output.stderr))
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_review_briefs.brief_slots', () => {
	it("briefs code alone for the ship's own --code-only open", async () => {
		await expect(run_review_briefs.brief_slots(true)).resolves.toStrictEqual([CODE])
		expect(reading).not.toHaveBeenCalled()
	})

	it('briefs code alone on a branch that names no issue', async () => {
		branch.mockResolvedValue('main')

		await expect(run_review_briefs.brief_slots(false)).resolves.toStrictEqual([CODE])
	})

	it('adds the interaction slot where the interaction review is due', async () => {
		await expect(run_review_briefs.brief_slots(false)).resolves.toStrictEqual([CODE, INTERACTION])
	})

	it('prints the inert line on stderr when the interaction review is not due', async () => {
		reading.mockResolvedValue({ inert_line: INERT_LINE, status: 'not-required' })

		await expect(run_review_briefs.brief_slots(false)).resolves.toStrictEqual([CODE])
		expect(output.stderr.join('')).toBe(`${INERT_LINE}\n`)
	})
})

describe('run_review_briefs.open_briefs', () => {
	it("prints code's brief on stdout for the --code-only open, writing no file", async () => {
		await expect(
			run_review_briefs.open_briefs({ is_code_only: true, slots: [CODE] }),
		).resolves.toBe(SUCCESS_EXIT_CODE)
		expect(brief_run).toHaveBeenCalledWith([])
		expect(write_text_stamp).not.toHaveBeenCalled()
	})

	it('writes the code brief, drops its old findings and prints its path and prompt', async () => {
		await run_review_briefs.open_briefs({ is_code_only: false, slots: [CODE] })

		expect(write_text_stamp).toHaveBeenCalledWith(CODE_PATH, `${CODE_BRIEF}\n`)
		expect(remove_stamp).toHaveBeenCalledWith('/briefs/findings-code.txt')
		expect(output.stdout.join('')).toBe(
			`code brief: ${CODE_PATH}\ncode prompt: ${run_ship_review.round_one_opening(CODE_PATH)}\n`,
		)
	})

	it('writes the interaction brief after the code brief', async () => {
		await run_review_briefs.open_briefs({ is_code_only: false, slots: [CODE, INTERACTION] })

		expect(brief_run_to.mock.calls.map(([argv]) => argv)).toStrictEqual([[], ['--interaction']])
	})

	it('writes no interaction brief after a code brief that refused', async () => {
		brief_run_to.mockResolvedValue(FAILURE_EXIT_CODE)

		await expect(
			run_review_briefs.open_briefs({ is_code_only: false, slots: [CODE, INTERACTION] }),
		).resolves.toBe(FAILURE_EXIT_CODE)
		expect(brief_run_to).toHaveBeenCalledTimes(1)
		expect(write_text_stamp).not.toHaveBeenCalled()
	})
})
