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
const MEETING_FILE = 'scripts/run/ship/run-ship-narrowed.ts'

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
		// joshuafolkken/kit#7846: a pair named with no merge read kept no per-check count (ac-c5893692).
		expect(lap()).toMatchObject({ named: 1, breakdown: { lint_named: 1, test_named: 1 } })
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

// joshuafolkken/kit#7788: which condition named a pair of 901 files over a 25-file branch.
describe('run_ship_scoped.scoped_pair — what each condition named', () => {
	beforeEach(() => {
		vi.mocked(lane_ledger_write.record_ship_lap).mockClear()
	})

	it('logs and laps what each condition named (ac-10542962, ac-490219c5)', async () => {
		const breakdown = { both: 1, unsplit: 0, read_by_tests: 0, shared: 3, lint_meeting: 1 }

		read_sync_mock.mockResolvedValue({
			checks: [],
			synced: [NAMED_FILE],
			overlap: [NAMED_FILE],
			breakdown,
		})

		await run_ship_lap.within('7788', 'sync', run_ship_scoped.scoped_pair)

		expect(process.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining(
				'both 1, unsplit 0, read_by_tests 0, shared 3, lint_meeting 1, lint_named 1, test_named 1.',
			),
		)
		expect(lap()).toMatchObject({
			step: PAIR_STEP,
			named: 1,
			breakdown: { ...breakdown, lint_named: 1, test_named: 1 },
		})
	})
})

// joshuafolkken/kit#7846: `named` is the union of both checks' files, which hid what each ran over.
describe('run_ship_scoped.scoped_pair — the files each check was handed', () => {
	beforeEach(() => {
		vi.mocked(lane_ledger_write.record_ship_lap).mockClear()
	})

	it('laps each check its own part of a merge (ac-c5893692)', async () => {
		read_sync_mock.mockResolvedValue({
			checks: [],
			synced: [MEETING_FILE],
			overlap: [MEETING_FILE],
			test_overlap: [NAMED_FILE, MEETING_FILE],
			breakdown: { shared: 1 },
		})

		await run_ship_lap.within('7846', 'sync', run_ship_scoped.scoped_pair)

		expect(lap()).toMatchObject({
			named: 2,
			breakdown: { shared: 1, lint_named: 1, test_named: 2 },
		})
	})
})

// joshuafolkken/kit#7052: lint's meeting handed to test:related ran every importer of main's modules.
describe('run_ship_scoped.scoped_pair — each check over its own part of a merge', () => {
	it('names test:related over its own part and lint:related over the overlap alone', async () => {
		read_sync_mock.mockResolvedValue({
			checks: [],
			synced: [MEETING_FILE],
			overlap: [MEETING_FILE],
			test_overlap: [NAMED_FILE],
		})

		await run_ship_scoped.scoped_pair()

		expect(commands()).toStrictEqual([`${LINT} ${MEETING_FILE}`, `${TEST} ${NAMED_FILE}`])
	})

	// joshuafolkken/kit#7788: a test reaching both sides through others is no file lint reads.
	it('runs test:related alone when lint:related has no file where the two meet', async () => {
		read_sync_mock.mockResolvedValue({
			checks: [],
			synced: [NAMED_FILE],
			overlap: [],
			test_overlap: [NAMED_FILE],
		})

		await run_ship_scoped.scoped_pair()

		expect(commands()).toStrictEqual([`${TEST} ${NAMED_FILE}`])
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
