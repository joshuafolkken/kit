import type { JoshResult } from '#scripts/josh/josh-run'
import { run_review_pinned } from '#scripts/run/review/run-review-pinned'
import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import type { PinnedReport } from '#scripts/test/test-pinned-logic'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShipArguments } from './run-ship-steps'

const {
	run_mock,
	read_mock,
	clear_mock,
	pre_detach_checks,
	reusable_mock,
	on_tree_mock,
	held_mock,
} = vi.hoisted(() => ({
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
	on_tree_mock: vi.fn<() => Promise<PinnedSummary | undefined>>(),
	held_mock: vi.fn<(max_hunks: number) => Promise<PinnedReport | undefined>>(),
}))

vi.mock('#scripts/test/test-pinned', () => ({ test_pinned: { held_report: held_mock } }))

vi.mock('#scripts/run/review/run-review-pinned-join', () => ({
	run_review_pinned_join: { answer_on_tree: on_tree_mock },
}))

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: { run_buffered_process: run_mock },
}))
// The real `not_run_summary`, so a check that left no answer fails open as it does in production.
vi.mock(import('#scripts/test/test-pinned-record'), async (import_original) => {
	const original = await import_original()

	return {
		test_pinned_record: { ...original.test_pinned_record, read: read_mock, clear: clear_mock },
	}
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
const SKIPPED_NOTE_PREFIX =
	'test:pinned not run before the detach; round 1 lists the unpinned places under --unpinned-ok: '
const SHIP_ARGS: ShipArguments = {
	title: 'Ship #4833',
	number: ISSUE,
	notify: [],
	body: [],
	body_path: undefined,
	cites: [],
	is_review: true,
	is_detach: true,
	unpinned_ok: [],
}
const PASSED: JoshResult = { code: OK, out: 'pre-detach checks passed' }
const HELD: PinnedReport = {
	unpinned: [
		{
			file: 'scripts/issue/issue-file-cli.ts',
			new_start: 49,
			new_count: 1,
			old_lines: [],
			is_green: true,
		},
	],
	stopped: [],
	is_held: true,
	unchecked: [],
	unparsed: [],
	max_hunks: 1,
	has_runner: true,
}

function launched_token(): string | undefined {
	return run_mock.mock.calls[0]?.[0].at(-1)
}

async function check(unpinned_ok: ReadonlyArray<string>): Promise<JoshResult> {
	return await run_ship_pre_detach_pinned.pinned_check({ number: ISSUE, unpinned_ok })
}

async function carried(options: {
	is_review: boolean
	unpinned_ok: ReadonlyArray<string>
}): Promise<ShipArguments> {
	return await run_ship_pre_detach_pinned.with_recorded_reason({ ...SHIP_ARGS, ...options })
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
	on_tree_mock.mockReset().mockResolvedValue(undefined)
	held_mock.mockReset().mockResolvedValue(undefined)
	vi.spyOn(run_review_pinned_accepted, 'recorded_reason').mockReset().mockResolvedValue(undefined)
})

// joshuafolkken/kit#4888: the tree `run:review` checked is not checked twice.
describe('run_ship_pre_detach_pinned.pinned_check on the tree run:review checked', () => {
	it("judges the background check's answer and runs no josh test:pinned of its own", async () => {
		on_tree_mock.mockResolvedValue(CLEAR)

		expect(await check([])).toStrictEqual({ code: OK, out: CLEAR.text })
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('stops on an unpinned place the background check found', async () => {
		on_tree_mock.mockResolvedValue(UNPINNED)
		read_mock.mockReturnValue(CLEAR)

		const result = await check([])

		expect(result.code).toBe(FAILED)
		expect(run_mock).not.toHaveBeenCalled()
	})
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

// joshuafolkken/kit#5078: a re-ship with a new reason judges the cached verdicts and probes nothing.
describe('run_ship_pre_detach_pinned.pinned_check under --unpinned-ok on a probed tree', () => {
	beforeEach(() => {
		reusable_mock.mockResolvedValue(true)
	})

	it('judges the held verdicts under the reason and launches no josh test:pinned', async () => {
		held_mock.mockResolvedValue(HELD)

		const result = await check(UNPINNED_OK)

		expect(result).toStrictEqual({
			code: OK,
			out: `${test_pinned_record.summary_of(HELD).text}Unpinned accepted by the implementer: ${REASON}\n`,
		})
		expect(run_mock).not.toHaveBeenCalled()
		expect(on_tree_mock).not.toHaveBeenCalled()
	})

	it('probes when the cache no longer holds a hunk', async () => {
		await check(UNPINNED_OK)

		expect(held_mock).toHaveBeenCalledOnce()
		expect(run_mock).toHaveBeenCalledOnce()
	})

	it('probes when the cache could not be read', async () => {
		held_mock.mockRejectedValue(new Error('no base'))

		await check(UNPINNED_OK)

		expect(run_mock).toHaveBeenCalledOnce()
	})

	it('reads no cached verdict without a reason', async () => {
		await check([])

		expect(held_mock).not.toHaveBeenCalled()
		expect(run_mock).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#4974: a reason an earlier run on this branch accepted is the ship's --unpinned-ok.
describe('run_ship_pre_detach_pinned.with_recorded_reason', () => {
	beforeEach(() => {
		vi.mocked(run_review_pinned_accepted.recorded_reason).mockResolvedValue(REASON)
	})

	it('carries the recorded reason, so the pinned check launches no josh test:pinned', async () => {
		const args = await carried({ is_review: true, unpinned_ok: [] })
		const result = await run_ship_pre_detach_pinned.pinned_check(args)

		expect(args.unpinned_ok).toStrictEqual(UNPINNED_OK)
		expect(result).toStrictEqual({ code: OK, out: `${SKIPPED_NOTE_PREFIX}${REASON}\n` })
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('leaves a ship with no recorded reason as it was, so the pinned check probes and stops', async () => {
		vi.mocked(run_review_pinned_accepted.recorded_reason).mockResolvedValue(undefined)

		const args = await carried({ is_review: true, unpinned_ok: [] })
		const result = await run_ship_pre_detach_pinned.pinned_check(args)

		expect(args.unpinned_ok).toStrictEqual([])
		expect(result.code).toBe(FAILED)
		expect(run_mock).toHaveBeenCalledOnce()
	})

	it('keeps a given --unpinned-ok and reads no record', async () => {
		const given = [run_review_pinned.UNPINNED_OK_FLAG, 'given']
		const args = await carried({ is_review: true, unpinned_ok: given })

		expect(args.unpinned_ok).toStrictEqual(given)
		expect(run_review_pinned_accepted.recorded_reason).not.toHaveBeenCalled()
	})

	it('reads no record without --review, where --unpinned-ok is refused', async () => {
		const args = await carried({ is_review: false, unpinned_ok: [] })

		expect(args.unpinned_ok).toStrictEqual([])
		expect(run_review_pinned_accepted.recorded_reason).not.toHaveBeenCalled()
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
