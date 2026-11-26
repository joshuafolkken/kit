import { gate_owner_watch } from '#scripts/gate/gate-owner-watch'
import { gate_skip } from '#scripts/gate/gate-skip'
import { metrics_totals } from '#scripts/gate/metrics-totals'
import { test_related_caller } from '#scripts/test/test-related-caller'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { LINT, TEST } = vi.hoisted(() => ({ LINT: 'lint:related', TEST: 'test:related' }))
const josh_run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: async () => ({ files: {}, base: 'base' }) },
}))
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: {
		LINT_SCRIPT: LINT,
		TEST_SCRIPT: TEST,
		missing_scripts: () => [LINT, TEST],
		record_green: vi.fn(),
		is_unmoved: () => true,
	},
}))
vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_ship_lap: vi.fn(), target: async () => 'lane-ledger.jsonl' },
}))
vi.mock(import('./run-ship-synced-scope'), async (import_original) => {
	const original = await import_original()

	return {
		run_ship_synced_scope: {
			...original.run_ship_synced_scope,
			read_sync: vi.fn(async () => undefined),
		},
	}
})

const { run_ship_scoped } = await import('./run-ship-scoped')
const { run_ship_pair_runs } = await import('./run-ship-pair-runs')
const { run_ship_narrowed } = await import('./run-ship-narrowed')
const { run_ship_lap } = await import('./run-ship-lap')
const { run_ship_gate_runs } = await import('./run-ship-gate-runs')

// joshuafolkken/kit#7965: each bare check of the scoped pair names the ship stage it runs within as
// its `test:related` caller, so the ledger row tells the ship's re-run from a hand-started one.

const STAGE = 'round-2'

beforeEach(() => {
	vi.spyOn(metrics_totals, 'rerecord').mockResolvedValue(false)
	josh_run_mock.mockReset().mockResolvedValue({ code: 0, out: '' })
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	run_ship_pair_runs.forget()
	run_ship_narrowed.forget()
})

describe('run_ship_scoped.scoped_pair — the caller', () => {
	it('hands each bare check the stage it runs within as its caller', async () => {
		await run_ship_lap.within('7965', STAGE, run_ship_scoped.scoped_pair)

		const expected = { [test_related_caller.CALLER_ENVIRONMENT]: `ship ${STAGE}` }

		expect(josh_run_mock.mock.calls.map((call) => call[1] as unknown)).toStrictEqual([
			{ should_forward_stderr: true, environment: expected },
			{ should_forward_stderr: true, environment: expected },
		])
	})
})

// joshuafolkken/kit#8845: ship reads its gate's verdict, so the gate it runs names ship as its owner.
describe('run_ship_scoped.scoped_gate — the gate owner', () => {
	it("names ship's own process as the gate's owner", async () => {
		vi.spyOn(gate_skip, 'reusable_green_gate').mockReturnValue(undefined)
		run_ship_gate_runs.forget()

		await run_ship_scoped.scoped_gate()

		const gate_call = josh_run_mock.mock.calls.at(-1)?.[1] as
			{ environment?: Record<string, string> } | undefined

		expect(gate_call?.environment).toHaveProperty(
			gate_owner_watch.OWNER_PID_KEY,
			String(process.pid),
		)
	})
})
