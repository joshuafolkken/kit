import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger } from './lane-ledger'

// joshuafolkken/kit#3355: the lane-limit measurement ledger is append-only JSONL that survives a
// malformed line, and recording into it never raises into the gate or merge being measured.

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-ledger-test-'))
const AT = '2026-10-06T00:00:00.000Z'
const GATE_MS = 90_000

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function ledger(name: string): string {
	return path.join(scratch, `${name}.jsonl`)
}

describe('lane_ledger.read_entries', () => {
	it('reads back every appended entry, oldest first', () => {
		const target = ledger('round-trip')

		lane_ledger.append(target, { kind: 'merge', at: AT, issue: 1 })
		lane_ledger.append(target, { kind: 'load', at: AT, load: 2.5, available_mb: 512 })

		expect(lane_ledger.read_entries(target)).toStrictEqual([
			{ kind: 'merge', at: AT, issue: 1 },
			{ kind: 'load', at: AT, load: 2.5, available_mb: 512 },
		])
	})

	it('skips a malformed line instead of dropping the whole ledger', () => {
		const target = ledger('malformed')

		lane_ledger.append(target, { kind: 'merge', at: AT, issue: 2 })
		appendFileSync(target, '{"kind":"merge","at\n')
		lane_ledger.append(target, { kind: 'merge', at: AT, issue: 3 })

		expect(lane_ledger.read_entries(target)).toHaveLength(2)
	})

	it('reads an absent file as an empty ledger', () => {
		expect(lane_ledger.read_entries(ledger('absent'))).toStrictEqual([])
	})
})

// joshuafolkken/kit#4263: `run:board` reads the ledger on every local read; an unchanged file is not
// parsed again.
describe('lane_ledger.read_entries over an unchanged ledger', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('parses the ledger once while it is unchanged, and again once it is appended to', () => {
		const target = ledger('unchanged')

		lane_ledger.append(target, { kind: 'merge', at: AT, issue: 1 })
		const parse = vi.spyOn(json_value, 'parse_or_undefined')

		lane_ledger.read_entries(target)
		const parsed = parse.mock.calls.length

		lane_ledger.read_entries(target)
		expect(parsed).toBeGreaterThan(0)
		expect(parse).toHaveBeenCalledTimes(parsed)

		lane_ledger.append(target, { kind: 'merge', at: AT, issue: 2 })
		expect(lane_ledger.read_entries(target)).toHaveLength(2)
	})
})

describe('lane_ledger.read_entries on a load sample memory', () => {
	// joshuafolkken/kit#3593: the memory is `machine_capacity`'s reading, which can go unread.
	it('keeps a load sample whose memory could not be read', () => {
		const target = ledger('unread-memory')

		lane_ledger.append(target, { kind: 'load', at: AT, load: 2.5, lanes: 1 })
		lane_ledger.append(target, { kind: 'load', at: AT, load: 1, available_mb: 512, swapped_mb: 3 })

		expect(lane_ledger.read_entries(target)).toStrictEqual([
			{ kind: 'load', at: AT, load: 2.5, lanes: 1 },
			{ kind: 'load', at: AT, load: 1, available_mb: 512, swapped_mb: 3 },
		])
	})

	// joshuafolkken/kit#3874: the process breakdown reads back with the sample it was taken in.
	it('keeps the process kinds a load sample carries', () => {
		const target = ledger('process-kinds')
		const processes = [{ kind: 'eslint', cpu_percent: 180, rss_mb: 2048, count: 3 }]

		lane_ledger.append(target, { kind: 'load', at: AT, load: 9, processes })

		expect(lane_ledger.read_entries(target)).toStrictEqual([
			{ kind: 'load', at: AT, load: 9, processes },
		])
	})

	// joshuafolkken/kit#3593: a row measured before the rename keeps its load and loses its memory.
	it('reads a pre-rename load sample without its memory fields', () => {
		const target = ledger('pre-rename')
		const old_row = { kind: 'load', at: AT, load: 2.5, free_mb: 40, swap_mb: 900, lanes: 1 }

		appendFileSync(target, `${JSON.stringify(old_row)}\n`)

		expect(lane_ledger.read_entries(target)).toStrictEqual([
			{ kind: 'load', at: AT, load: 2.5, lanes: 1 },
		])
	})
})

describe('lane_ledger.record', () => {
	it('swallows a failed append', async () => {
		const unwritable = path.join(scratch, 'missing-directory', 'ledger.jsonl')

		await expect(
			lane_ledger.record({ kind: 'merge', at: AT, issue: 4 }, unwritable),
		).resolves.toBeUndefined()
	})

	it('records a gate with its elapsed time and verdict', async () => {
		const target = ledger('gate')

		await lane_ledger.record_gate(target, { elapsed_ms: GATE_MS, is_passed: false })

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'gate', elapsed_ms: GATE_MS, is_passed: false },
		])
	})

	// joshuafolkken/kit#3501: the external load a gate ran beside is read back with its duration.
	it('records the external cores a gate ran beside', async () => {
		const target = ledger('gate-external')

		await lane_ledger.record_gate(target, {
			elapsed_ms: GATE_MS,
			is_passed: true,
			external_cores: 3,
		})

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'gate', external_cores: 3 }])
	})
})

// joshuafolkken/kit#3643: a lane's dispatch and each finished stage are entries of their own, so
// `lane:stats` can say where a lane's time went.
describe('lane_ledger — the stage and dispatch entries', () => {
	it('records a finished stage with its issue and its duration', async () => {
		const target = ledger('stage')

		await lane_ledger.record_stage({ stage: 'review', elapsed_ms: GATE_MS, issue: 7 }, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'stage', stage: 'review', elapsed_ms: GATE_MS, issue: 7 },
		])
	})

	it('records a stage whose writer holds no issue', async () => {
		const target = ledger('stage-no-issue')
		const stage = lane_ledger.CI_WAIT_STAGE

		await lane_ledger.record_stage({ stage, elapsed_ms: GATE_MS }, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'stage', stage }])
	})

	it('records a dispatch naming the issue', async () => {
		const target = ledger('dispatch')

		await lane_ledger.record_dispatch(7, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'dispatch', issue: 7 }])
	})

	// joshuafolkken/kit#3789: a stopped ship is an entry of its own, so `lane:stats` can time the wait.
	it('records a stopped ship naming the issue and the stop reason', async () => {
		const target = ledger('stop')

		await lane_ledger.record_stop({ issue: 7, reason: 'conflict', cause: 'conflict' }, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'stop', issue: 7, reason: 'conflict', cause: 'conflict' },
		])
	})

	// joshuafolkken/kit#3901: a ship's wait for an overlapping open pull request is recorded with what
	// overlapped and how it ended, beside the `conflict` stops it exists to reduce.
	it('records an overlap wait naming the lanes, the shared paths and whether it cleared', async () => {
		const target = ledger('overlap')
		const overlap = { issue: 7, lanes: [8], paths: ['a.ts'], waited_ms: 30_000, is_cleared: true }

		await lane_ledger.record_overlap(overlap, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'overlap', ...overlap }])
	})
})

// joshuafolkken/kit#3995: a free lane the driver left empty is recorded with why.
// joshuafolkken/kit#4166: a preflight stop keeps the kinds of the preconditions it found unmet.
describe('lane_ledger.record_stop — the unmet preconditions', () => {
	it('keeps the unmet preconditions of a preflight stop', async () => {
		const target = ledger('stop-preconditions')
		const stop = { issue: 7, reason: 'preflight', cause: 'check', preconditions: ['lock', 'issue'] }

		await lane_ledger.record_stop(stop, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'stop', ...stop }])
	})
})

describe('lane_ledger.record_held', () => {
	it('records a dispatch hold naming its reason', async () => {
		const target = ledger('held')
		const reason = 'offer:wait:blocked'

		await lane_ledger.record_held(reason, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'held', reason }])
	})

	it('records the release that ends a hold without a dispatch', async () => {
		const target = ledger('released')

		await lane_ledger.record_released(target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'released' }])
	})
})

// joshuafolkken/kit#4382: a claim's wait for the core budget reads back as one entry.
describe('lane_ledger.record_core_wait', () => {
	it('writes the command, the wait and the lane, read back as a core-wait entry', async () => {
		const target = ledger('core-wait')
		const wait = { command: 'lint', waited_ms: 500, issue: 4382 }

		await lane_ledger.record_core_wait(wait, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([{ kind: 'core-wait', ...wait }])
	})
})

// joshuafolkken/kit#4451: a unit run's slowest files read back as one entry.
describe('lane_ledger.record_unit_files', () => {
	it('writes each file and its wall time, read back as a unit-files entry', async () => {
		const target = ledger(lane_ledger.KIND.UNIT_FILES)
		const files = [{ file: 'scripts/stalled.test.ts', elapsed_ms: 370_000 }]

		await lane_ledger.record_unit_files(files, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: lane_ledger.KIND.UNIT_FILES, files },
		])
	})
})

describe('lane_ledger.record_offerable', () => {
	it('records whether offerable work and a free lane coexist', async () => {
		const target = ledger('offerable')

		await lane_ledger.record_offerable(true, target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'offerable', is_offerable: true },
		])
	})
})

describe('lane_ledger.target', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('answers no ledger outside a repository instead of rejecting', async () => {
		vi.stubEnv('VITEST', undefined)
		vi.spyOn(run_carry, 'repository_directory').mockRejectedValue(
			new Error('fatal: not a git repository'),
		)

		await expect(lane_ledger.target()).resolves.toBeUndefined()
	})

	it('names the repository ledger on a real command path', async () => {
		vi.stubEnv('VITEST', undefined)
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/repo/a')

		await expect(lane_ledger.target()).resolves.toBe(lane_ledger.target_of('/repo/a'))
	})

	// joshuafolkken/kit#3643: the stage and dispatch writers sit on paths many suites run, and one that
	// forgot to mock this module would append fixture durations to the real measurement.
	it('answers no ledger inside a test run, so a suite never writes the real one', async () => {
		const repository = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/repo/a')

		await expect(lane_ledger.target()).resolves.toBeUndefined()
		expect(repository).not.toHaveBeenCalled()
	})
})

describe('lane_ledger.target_of', () => {
	it('names one ledger per repository', () => {
		expect(lane_ledger.target_of('/repo/a')).not.toBe(lane_ledger.target_of('/repo/b'))
		expect(lane_ledger.target_of('/repo/a')).toBe(lane_ledger.target_of('/repo/a'))
	})
})
