import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const stop_log_record = vi.hoisted(() => vi.fn())
const stamps = vi.hoisted(() => ({
	read_stamp_text: vi.fn(),
	remove_stamp: vi.fn(),
	stamp_path: vi.fn((prefix: string) => `stamps/${prefix}x`),
	write_text_stamp: vi.fn(),
}))

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({ stamp_file: stamps }))
vi.mock('#scripts/agent/agent-argv', () => ({
	agent_argv: {
		review_in: () => ({
			kind: 'argv',
			argv: { command: 'claude', args: [] },
			profile: {
				provider: 'anthropic',
				role: 'reviewer',
				model: 'claude-opus-5-5',
				effort: 'high',
			},
		}),
	},
}))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch_attached: async () => ({ kind: 'completed', pid: 1, exit_code: 0 }) },
}))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: vi.fn(async () => ({ files: {}, base: 'base' })) },
}))
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { missing_scripts: () => [] } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))
vi.mock('#scripts/review/review-record', () => ({
	review_record: { check: async () => ({ status: 'missing' }) },
}))
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: async () => undefined } }
})
vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_round_one: vi.fn(), record_round_two: vi.fn() },
}))
vi.mock('#scripts/review/review-stop-log', () => ({
	review_stop_log: { record: stop_log_record, read: () => [] },
}))

const { run_ship_review_steps } = await import('./run-ship-review-steps')

// joshuafolkken/kit#4780: no stop follows a round 1 that fixed its findings in place, so the round logs
// those findings to the stop log itself — marked fixed — for the next review stop to carry.

const ISSUE = '4780'
const OPEN = 'run:review --code-only'
const FIXED_MEDIUM = 'fixed bug-risks:medium:a.ts:7 — misses a null. More prose.'

beforeEach(() => {
	josh_run_mock.mockReset().mockImplementation(async (argv: ReadonlyArray<string>) => {
		const line = argv.join(' ')

		return { code: 0, out: line === OPEN ? 'medium\nbrief' : '' }
	})
	stamps.read_stamp_text.mockReset()
	stop_log_record.mockClear()
})

describe('run_ship_review_steps.review_stage — the stop log of a round-1 fix', () => {
	it('logs the fixed Medium of a passing round, marked fixed', async () => {
		stamps.read_stamp_text.mockReturnValue(FIXED_MEDIUM)

		expect(await run_ship_review_steps.review_stage(ISSUE, false)).toHaveProperty('code', 0)
		expect(stop_log_record).toHaveBeenCalledWith({
			issue: Number(ISSUE),
			stage: 'review',
			findings: [{ kind: 'bug-risks:medium', location: 'a.ts:7', sentence: 'misses a null.' }],
			is_fixed: true,
		})
	})

	it('logs no finding from a round that stops on one left unfixed', async () => {
		stamps.read_stamp_text.mockReturnValue(`${FIXED_MEDIUM}\ntests:medium:b.ts — no test.`)

		expect(await run_ship_review_steps.review_stage(ISSUE, false)).toHaveProperty(
			'cause',
			'finding',
		)
		expect(stop_log_record).toHaveBeenCalledWith(expect.objectContaining({ findings: [] }))
	})
})
