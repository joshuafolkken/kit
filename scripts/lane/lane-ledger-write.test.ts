import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'

// joshuafolkken/kit#3355: recording into the lane-limit measurement ledger never raises into the gate
// or merge being measured, and each kind reads back through `lane-ledger.ts`.

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-ledger-write-test-'))
const AT = '2026-10-06T00:00:00.000Z'
const GATE_MS = 90_000

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function ledger(name: string): string {
	return path.join(scratch, `${name}.jsonl`)
}

describe('lane_ledger_write.record', () => {
	it('swallows a failed append', async () => {
		const unwritable = path.join(scratch, 'missing-directory', 'ledger.jsonl')

		await expect(
			lane_ledger_write.record({ kind: 'merge', at: AT, issue: 4 }, unwritable),
		).resolves.toBeUndefined()
	})

	it('records a gate with its elapsed time and verdict', async () => {
		const target = ledger('gate')

		await lane_ledger_write.record_gate(target, { elapsed_ms: GATE_MS, is_passed: false })

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'gate', elapsed_ms: GATE_MS, is_passed: false },
		])
	})

	// joshuafolkken/kit#3501: the external load a gate ran beside is read back with its duration.
	it('records the external cores a gate ran beside', async () => {
		const target = ledger('gate-external')

		await lane_ledger_write.record_gate(target, {
			elapsed_ms: GATE_MS,
			is_passed: true,
			external_cores: 3,
		})

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'gate', external_cores: 3 }])
	})
})

// joshuafolkken/kit#3643: a lane's dispatch and each finished stage are entries of their own, so
// `lane:stats` can say where a lane's time went.
describe('lane_ledger_write — the stage and dispatch entries', () => {
	it('records a finished stage with its issue and its duration', async () => {
		const target = ledger('stage')

		await lane_ledger_write.record_stage({ stage: 'review', elapsed_ms: GATE_MS, issue: 7 }, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'stage', stage: 'review', elapsed_ms: GATE_MS, issue: 7 },
		])
	})

	it('records a stage whose writer holds no issue', async () => {
		const target = ledger('stage-no-issue')
		const stage = lane_ledger_write.CI_WAIT_STAGE

		await lane_ledger_write.record_stage({ stage, elapsed_ms: GATE_MS }, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'stage', stage }])
	})

	it('records a dispatch naming the issue', async () => {
		const target = ledger('dispatch')

		await lane_ledger_write.record_dispatch(7, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'dispatch', issue: 7 }])
	})

	// joshuafolkken/kit#3789: a stopped ship is an entry of its own, so `lane:stats` can time the wait.
	it('records a stopped ship naming the issue and the stop reason', async () => {
		const target = ledger('stop')

		await lane_ledger_write.record_stop({ issue: 7, reason: 'conflict', cause: 'conflict' }, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'stop', issue: 7, reason: 'conflict', cause: 'conflict' },
		])
	})

	// joshuafolkken/kit#3901: a ship's wait for an overlapping open pull request is recorded with what
	// overlapped and how it ended, beside the `conflict` stops it exists to reduce.
	it('records an overlap wait naming the lanes, the shared paths and whether it cleared', async () => {
		const target = ledger('overlap')
		const overlap = { issue: 7, lanes: [8], paths: ['a.ts'], waited_ms: 30_000, is_cleared: true }

		await lane_ledger_write.record_overlap(overlap, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'overlap', ...overlap }])
	})
})

// joshuafolkken/kit#3995: a free lane the driver left empty is recorded with why.
// joshuafolkken/kit#4166: a preflight stop keeps the kinds of the preconditions it found unmet.
describe('lane_ledger_write.record_stop — the unmet preconditions', () => {
	it('keeps the unmet preconditions of a preflight stop', async () => {
		const target = ledger('stop-preconditions')
		const stop = { issue: 7, reason: 'preflight', cause: 'check', preconditions: ['lock', 'issue'] }

		await lane_ledger_write.record_stop(stop, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'stop', ...stop }])
	})
})

describe('lane_ledger_write.record_held', () => {
	it('records a dispatch hold naming its reason', async () => {
		const target = ledger('held')
		const reason = 'offer:wait:blocked'

		await lane_ledger_write.record_held({ reason }, target)

		const entries = lane_ledger.read_entries(target)

		expect(entries).toMatchObject([{ kind: 'held', reason }])
		expect(entries[0]).not.toHaveProperty('waiting')
	})

	// joshuafolkken/kit#4513: the issues a blocked wait waited on read back with the hold.
	it('records the issues a hold waited on, read back as its waiting list', async () => {
		const target = ledger('held-waiting')
		const held = { reason: 'offer:watch:chain', waiting: [4496, 4497] }

		await lane_ledger_write.record_held(held, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'held', ...held }])
	})

	it('records the release that ends a hold without a dispatch', async () => {
		const target = ledger('released')

		await lane_ledger_write.record_released(target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'released' }])
	})
})

// joshuafolkken/kit#4382: a claim's wait for the core budget reads back as one entry.
describe('lane_ledger_write.record_core_wait', () => {
	it('writes the command, the wait and the lane, read back as a core-wait entry', async () => {
		const target = ledger('core-wait')
		const wait = { command: 'lint', waited_ms: 500, issue: 4382 }

		await lane_ledger_write.record_core_wait(wait, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'core-wait', ...wait }])
	})
})

// joshuafolkken/kit#5203: the `unplanned` answer `check:related` printed reads back as one entry.
describe('lane_ledger_write.record_unplanned_notice', () => {
	it('writes the issue and its unplanned files, read back as an unplanned-notice entry', async () => {
		const target = ledger(lane_ledger_write.KIND.UNPLANNED_NOTICE)
		const notice = { issue: 5168, files: ['scripts/lane/lane-ledger.ts'] }

		await lane_ledger_write.record_unplanned_notice(notice, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'unplanned-notice', ...notice },
		])
	})
})

// joshuafolkken/kit#4451: a unit run's slowest files read back as one entry.
describe('lane_ledger_write.record_unit_files', () => {
	it('writes each file and its wall time, read back as a unit-files entry', async () => {
		const target = ledger(lane_ledger_write.KIND.UNIT_FILES)
		const files = [{ file: 'scripts/stalled.test.ts', elapsed_ms: 370_000 }]

		await lane_ledger_write.record_unit_files(files, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: lane_ledger_write.KIND.UNIT_FILES, files },
		])
	})
})

// joshuafolkken/kit#4465: one `josh test:related` run's input counts and test files read back.
describe('lane_ledger_write.record_test_related', () => {
	it('writes the scope, the input counts, the test files and the time, read back as one entry', async () => {
		const target = ledger(lane_ledger_write.KIND.TEST_RELATED)
		const run = {
			scope: 'related',
			changed: 3,
			synced: 40,
			since_map: 5,
			readers: 2,
			test_files: 12,
			elapsed_ms: 900,
		}

		await lane_ledger_write.record_test_related(run, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: lane_ledger_write.KIND.TEST_RELATED, ...run },
		])
	})
})

// joshuafolkken/kit#4695: the split notice a lane got, and the split child it filed, read back.
describe('lane_ledger_write — the split notice and the split child', () => {
	it('records the notice with its counts and the child with the lane it was filed from', async () => {
		const target = ledger('split')

		await lane_ledger_write.record_split_notice({ issue: 4695, files: 11, lines: 550 }, target)
		await lane_ledger_write.record_split_filed({ issue: 4695, child: '#4700' }, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: lane_ledger_write.KIND.SPLIT_NOTICE, issue: 4695, files: 11, lines: 550 },
			{ kind: lane_ledger_write.KIND.SPLIT_FILED, issue: 4695, child: '#4700' },
		])
	})
})

describe('lane_ledger_write.record_offerable', () => {
	it('records whether offerable work and a free lane coexist', async () => {
		const target = ledger('offerable')

		await lane_ledger_write.record_offerable(true, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'offerable', is_offerable: true },
		])
	})
})

describe('lane_ledger_write.target', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('answers no ledger outside a repository instead of rejecting', async () => {
		vi.stubEnv('VITEST', undefined)
		vi.spyOn(run_carry, 'repository_directory').mockRejectedValue(
			new Error('fatal: not a git repository'),
		)

		await expect(lane_ledger_write.target()).resolves.toBeUndefined()
	})

	it('names the repository ledger on a real command path', async () => {
		vi.stubEnv('VITEST', undefined)
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/repo/a')

		await expect(lane_ledger_write.target()).resolves.toBe(lane_ledger_write.target_of('/repo/a'))
	})

	// joshuafolkken/kit#3643: the stage and dispatch writers sit on paths many suites run, and one that
	// forgot to mock this module would append fixture durations to the real measurement.
	it('answers no ledger inside a test run, so a suite never writes the real one', async () => {
		const repository = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/repo/a')

		await expect(lane_ledger_write.target()).resolves.toBeUndefined()
		expect(repository).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4734: the merge is dated to its confirmation, not to whenever the sync ended.
describe('lane_ledger_write.record_merge', () => {
	const repository = path.join(scratch, 'merge-repo')

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
		rmSync(lane_ledger_write.target_of(repository), { force: true })
	})

	it('records the merge at the date it is handed', async () => {
		vi.stubEnv('VITEST', undefined)
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(repository)

		await lane_ledger_write.record_merge(9, new Date(AT))

		expect(lane_ledger.read_entries(lane_ledger_write.target_of(repository))).toMatchObject([
			{ kind: 'merge', at: AT, issue: 9 },
		])
	})
})

describe('lane_ledger_write.target_of', () => {
	it('names one ledger per repository', () => {
		expect(lane_ledger_write.target_of('/repo/a')).not.toBe(lane_ledger_write.target_of('/repo/b'))
		expect(lane_ledger_write.target_of('/repo/a')).toBe(lane_ledger_write.target_of('/repo/a'))
	})
})
