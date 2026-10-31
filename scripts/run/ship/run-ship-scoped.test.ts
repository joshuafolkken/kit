import type { GateTree } from '#scripts/gate/gate-tree'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncReading } from './run-ship-synced-scope'

const { LINT, TEST } = vi.hoisted(() => ({ LINT: 'lint:related', TEST: 'test:related' }))
const josh_run_mock = vi.hoisted(() => vi.fn())
const missing_mock = vi.hoisted(() => vi.fn<() => Array<string>>())
const reusable_mock = vi.hoisted(() => vi.fn<() => object | undefined>())
const rerecord_mock = vi.hoisted(() => vi.fn(async () => false))
const settle_mock = vi.hoisted(() => vi.fn((): string | undefined => undefined))
const read_sync_mock = vi.hoisted(() =>
	vi.fn(async (): Promise<SyncReading | undefined> => undefined),
)
const record_mock = vi.hoisted(() => vi.fn())
const unmoved_mock = vi.hoisted(() =>
	vi.fn<(before: GateTree, after: GateTree) => boolean>(() => true),
)
const lap_mock = vi.hoisted(() =>
	vi.fn<(lap: object) => Promise<void>>(async () => {
		await Promise.resolve()
	}),
)
const LEDGER = vi.hoisted(() => 'lane-ledger.jsonl')
const reused_ledger_mock = vi.hoisted(() =>
	vi.fn(async () => {
		await Promise.resolve()
	}),
)
const read_tree_mock = vi.hoisted(() =>
	vi.fn(async (): Promise<{ files: Record<string, string>; base: string }> => ({
		files: {},
		base: 'base',
	})),
)

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: read_tree_mock } }))
vi.mock('#scripts/gate/metrics-totals', () => ({ metrics_totals: { rerecord: rerecord_mock } }))
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: {
		LINT_SCRIPT: LINT,
		TEST_SCRIPT: TEST,
		missing_scripts: missing_mock,
		record_green: record_mock,
		is_unmoved: unmoved_mock,
	},
}))
vi.mock('#scripts/gate/gate-skip', () => ({ gate_skip: { reusable_green_gate: reusable_mock } }))
vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_ship_lap: lap_mock, target: async () => LEDGER },
}))
vi.mock('#scripts/gate/gate-ledger', () => ({ gate_ledger: { record_reused: reused_ledger_mock } }))
vi.mock(import('./run-ship-synced-scope'), async (import_original) => {
	const original = await import_original()

	return {
		run_ship_synced_scope: {
			...original.run_ship_synced_scope,
			settle: settle_mock,
			read_sync: read_sync_mock,
		},
	}
})

const { run_ship_scoped } = await import('./run-ship-scoped')
const { run_ship_narrowed } = await import('./run-ship-narrowed')
const { run_ship_lap } = await import('./run-ship-lap')
const { run_ship_pair_runs } = await import('./run-ship-pair-runs')
const { run_ship_gate_runs } = await import('./run-ship-gate-runs')

// joshuafolkken/kit#2946: the scoped pair the preflight, the review rounds and the gate stage all meet
// rather than stop on — only the checks with no green record for this tree run.

const OK = 0
const FAILED = 1
const PAIR_SIZE = 2
// A file on disk, so the narrowed run can name it.
const MOVED = 'scripts/run/ship/run-ship-scoped.ts'

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

function forget_ship_memory(): void {
	run_ship_narrowed.forget()
	run_ship_pair_runs.forget()
	run_ship_gate_runs.forget()
	lap_mock.mockClear()
	reused_ledger_mock.mockClear()
	reusable_mock.mockReset().mockReturnValue(undefined)
}

function gate_laps(): ReadonlyArray<object> {
	return lap_mock.mock.calls
		.map(([lap]) => lap)
		.filter((lap) => (lap as { step: string }).step === run_ship_lap.STEP.GATE)
}

// What a check that ran green leaves: a record for the tree, so a later pair finds nothing stale.
function stale_until_run(): Array<string> {
	return josh_run_mock.mock.calls.length === 0 ? [LINT, TEST] : []
}

async function side_by_side(): Promise<void> {
	await Promise.all([
		run_ship_lap.within('5538', 'gate', run_ship_scoped.scoped_pair),
		run_ship_lap.within('5538', 'round-2', run_ship_scoped.scoped_pair),
	])
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	missing_mock.mockReset().mockReturnValue([])
	rerecord_mock.mockClear()
	read_tree_mock.mockReset()
	settle_mock.mockReset().mockReturnValue(undefined)
	read_sync_mock.mockReset().mockResolvedValue(undefined)
	record_mock.mockReset()
	unmoved_mock.mockReset().mockReturnValue(true)
	forget_ship_memory()
})

// joshuafolkken/kit#5538: round 2 beside the gate stage met the pair on one tree at once, so both ran
// it; one at a time, the later pair reads the earlier one's records.
describe('run_ship_scoped.scoped_pair — two stages side by side', () => {
	it('runs the pair once when the tree did not move', async () => {
		missing_mock.mockImplementation(stale_until_run)

		await side_by_side()

		expect(commands()).toStrictEqual([LINT, TEST])
		expect(lap_mock.mock.calls.map((call) => call[0])).not.toContainEqual(
			expect.objectContaining({ rerun: expect.any(String) as string }),
		)
	})

	it('runs it again only when the tree moved, and records why on the lap', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		unmoved_mock.mockReturnValue(false)

		await side_by_side()

		expect(commands()).toStrictEqual([LINT, TEST, LINT, TEST])
		expect(lap_mock.mock.calls.map((call) => call[0])).toMatchObject([
			{ stage: 'gate', runs: 1 },
			{ stage: 'round-2', runs: 2, rerun: run_ship_pair_runs.REASON.MOVED },
		])
	})

	it('reads a rerun against the tree a pair that ran nothing last met', async () => {
		missing_mock.mockReturnValueOnce([LINT]).mockReturnValueOnce([]).mockReturnValue([LINT])
		unmoved_mock.mockImplementation((before, after) => before.base === after.base)
		read_tree_mock
			.mockResolvedValueOnce({ files: {}, base: 'first' })
			.mockResolvedValueOnce({ files: {}, base: 'first' })
			.mockResolvedValue({ files: {}, base: 'moved' })

		for (const stage of ['gate', 'sync', 'round-2']) {
			// eslint-disable-next-line no-await-in-loop -- each pair meets the tree the one before it left
			await run_ship_lap.within('5538', stage, run_ship_scoped.scoped_pair)
		}

		expect(lap_mock.mock.calls.at(-1)?.[0]).toMatchObject({
			runs: 2,
			rerun: run_ship_pair_runs.REASON.NO_RECORD,
		})
	})
})

// joshuafolkken/kit#4985: a pair stale only because a merge moved the base, over files that share
// nothing with the branch, runs nothing and says why.
describe('run_ship_scoped.scoped_pair — after a merge with the default branch', () => {
	const SETTLED = 'scoped pair: lint:related and test:related not re-run — no overlap.'
	const READING = { checks: [], synced: [MOVED], overlap: [MOVED] }

	it('runs neither check when the merge shares nothing with the branch', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		missing_mock.mockReturnValue([LINT, TEST])
		read_sync_mock.mockResolvedValue(READING)
		settle_mock.mockReturnValue(SETTLED)

		expect(await run_ship_scoped.scoped_pair()).toStrictEqual({ code: OK, out: SETTLED })
		expect(commands()).toStrictEqual([])
		expect(write).toHaveBeenCalledWith(`${SETTLED}\n`)
		expect(settle_mock).toHaveBeenCalledWith(READING, { files: {}, base: 'base' })
		write.mockRestore()
	})

	// joshuafolkken/kit#5531: the commit stage's merge meeting the branch in one file.
	it('runs each stale check over the one file the merge meets the branch in, then records them', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		read_sync_mock.mockResolvedValue(READING)

		await run_ship_scoped.scoped_pair()

		expect(commands()).toStrictEqual([`${LINT} ${MOVED}`, `${TEST} ${MOVED}`])
		expect(record_mock).toHaveBeenCalledTimes(PAIR_SIZE)
	})

	it('runs the stale checks bare when the stale records moved by more than a merge', async () => {
		missing_mock.mockReturnValue([LINT, TEST])

		await run_ship_scoped.scoped_pair()

		expect(commands()).toStrictEqual([LINT, TEST])
	})
})

// joshuafolkken/kit#5531: a review round's fix after the pair was green in this ship.
describe('run_ship_scoped.scoped_pair — after a fix to a tree this ship met green', () => {
	it('runs each stale check over the one file the fix moved', async () => {
		await run_ship_scoped.scoped_pair()
		read_tree_mock.mockResolvedValueOnce({
			files: Object.fromEntries([[MOVED, 'fixed']]),
			base: 'base',
		})
		missing_mock.mockReturnValue([LINT, TEST])

		await run_ship_scoped.scoped_pair()

		expect(commands()).toStrictEqual([`${LINT} ${MOVED}`, `${TEST} ${MOVED}`])
	})

	it('records nothing green when the tree moved while the named checks ran', async () => {
		await run_ship_scoped.scoped_pair()
		read_tree_mock.mockResolvedValueOnce({
			files: Object.fromEntries([[MOVED, 'fixed']]),
			base: 'base',
		})
		missing_mock.mockReturnValue([LINT, TEST])
		unmoved_mock.mockReturnValue(false)

		await run_ship_scoped.scoped_pair()

		expect(record_mock).not.toHaveBeenCalled()
	})

	it('runs the stale checks bare when a merge moved the base since', async () => {
		await run_ship_scoped.scoped_pair()
		read_tree_mock.mockResolvedValueOnce({
			files: Object.fromEntries([[MOVED, 'fixed']]),
			base: 'other',
		})
		missing_mock.mockReturnValue([LINT, TEST])

		await run_ship_scoped.scoped_pair()

		expect(commands()).toStrictEqual([LINT, TEST])
	})
})

// joshuafolkken/kit#5531: why a bare check read the whole branch, in the scoped pair's lap.
describe('run_ship_scoped.scoped_pair — the lap', () => {
	it('records each fallback reason the bare checks printed', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		josh_run_mock
			.mockResolvedValueOnce({
				code: OK,
				out: 'josh lint:related: whole branch — since-green fell back: no-record.',
			})
			.mockResolvedValueOnce({
				code: OK,
				out: 'test:unit: whole branch — since-green fell back: hub.',
			})

		await run_ship_lap.within('5531', 'round-2', run_ship_scoped.scoped_pair)

		expect(lap_mock.mock.calls[0]?.[0]).toMatchObject({
			step: 'scoped pair',
			fallback: 'no-record, hub',
		})
	})

	it('records no fallback when every check narrowed', async () => {
		await run_ship_lap.within('5531', 'round-2', run_ship_scoped.scoped_pair)

		expect(lap_mock.mock.calls[0]?.[0]).not.toHaveProperty('fallback')
	})
})

describe('run_ship_scoped.scoped_pair', () => {
	it('runs nothing when both checks are already green on this tree', async () => {
		expect(await run_ship_scoped.scoped_pair()).toStrictEqual({ code: OK, out: '' })
		expect(commands()).toStrictEqual([])
	})

	it('runs only the checks not yet green, then passes', async () => {
		missing_mock.mockReturnValue([LINT, TEST])

		expect(await run_ship_scoped.scoped_pair()).toStrictEqual({ code: OK, out: '' })
		expect(commands()).toStrictEqual([LINT, TEST])
	})

	it('stops at the first red check', async () => {
		missing_mock.mockReturnValue([LINT, TEST])
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		expect(await run_ship_scoped.scoped_pair()).toStrictEqual({ code: FAILED, out: 'lint red' })
		expect(commands()).toStrictEqual([LINT])
	})

	// joshuafolkken/kit#4716: a review fix's re-grown total is re-recorded before the pair reads the tree.
	it('asks for the re-record with the tree it read', async () => {
		await run_ship_scoped.scoped_pair()

		expect(rerecord_mock).toHaveBeenCalledWith(process.cwd(), {})
		expect(read_tree_mock).toHaveBeenCalledOnce()
	})

	it('reads the tree again after a re-record and asks the pair about that tree', async () => {
		const files = Object.fromEntries([['.josh/metrics-accepted/4716.json', 'new']])

		rerecord_mock.mockResolvedValueOnce(true)
		read_tree_mock.mockResolvedValueOnce({ files: {}, base: 'base' })
		read_tree_mock.mockResolvedValueOnce({ files, base: 'base' })

		await run_ship_scoped.scoped_pair()

		expect(missing_mock).toHaveBeenCalledWith(files, 'base')
	})
})

describe('run_ship_scoped.scoped_gate', () => {
	it('runs the missing scoped checks and then josh gate, forwarding stderr', async () => {
		missing_mock.mockReturnValue([LINT])

		expect(await run_ship_scoped.scoped_gate()).toStrictEqual({ code: OK, out: '' })
		expect(commands()).toStrictEqual([LINT, 'gate'])
		expect(josh_run_mock).toHaveBeenLastCalledWith(['gate'], true)
	})

	it('stops before josh gate when the scoped pair fails', async () => {
		missing_mock.mockReturnValue([LINT])
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		expect(await run_ship_scoped.scoped_gate()).toStrictEqual({ code: FAILED, out: 'lint red' })
		expect(commands()).toStrictEqual([LINT])
	})
})

// joshuafolkken/kit#5567: a tree the gate would only reuse starts no gate, and a gate that runs names why.
describe('run_ship_scoped.scoped_gate — reuse and reruns', () => {
	it('starts no josh gate in the commit stage on the tree the gate stage left green', async () => {
		await run_ship_lap.within('5567', 'gate', run_ship_scoped.scoped_gate)
		reusable_mock.mockReturnValue({})
		await run_ship_lap.within('5567', 'commit', run_ship_scoped.scoped_gate)

		const hash = run_ship_gate_runs.tree_hash({ files: {}, base: 'base' })

		expect(commands()).toStrictEqual(['gate'])
		expect(gate_laps()).toMatchObject([
			{ stage: 'gate', rerun: 'no-record' },
			{ stage: 'commit', reused_tree: hash },
		])
		expect(reused_ledger_mock).toHaveBeenCalledExactlyOnceWith(LEDGER, 0)
	})

	it('runs josh gate again once a merge moved the base, and names the merge on the lap', async () => {
		await run_ship_lap.within('5567', 'gate', run_ship_scoped.scoped_gate)
		read_tree_mock.mockResolvedValue({ files: {}, base: 'merged' })
		await run_ship_lap.within('5567', 'commit', run_ship_scoped.scoped_gate)

		expect(commands()).toStrictEqual(['gate', 'gate'])
		expect(gate_laps()).toMatchObject([{ stage: 'gate' }, { stage: 'commit', rerun: 'merge' }])
	})
})

// joshuafolkken/kit#3643: the gate's own reuse test decides whether a gate stage only reused a record.
describe('run_ship_scoped.is_gate_green', () => {
	it('is green when the gate holds a reusable record for this tree', async () => {
		reusable_mock.mockReturnValue({})

		expect(await run_ship_scoped.is_gate_green()).toBe(true)
		expect(reusable_mock).toHaveBeenCalledWith({}, 'base')
	})

	it('is not green when no record matches the tree', async () => {
		reusable_mock.mockReturnValue(undefined)

		expect(await run_ship_scoped.is_gate_green()).toBe(false)
	})
})
