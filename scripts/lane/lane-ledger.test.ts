import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
