import type { Emit } from '#scripts/review/review-brief-cli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATE_GREEN, GATE_RED, GATE_RUNNING, run_review, type GateState } from './run-review'
import { run_review_cli } from './run-review-cli'

// joshuafolkken/kit#5938: round 1 read the tree before the gate, so a gate fix moved the diff and
// round 2 answered `required live` on code round 1 had already read. The brief, and the round-1
// snapshot it takes, now follow a green gate; a red gate writes none.

const { OPEN_WAIT_MS, order, brief_run, launch_gate, wait_gate, write_timing_start } = vi.hoisted(
	() => ({
		OPEN_WAIT_MS: 420_000,
		order: [] as Array<string>,
		brief_run: vi.fn<(argv: ReadonlyArray<string>, emit?: Emit) => Promise<number>>(),
		launch_gate: vi.fn(() => ({ kind: 'launched' })),
		wait_gate: vi.fn<(max_wait_ms?: number) => Promise<GateState>>(),
		write_timing_start: vi.fn(),
	}),
)

vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		remove_stamp: vi.fn(),
		stamp_path: (prefix: string) => `/stamps/${prefix}`,
		write_text_stamp: vi.fn(),
	},
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
vi.mock('#scripts/gate/metrics-totals', () => ({
	metrics_totals: { totals_refusal: async () => undefined },
}))
vi.mock('./run-review-unplanned', () => ({
	run_review_unplanned: { refusal: async () => undefined },
}))
vi.mock('./run-review-join-read', () => ({ run_review_join_read: { mark_due: vi.fn() } }))
vi.mock('./run-review-pinned-steps', () => ({
	run_review_pinned_steps: {
		launch: () => ({ kind: 'launched' }),
		clear: vi.fn(),
		is_answered: () => false,
	},
}))
vi.mock('./run-review-steps', () => ({
	run_review_steps: {
		MAX_OPEN_WAIT_MS: OPEN_WAIT_MS,
		launch_gate,
		mark_gate_starting: vi.fn(async () => {
			await Promise.resolve()
		}),
		read_gate_log: () => 'GATE LOG',
		wait_for_gate_finish: wait_gate,
		write_timing_start,
	},
}))

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const SETTLED = 'gate settled'
const BRIEF = 'brief'
const GATE_THEN_BRIEF = [SETTLED, BRIEF]
const output = { stdout: [] as Array<string> }

function settle_gate(state: GateState): void {
	wait_gate.mockImplementation(async () => {
		order.push(SETTLED)

		return state
	})
}

beforeEach(() => {
	order.length = 0
	output.stdout = []
	brief_run.mockReset().mockImplementation(async (_argv, emit) => {
		order.push(BRIEF)
		emit?.('BRIEF')

		return SUCCESS_EXIT_CODE
	})
	write_timing_start.mockReset()
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		output.stdout.push(String(chunk))

		return true
	})
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run:review opens round 1 after the gate', () => {
	it('writes the brief only once the gate has settled green', async () => {
		settle_gate(GATE_GREEN)

		expect(await run_review_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(order).toStrictEqual(GATE_THEN_BRIEF)
		expect(wait_gate).toHaveBeenCalledWith(OPEN_WAIT_MS)
	})

	it('writes the ship its brief after a green gate too, under --code-only', async () => {
		settle_gate(GATE_GREEN)

		expect(await run_review_cli.run([run_review.CODE_ONLY_FLAG])).toBe(SUCCESS_EXIT_CODE)
		expect(order).toStrictEqual(GATE_THEN_BRIEF)
	})

	it('writes no brief and exits non-zero on a red gate, printing its log', async () => {
		settle_gate(GATE_RED)

		expect(await run_review_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(brief_run).not.toHaveBeenCalled()
		expect(write_timing_start).not.toHaveBeenCalled()
		expect(output.stdout.join('')).toContain('GATE LOG')
		expect(output.stdout.join('')).toContain('Gate RED')
	})

	// A gate still running at the open's cap stops before run:chain's Bash budget kills the call.
	it('writes no brief on a gate still running at the cap, naming the re-run rather than red', async () => {
		settle_gate(GATE_RUNNING)

		expect(await run_review_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(brief_run).not.toHaveBeenCalled()
		expect(output.stdout.join('')).toContain('Gate still running')
		expect(output.stdout.join('')).not.toContain('Gate RED')
	})

	it('waits on no gate that could not be started', async () => {
		launch_gate.mockReturnValueOnce({ kind: 'failed' })

		expect(await run_review_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(wait_gate).not.toHaveBeenCalled()
		expect(brief_run).not.toHaveBeenCalled()
	})
})
