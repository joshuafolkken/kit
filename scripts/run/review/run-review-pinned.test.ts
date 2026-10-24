import type { PinnedReport } from '#scripts/test/test-pinned-logic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_cli } from './run-review-cli'
import { run_review_pinned } from './run-review-pinned'

// joshuafolkken/kit#4647: `josh run:review` runs `josh test:pinned` for round 1, and
// `--unpinned-ok "<reason>"` carries on with the reason printed after the brief for the reviewer.
// joshuafolkken/kit#4770: without a reason the check runs in the background, so the gate and the brief
// start without waiting on it; `--join` stops on its answer (`run-review-cli-join.test.ts`).

const { pinned_run, launch_gate, brief_run, launch_pinned, clear_pinned } = vi.hoisted(() => ({
	pinned_run: vi.fn<(max_hunks: number) => Promise<PinnedReport>>(),
	launch_gate: vi.fn<() => { kind: string; note?: string }>(),
	brief_run: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
	launch_pinned: vi.fn<() => { kind: string; note?: string }>(),
	clear_pinned: vi.fn(),
}))

vi.mock('#scripts/test/test-pinned', () => ({ test_pinned: { run: pinned_run } }))
vi.mock('./run-review-pinned-steps', () => ({
	run_review_pinned_steps: { launch: launch_pinned, clear: clear_pinned },
}))
vi.mock('#scripts/review/review-brief-cli', () => ({ review_brief_cli: { run: brief_run } }))
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

const FAILURE_EXIT_CODE = 1
const REASON = 'the branch only logs'
const UNPINNED = { file: 'a.ts', new_start: 4, new_count: 1, old_lines: [], is_green: true }
const PINNED_REPORT: PinnedReport = {
	unpinned: [],
	unchecked: [],
	unparsed: [],
	max_hunks: 20,
	has_runner: true,
}
const UNPINNED_REPORT: PinnedReport = { ...PINNED_REPORT, unpinned: [UNPINNED] }
const UNPINNED_LINE = 'unpinned a.ts:4 — reverting it left every related test green'

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
	brief_run.mockImplementation(async () => {
		process.stdout.write('BRIEF\n')

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
		expect(output.stdout.join('')).toBe('BRIEF\n')
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
		expect(output.stdout.join('')).toBe('BRIEF\n')
		expect(output.stderr.join('')).toContain('could not run, so nothing was checked: spawn refused')
	})

	it('carries on under --unpinned-ok and prints the list and the reason after the brief', async () => {
		pinned_run.mockResolvedValue(UNPINNED_REPORT)

		expect(await run_review_cli.run([run_review_pinned.UNPINNED_OK_FLAG, REASON])).toBe(0)
		expect(launch_gate).toHaveBeenCalledOnce()
		expect(launch_pinned).not.toHaveBeenCalled()
		expect(output.stdout.join('')).toBe(
			`BRIEF\nunpinned 1 · unchecked 0\n${UNPINNED_LINE}\n` +
				`Unpinned accepted by the implementer: ${REASON}\n`,
		)
	})
})

describe('run:review when no brief follows', () => {
	it('keeps the accepted list on stderr when the gate fails to start, so no brief follows', async () => {
		pinned_run.mockResolvedValue(UNPINNED_REPORT)
		launch_gate.mockReturnValue({ kind: 'failed', note: 'busy' })

		expect(await run_review_cli.run([run_review_pinned.UNPINNED_OK_FLAG, REASON])).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(output.stdout.join('')).toBe('')
		expect(output.stderr.join('')).toContain(`Unpinned accepted by the implementer: ${REASON}\n`)
	})

	it('carries on under --unpinned-ok when test:pinned itself cannot run', async () => {
		pinned_run.mockRejectedValue(new Error('worktree add failed'))

		expect(await run_review_cli.run([run_review_pinned.UNPINNED_OK_FLAG, REASON])).toBe(0)
		expect(launch_gate).toHaveBeenCalledOnce()
		expect(output.stdout.join('')).toBe('BRIEF\n')
		expect(output.stderr.join('')).toContain(
			'could not run, so nothing was checked: worktree add failed',
		)
	})

	it('names --unpinned-ok in the usage line it refuses --unpinned-ok without a reason with', async () => {
		expect(await run_review_cli.run([run_review_pinned.UNPINNED_OK_FLAG])).toBe(FAILURE_EXIT_CODE)
		expect(pinned_run).not.toHaveBeenCalled()
		expect(output.stderr.join('')).toBe(
			'Usage: josh run:review [--code-only] [--unpinned-ok "<reason>"] | --join\n',
		)
	})
})

describe('run_review_pinned.verdict_of — the answer the join reads', () => {
	it('stops on an unpinned change with the list and the stop note, without a reason', () => {
		const verdict = run_review_pinned.verdict_of({ text: 'LIST\n', unpinned_count: 1 }, undefined)

		expect(verdict).toStrictEqual({
			kind: 'stop',
			text: `LIST\n${run_review_pinned.STOP_NOTE}\n`,
		})
	})

	it('stays clear when nothing is unpinned', () => {
		expect(run_review_pinned.verdict_of({ text: 'L\n', unpinned_count: 0 }, undefined).kind).toBe(
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
