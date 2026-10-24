import type { JoshResult } from '#scripts/josh/josh-run'
import { run_review_pinned } from '#scripts/run/review/run-review-pinned'
import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { run_mock, read_mock, clear_mock, pre_detach_checks, reusable_mock } = vi.hoisted(() => ({
	run_mock: vi.fn<(list: ReadonlyArray<string>) => Promise<Record<string, unknown>>>(),
	read_mock: vi.fn<(token: string) => PinnedSummary | undefined>(),
	clear_mock: vi.fn<(token: string) => void>(),
	pre_detach_checks:
		vi.fn<
			(
				directory?: string,
				records?: unknown,
				pinned?: () => Promise<JoshResult>,
			) => Promise<JoshResult>
		>(),
	reusable_mock: vi.fn<(issue: number) => Promise<boolean>>(),
}))

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: { run_buffered_process: run_mock },
}))
// The real `not_run_summary`, so a check that left no answer fails open as it does in production.
vi.mock(import('#scripts/test/test-pinned-record'), async (import_original) => {
	const { test_pinned_record } = await import_original()

	return { test_pinned_record: { ...test_pinned_record, read: read_mock, clear: clear_mock } }
})
vi.mock('#scripts/review/review-round-reuse', () => ({
	review_round_reuse: { is_reusable_here: reusable_mock },
}))
vi.mock('./run-ship-pre-detach', () => ({ run_ship_pre_detach: { checks: pre_detach_checks } }))
// No git directory, so no accepted reason is recorded or read (`run-review-pinned-accepted.ts`).
vi.mock('#scripts/git/git-command', () => ({ git_command: { git_directories: async () => [] } }))

const { run_ship_pre_detach_pinned } = await import('./run-ship-pre-detach-pinned')

// joshuafolkken/kit#4785: a `--review` ship runs `josh test:pinned` before the detach, so a hunk added
// after the child's `run:review` stops in the foreground with the text `run:review --join` prints.

const OK = 0
const FAILED = 1
const ISSUE = '4833'
const REASON = 'a log line no test can observe'
const UNPINNED_OK = [run_review_pinned.UNPINNED_OK_FLAG, REASON]
const UNPINNED_TEXT = 'unpinned 1 · unchecked 0\nunpinned scripts/issue/issue-file-cli.ts:49\n'
const UNPINNED: PinnedSummary = {
	text: UNPINNED_TEXT,
	unpinned: ['scripts/issue/issue-file-cli.ts 0123456789abcdef'],
}
const CLEAR: PinnedSummary = { text: 'unpinned 0 · unchecked 0\n', unpinned: [] }
const PASSED: JoshResult = { code: OK, out: 'pre-detach checks passed' }

function launched_token(): string | undefined {
	return run_mock.mock.calls[0]?.[0].at(-1)
}

async function check(unpinned_ok: ReadonlyArray<string>): Promise<JoshResult> {
	return await run_ship_pre_detach_pinned.pinned_check({ number: ISSUE, unpinned_ok })
}

// The pinned check `checks_for` handed the pre-detach checks, run.
async function handed_pinned(options: {
	is_review: boolean
	unpinned_ok: ReadonlyArray<string>
}): Promise<JoshResult | undefined> {
	await run_ship_pre_detach_pinned.checks_for({ ...options, number: ISSUE })()
	const pinned = pre_detach_checks.mock.calls[0]?.[2]

	return pinned === undefined ? undefined : await pinned()
}

beforeEach(() => {
	run_mock.mockReset().mockResolvedValue({ output: '', exit_code: OK })
	read_mock.mockReset().mockReturnValue(UNPINNED)
	clear_mock.mockReset()
	pre_detach_checks.mockReset().mockResolvedValue(PASSED)
	reusable_mock.mockReset().mockResolvedValue(false)
})

describe('run_ship_pre_detach_pinned.pinned_check', () => {
	it('stops on an unpinned hunk with the file:line and the stop note run:review prints', async () => {
		expect(await check([])).toStrictEqual({
			code: FAILED,
			out: `${UNPINNED_TEXT}${run_review_pinned.STOP_NOTE}\n`,
		})
	})

	it('runs josh test:pinned as its own command and reads, then clears, its record', async () => {
		read_mock.mockReturnValue(CLEAR)

		const result = await check([])
		const token = launched_token()

		expect(result).toStrictEqual({ code: OK, out: CLEAR.text })
		expect(run_mock.mock.calls[0]?.[0]).toStrictEqual(['josh', 'test:pinned', '--record', token])
		expect(read_mock).toHaveBeenCalledWith(token)
		expect(clear_mock).toHaveBeenCalledWith(token)
	})

	it('fails open with the output when the check left no answer', async () => {
		run_mock.mockResolvedValue({ output: 'no base', exit_code: FAILED })
		read_mock.mockReturnValue(undefined)

		const result = await check([])

		expect(result.code).toBe(OK)
		expect(result.out).toContain('no base')
	})
})

// joshuafolkken/kit#4833: the reason accepts any answer, and a fresh round 1's join lists the places.
describe('run_ship_pre_detach_pinned.pinned_check under --unpinned-ok', () => {
	it('launches no josh test:pinned when round 1 runs anew, and names the reason', async () => {
		const result = await check(UNPINNED_OK)

		expect(result.code).toBe(OK)
		expect(result.out).toContain(REASON)
		expect(run_mock).not.toHaveBeenCalled()
		expect(reusable_mock).toHaveBeenCalledWith(Number(ISSUE))
	})

	it('probes and lists the places with the reason when the supervisor reuses round 1', async () => {
		reusable_mock.mockResolvedValue(true)

		expect(await check(UNPINNED_OK)).toStrictEqual({
			code: OK,
			out: `${UNPINNED_TEXT}Unpinned accepted by the implementer: ${REASON}\n`,
		})
		expect(run_mock).toHaveBeenCalledOnce()
	})

	// joshuafolkken/kit#4775: a reused round 1 joins no run:review, so this check records the places.
	it('hands the answer and the reason to the record of accepted places', async () => {
		reusable_mock.mockResolvedValue(true)
		const judge = vi.spyOn(run_review_pinned_accepted, 'judge')

		await check(UNPINNED_OK)

		expect(judge).toHaveBeenCalledWith(UNPINNED, REASON)
	})

	it('probes when the reuse question could not be answered', async () => {
		reusable_mock.mockRejectedValue(new Error('git failed'))

		const result = await check(UNPINNED_OK)

		expect(result.code).toBe(OK)
		expect(run_mock).toHaveBeenCalledOnce()
	})

	it('still probes under an --unpinned-ok with a blank reason, and stops', async () => {
		const result = await check([run_review_pinned.UNPINNED_OK_FLAG, ' '])

		expect(result.code).toBe(FAILED)
		expect(run_mock).toHaveBeenCalledOnce()
	})
})

describe('run_ship_pre_detach_pinned.checks_for', () => {
	it('hands the pre-detach checks the pinned check under --review', async () => {
		const pinned = await handed_pinned({ is_review: true, unpinned_ok: [] })

		expect(pinned?.code).toBe(FAILED)
		expect(run_mock).toHaveBeenCalledOnce()
	})

	it('forwards --unpinned-ok to the pinned check it hands over, which probes nothing', async () => {
		const pinned = await handed_pinned({ is_review: true, unpinned_ok: UNPINNED_OK })

		expect(pinned?.code).toBe(OK)
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('asks no pinned check without --review', async () => {
		expect(await handed_pinned({ is_review: false, unpinned_ok: [] })).toBeUndefined()
		expect(run_mock).not.toHaveBeenCalled()
	})
})
