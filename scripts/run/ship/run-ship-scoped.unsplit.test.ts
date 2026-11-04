import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncReading } from './run-ship-synced-scope'

const { LINT, TEST } = vi.hoisted(() => ({ LINT: 'lint:related', TEST: 'test:related' }))
const josh_run_mock = vi.hoisted(() => vi.fn())
const read_sync_mock = vi.hoisted(() =>
	vi.fn(async (): Promise<SyncReading | undefined> => undefined),
)

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: async () => ({ files: {}, base: 'base' }) },
}))
vi.mock('#scripts/gate/metrics-totals', () => ({ metrics_totals: { rerecord: async () => false } }))
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
		run_ship_synced_scope: { ...original.run_ship_synced_scope, read_sync: read_sync_mock },
	}
})

const { run_ship_scoped } = await import('./run-ship-scoped')
const { run_ship_pair_runs } = await import('./run-ship-pair-runs')
const { run_ship_narrowed } = await import('./run-ship-narrowed')

// joshuafolkken/kit#6185: a merge the import graph could not split named every synced module — 2536
// files in one ship. It now names nothing, runs the pair as before and logs why.

const UNSPLIT = 'scoped pair: the import graph could not split the merge (no import graph).'

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: 0, out: '' })
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	run_ship_pair_runs.forget()
	run_ship_narrowed.forget()
})

describe('run_ship_scoped.scoped_pair — a merge the import graph could not split', () => {
	it('runs the stale checks bare and logs why the merge named nothing', async () => {
		read_sync_mock.mockResolvedValue({
			checks: [],
			synced: ['a.ts'],
			overlap: undefined,
			unsplit: UNSPLIT,
		})

		await run_ship_scoped.scoped_pair()

		expect(commands()).toStrictEqual([LINT, TEST])
		expect(process.stdout.write).toHaveBeenCalledWith(`${UNSPLIT}\n`)
	})

	it('logs no such line where no merge was read', async () => {
		read_sync_mock.mockResolvedValue(undefined)

		await run_ship_scoped.scoped_pair()

		expect(commands()).toStrictEqual([LINT, TEST])
		expect(process.stdout.write).not.toHaveBeenCalledWith(`${UNSPLIT}\n`)
	})
})
