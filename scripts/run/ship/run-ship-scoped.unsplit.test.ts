import { metrics_totals } from '#scripts/gate/metrics-totals'
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
const { run_ship_synced_scope } = await import('./run-ship-synced-scope')
const { run_ship_lap } = await import('./run-ship-lap')
const { lane_ledger_write } = await import('#scripts/lane/lane-ledger-write')

// joshuafolkken/kit#6185: a merge the import graph could not split named every synced module — 2536
// files in one ship. It now names nothing, runs the pair as before and logs why.

const FAILURE = 'no import graph could be built'
const UNSPLIT = run_ship_synced_scope.unsplit_line(FAILURE)
const NAMED_FILE = 'scripts/run/ship/run-ship-scoped.ts'

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

beforeEach(() => {
	vi.spyOn(metrics_totals, 'rerecord').mockResolvedValue(false)
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
			unsplit: FAILURE,
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

// joshuafolkken/kit#6196: `lane:stats --pairs` reads the named-file count and the split failure off the lap.
const PAIR_STEP = 'scoped pair'

function lap(): unknown {
	return vi.mocked(lane_ledger_write.record_ship_lap).mock.calls[0]?.[0]
}

describe('run_ship_scoped.scoped_pair — the lap of a merge-scoped pair', () => {
	beforeEach(() => {
		vi.mocked(lane_ledger_write.record_ship_lap).mockClear()
	})

	it('records how many files a named run was narrowed to', async () => {
		read_sync_mock.mockResolvedValue({ checks: [], synced: [NAMED_FILE], overlap: [NAMED_FILE] })

		await run_ship_lap.within('6196', 'gate', run_ship_scoped.scoped_pair)

		expect(commands()).toStrictEqual([`${LINT} ${NAMED_FILE}`, `${TEST} ${NAMED_FILE}`])
		expect(lap()).toMatchObject({ step: PAIR_STEP, named: 1 })
		expect(lap()).not.toHaveProperty('unsplit')
	})

	it('records how many files moved since the pair was last green on this base', async () => {
		read_sync_mock.mockResolvedValue(undefined)
		run_ship_narrowed.remember({ files: { [NAMED_FILE]: 'before' }, base: 'base' })

		await run_ship_lap.within('6196', 'gate', run_ship_scoped.scoped_pair)

		expect(commands()).toStrictEqual([`${LINT} ${NAMED_FILE}`, `${TEST} ${NAMED_FILE}`])
		expect(lap()).toMatchObject({ step: PAIR_STEP, named: 1 })
	})

	it('records the failure of a merge the import graph could not split', async () => {
		read_sync_mock.mockResolvedValue({
			checks: [],
			synced: ['a.ts'],
			overlap: undefined,
			unsplit: FAILURE,
		})

		await run_ship_lap.within('6196', 'gate', run_ship_scoped.scoped_pair)

		expect(lap()).toMatchObject({ step: PAIR_STEP, unsplit: FAILURE })
		expect(lap()).not.toHaveProperty('named')
	})
})

// joshuafolkken/kit#7052: lint's meeting handed to test:related ran every importer of main's modules.
describe('run_ship_scoped.scoped_pair — each check over its own part of a merge', () => {
	it('names test:related over its own part and lint:related over the overlap alone', async () => {
		const meeting = 'scripts/run/ship/run-ship-narrowed.ts'

		read_sync_mock.mockResolvedValue({
			checks: [],
			synced: [meeting],
			overlap: [meeting],
			test_overlap: [NAMED_FILE],
		})

		await run_ship_scoped.scoped_pair()

		expect(commands()).toStrictEqual([`${LINT} ${meeting}`, `${TEST} ${NAMED_FILE}`])
	})

	it('runs the pair bare when test:related’s own part cannot be named', async () => {
		read_sync_mock.mockResolvedValue({
			checks: [],
			synced: [NAMED_FILE],
			overlap: [NAMED_FILE],
			test_overlap: ['scripts/run/ship/no-such-file.ts'],
		})

		await run_ship_scoped.scoped_pair()

		expect(commands()).toStrictEqual([LINT, TEST])
	})
})
