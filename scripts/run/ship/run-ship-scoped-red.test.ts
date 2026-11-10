import { beforeEach, describe, expect, it, vi } from 'vitest'

const { LINT, TEST } = vi.hoisted(() => ({ LINT: 'lint:related', TEST: 'test:related' }))
const josh_run_mock = vi.hoisted(() => vi.fn())
const unmoved_mock = vi.hoisted(() => vi.fn(() => true))

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: {
		read_gate_tree: async () => ({ files: { 'scripts/a.ts': 'digest' }, base: 'base' }),
	},
}))
vi.mock('#scripts/gate/metrics-totals', () => ({ metrics_totals: { rerecord: async () => false } }))
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: {
		LINT_SCRIPT: LINT,
		TEST_SCRIPT: TEST,
		missing_scripts: () => [LINT, TEST],
		record_green: vi.fn(),
		is_unmoved: unmoved_mock,
	},
}))
vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: {
		record_ship_lap: vi.fn(async () => undefined),
		target: async () => 'ledger',
	},
}))
vi.mock(import('./run-ship-synced-scope'), async (import_original) => {
	const original = await import_original()

	return {
		run_ship_synced_scope: {
			...original.run_ship_synced_scope,
			settle: () => undefined,
			read_sync: async () => undefined,
		},
	}
})

const { run_ship_scoped } = await import('./run-ship-scoped')
const { run_ship_narrowed } = await import('./run-ship-narrowed')
const { run_ship_pair_runs } = await import('./run-ship-pair-runs')

// joshuafolkken/kit#7053: round 2 beside the gate stage queued behind the gate's red pair and ran both
// checks again on the same tree before the ship stopped on the same red.

const OK = 0
const FAILED = 1

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	unmoved_mock.mockReset().mockReturnValue(true)
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	run_ship_narrowed.forget()
	run_ship_pair_runs.forget()
})

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map(([args]) => (args as Array<string>).join(' '))
}

describe('run_ship_scoped.scoped_pair — after a red pair', () => {
	it('answers a pair queued behind a red one on the unmoved tree with that red, running nothing', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'red' })

		const [gate, round_two] = await Promise.all([
			run_ship_scoped.scoped_pair(),
			run_ship_scoped.scoped_pair(),
		])

		expect(gate).toStrictEqual({ code: FAILED, out: 'red' })
		expect(round_two).toStrictEqual({ code: FAILED, out: 'red' })
		expect(commands()).toStrictEqual([LINT])
	})

	it('runs a pair queued behind a red one again once the tree moved', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'red' })
		unmoved_mock.mockReturnValue(false)

		const [, fixed] = await Promise.all([
			run_ship_scoped.scoped_pair(),
			run_ship_scoped.scoped_pair(),
		])

		expect(fixed.code).toBe(OK)
		expect(commands()).toStrictEqual([LINT, LINT, TEST])
	})

	it('runs a pair that joined the queue after the red one ended afresh, so a flaky red gets a second run', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'red' })

		await run_ship_scoped.scoped_pair()
		const later = await run_ship_scoped.scoped_pair()

		expect(later.code).toBe(OK)
		expect(commands()).toStrictEqual([LINT, LINT, TEST])
	})
})
