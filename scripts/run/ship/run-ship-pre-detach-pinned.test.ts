import type { JoshResult } from '#scripts/josh/josh-run'
import { run_review_pinned } from '#scripts/run/review/run-review-pinned'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { run_mock, read_mock, clear_mock, pre_detach_checks } = vi.hoisted(() => ({
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
}))

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: { run_buffered_process: run_mock },
}))
// The real `not_run_summary`, so a check that left no answer fails open as it does in production.
vi.mock(import('#scripts/test/test-pinned-record'), async (import_original) => {
	const { test_pinned_record } = await import_original()

	return { test_pinned_record: { ...test_pinned_record, read: read_mock, clear: clear_mock } }
})
vi.mock('./run-ship-pre-detach', () => ({ run_ship_pre_detach: { checks: pre_detach_checks } }))

const { run_ship_pre_detach_pinned } = await import('./run-ship-pre-detach-pinned')

// joshuafolkken/kit#4785: a `--review` ship runs `josh test:pinned` before the detach, so a hunk added
// after the child's `run:review` stops in the foreground with the text `run:review --join` prints.

const OK = 0
const FAILED = 1
const REASON = 'a log line no test can observe'
const UNPINNED_TEXT = 'unpinned 1 · unchecked 0\nunpinned scripts/issue/issue-file-cli.ts:49\n'
const UNPINNED: PinnedSummary = { text: UNPINNED_TEXT, unpinned_count: 1 }
const CLEAR: PinnedSummary = { text: 'unpinned 0 · unchecked 0\n', unpinned_count: 0 }
const PASSED: JoshResult = { code: OK, out: 'pre-detach checks passed' }

function launched_token(): string | undefined {
	return run_mock.mock.calls[0]?.[0].at(-1)
}

// The pinned check `checks_for` handed the pre-detach checks, run.
async function handed_pinned(options: {
	is_review: boolean
	unpinned_ok: ReadonlyArray<string>
}): Promise<JoshResult | undefined> {
	await run_ship_pre_detach_pinned.checks_for(options)()
	const pinned = pre_detach_checks.mock.calls[0]?.[2]

	return pinned === undefined ? undefined : await pinned()
}

beforeEach(() => {
	run_mock.mockReset().mockResolvedValue({ output: '', exit_code: OK })
	read_mock.mockReset()
	clear_mock.mockReset()
	pre_detach_checks.mockReset().mockResolvedValue(PASSED)
})

describe('run_ship_pre_detach_pinned.pinned_check', () => {
	it('stops on an unpinned hunk with the file:line and the stop note run:review prints', async () => {
		read_mock.mockReturnValue(UNPINNED)

		expect(await run_ship_pre_detach_pinned.pinned_check([])).toStrictEqual({
			code: FAILED,
			out: `${UNPINNED_TEXT}${run_review_pinned.STOP_NOTE}\n`,
		})
	})

	it('runs josh test:pinned as its own command and reads, then clears, its record', async () => {
		read_mock.mockReturnValue(CLEAR)

		const result = await run_ship_pre_detach_pinned.pinned_check([])
		const token = launched_token()

		expect(result).toStrictEqual({ code: OK, out: CLEAR.text })
		expect(run_mock.mock.calls[0]?.[0]).toStrictEqual(['josh', 'test:pinned', '--record', token])
		expect(read_mock).toHaveBeenCalledWith(token)
		expect(clear_mock).toHaveBeenCalledWith(token)
	})

	it('accepts an unpinned hunk under --unpinned-ok and names the reason', async () => {
		read_mock.mockReturnValue(UNPINNED)

		const result = await run_ship_pre_detach_pinned.pinned_check([
			run_review_pinned.UNPINNED_OK_FLAG,
			REASON,
		])

		expect(result.code).toBe(OK)
		expect(result.out).toContain(REASON)
	})

	it('fails open with the output when the check left no answer', async () => {
		run_mock.mockResolvedValue({ output: 'no base', exit_code: FAILED })
		read_mock.mockReturnValue(undefined)

		const result = await run_ship_pre_detach_pinned.pinned_check([])

		expect(result.code).toBe(OK)
		expect(result.out).toContain('no base')
	})
})

describe('run_ship_pre_detach_pinned.checks_for', () => {
	it('hands the pre-detach checks the pinned check under --review', async () => {
		read_mock.mockReturnValue(UNPINNED)

		const pinned = await handed_pinned({ is_review: true, unpinned_ok: [] })

		expect(pinned?.code).toBe(FAILED)
	})

	it('forwards --unpinned-ok to the pinned check it hands over', async () => {
		read_mock.mockReturnValue(UNPINNED)

		const unpinned_ok = [run_review_pinned.UNPINNED_OK_FLAG, REASON]
		const pinned = await handed_pinned({ is_review: true, unpinned_ok })

		expect(pinned?.code).toBe(OK)
	})

	it('asks no pinned check without --review', async () => {
		expect(await handed_pinned({ is_review: false, unpinned_ok: [] })).toBeUndefined()
		expect(run_mock).not.toHaveBeenCalled()
	})
})
