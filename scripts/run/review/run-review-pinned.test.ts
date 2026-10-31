import type { Emit } from '#scripts/review/review-brief-cli'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import type { PinnedReport } from '#scripts/test/test-pinned-logic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_cli } from './run-review-cli'
import { run_review_pinned } from './run-review-pinned'

// joshuafolkken/kit#4647: `josh run:review` runs `josh test:pinned` for round 1, and
// `--unpinned-ok "<reason>"` carries on past an unpinned change.
// joshuafolkken/kit#4770, joshuafolkken/kit#4793: the check runs in the background with or without a
// reason, so the gate and the brief start without waiting on it; `--join` judges its answer
// (`run-review-cli-join.test.ts`).

const { BRIEF_PATH, pinned_run, launch_gate, brief_run, launch_pinned, clear_pinned, mark_due } =
	vi.hoisted(() => ({
		BRIEF_PATH: '/briefs/brief.md',
		pinned_run: vi.fn<(max_hunks: number) => Promise<PinnedReport>>(),
		launch_gate: vi.fn<() => { kind: string; note?: string }>(),
		brief_run: vi.fn<(argv: ReadonlyArray<string>, emit?: Emit) => Promise<number>>(),
		launch_pinned: vi.fn<() => { kind: string; note?: string }>(),
		clear_pinned: vi.fn(),
		mark_due: vi.fn(),
	}))

vi.mock('#scripts/test/test-pinned', () => ({ test_pinned: { run: pinned_run } }))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: { remove_stamp: vi.fn(), write_text_stamp: vi.fn() },
}))
vi.mock('#scripts/lane/lane-session-broker', () => ({
	lane_session_broker: { review_paths: () => ({ brief: BRIEF_PATH }) },
}))
vi.mock('./run-review-join-read', () => ({ run_review_join_read: { mark_due } }))
vi.mock('./run-review-pinned-steps', () => ({
	run_review_pinned_steps: { launch: launch_pinned, clear: clear_pinned, is_answered: () => false },
}))
vi.mock('#scripts/review/review-brief-cli', () => ({
	review_brief_cli: { run: brief_run, run_to: brief_run, scoped_refusal: async () => undefined },
}))
// Code's brief alone: the interaction brief beside it is `run-review-cli-interaction.test.ts`'s.
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: async () => 'not-required' } }
})
vi.mock('./run-review-steps', () => ({
	run_review_steps: {
		launch_gate,
		mark_gate_starting: vi.fn(async () => {
			await Promise.resolve()
		}),
		write_timing_start: vi.fn(),
	},
}))

const BRIEF_LINE = `code brief: ${BRIEF_PATH}\ncode prompt: ${run_ship_review.round_one_opening(BRIEF_PATH)}\n`
const FAILURE_EXIT_CODE = 1
const REASON = 'the branch only logs'
const SITE = 'scripts/a.ts 0123456789abcdef'

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
	launch_gate.mockReturnValue({ kind: 'launched' })
	launch_pinned.mockReset().mockReturnValue({ kind: 'launched' })
	clear_pinned.mockReset()
	pinned_run.mockReset()
	brief_run.mockImplementation(async (_argv, emit) => {
		emit?.('BRIEF')

		return 0
	})
	vi.spyOn(process.stdout, 'write').mockImplementation(capture(output.stdout))
	vi.spyOn(process.stderr, 'write').mockImplementation(capture(output.stderr))
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run:review before round 1', () => {
	it('launches test:pinned in the background and starts the gate and the brief beside it', async () => {
		expect(await run_review_cli.run([])).toBe(0)
		expect(clear_pinned).toHaveBeenCalledOnce()
		expect(launch_pinned).toHaveBeenCalledOnce()
		expect(launch_gate).toHaveBeenCalledOnce()
		expect(pinned_run).not.toHaveBeenCalled()
		expect(output.stdout.join('')).toBe(BRIEF_LINE)
	})

	// joshuafolkken/kit#5212: `review:record` reads a join the lane skipped.
	it('marks the join due once the check is launched', async () => {
		expect(await run_review_cli.run([])).toBe(0)
		expect(mark_due).toHaveBeenCalledOnce()
	})

	it('starts the gate and the brief before an in-place check would have resolved', async () => {
		pinned_run.mockReturnValue(new Promise<PinnedReport>(() => undefined))

		expect(await run_review_cli.run([])).toBe(0)
		expect(launch_gate).toHaveBeenCalledOnce()
		expect(brief_run).toHaveBeenCalledOnce()
	})

	it('carries on to the gate and the brief when the background check cannot be launched', async () => {
		launch_pinned.mockReturnValue({ kind: 'failed', note: 'spawn refused' })

		expect(await run_review_cli.run([])).toBe(0)
		expect(launch_gate).toHaveBeenCalledOnce()
		expect(output.stdout.join('')).toBe(BRIEF_LINE)
		expect(output.stderr.join('')).toContain('could not run, so nothing was checked: spawn refused')
	})

	it('starts the gate and the brief under --unpinned-ok without waiting on test:pinned', async () => {
		pinned_run.mockReturnValue(new Promise<PinnedReport>(() => undefined))

		expect(await run_review_cli.run([run_review_pinned.UNPINNED_OK_FLAG, REASON])).toBe(0)
		expect(launch_pinned.mock.lastCall?.slice(0, 2)).toStrictEqual([expect.any(String), REASON])
		expect(launch_gate).toHaveBeenCalledOnce()
		expect(pinned_run).not.toHaveBeenCalled()
		expect(output.stdout.join('')).toBe(BRIEF_LINE)
	})
})

describe('run:review when no brief follows', () => {
	it('names --unpinned-ok in the usage line it refuses --unpinned-ok without a reason with', async () => {
		expect(await run_review_cli.run([run_review_pinned.UNPINNED_OK_FLAG])).toBe(FAILURE_EXIT_CODE)
		expect(pinned_run).not.toHaveBeenCalled()
		expect(output.stderr.join('')).toBe(
			'Usage: josh run:review [--code-only] [--unpinned-ok "<reason>"] | --join [--fixing] | --pinned | --push\n',
		)
	})
})

describe('run_review_pinned.verdict_of — the answer the join reads', () => {
	it('stops on an unpinned change with the list and the stop note, without a reason', () => {
		const verdict = run_review_pinned.verdict_of({ text: 'LIST\n', unpinned: [SITE] }, undefined)

		expect(verdict).toStrictEqual({
			kind: 'stop',
			text: `LIST\n${run_review_pinned.STOP_NOTE}\n`,
		})
	})

	it('accepts an unpinned change with the list and the reason it was launched with', () => {
		const verdict = run_review_pinned.verdict_of({ text: 'LIST\n', unpinned: [SITE] }, REASON)

		expect(verdict).toStrictEqual({
			kind: 'accepted',
			text: `LIST\nUnpinned accepted by the implementer: ${REASON}\n`,
		})
	})

	// joshuafolkken/kit#5188: a `tail` of the run:review or pre-detach answer keeps what to do.
	it('ends a stop on the counts line, the stop note and the full list path above it', () => {
		const summary = { text: 'LIST\n', counts: 'COUNTS', log: { path: 'LOG' }, unpinned: [SITE] }

		expect(run_review_pinned.verdict_of(summary, undefined).text).toBe(
			`LIST\n${run_review_pinned.STOP_NOTE}\nfull output: LOG\nCOUNTS\n`,
		)
	})

	it('stays clear when nothing is unpinned', () => {
		expect(run_review_pinned.verdict_of({ text: 'L\n', unpinned: [] }, undefined).kind).toBe(
			'clear',
		)
	})
})

describe('run_review_pinned.ok_reason_of', () => {
	it('reads the reason --unpinned-ok carries', () => {
		expect(run_review_pinned.ok_reason_of([run_review_pinned.UNPINNED_OK_FLAG, REASON])).toBe(
			REASON,
		)
	})

	it('refuses --unpinned-ok without a reason, with a blank one, or with more', () => {
		const flag = run_review_pinned.UNPINNED_OK_FLAG

		expect(run_review_pinned.ok_reason_of([flag])).toBeUndefined()
		expect(run_review_pinned.ok_reason_of([flag, ' '])).toBeUndefined()
		expect(run_review_pinned.ok_reason_of([flag, REASON, 'extra'])).toBeUndefined()
		expect(run_review_pinned.ok_reason_of(['--other', REASON])).toBeUndefined()
	})
})
