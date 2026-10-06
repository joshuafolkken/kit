import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterAll, describe, expect, it, vi } from 'vitest'
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
		lane_ledger.append(target, { kind: 'load', at: AT, load: 2.5, free_mb: 512 })

		expect(lane_ledger.read_entries(target)).toStrictEqual([
			{ kind: 'merge', at: AT, issue: 1 },
			{ kind: 'load', at: AT, load: 2.5, free_mb: 512 },
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

describe('lane_ledger.record', () => {
	it('swallows a failed append', async () => {
		const unwritable = path.join(scratch, 'missing-directory', 'ledger.jsonl')

		await expect(
			lane_ledger.record({ kind: 'merge', at: AT, issue: 4 }, unwritable),
		).resolves.toBeUndefined()
	})

	it('records a gate with its elapsed time and verdict', async () => {
		const target = ledger('gate')

		await lane_ledger.record_gate(target, GATE_MS, false)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'gate', elapsed_ms: GATE_MS, is_passed: false },
		])
	})
})

describe('lane_ledger.target', () => {
	it('answers no ledger outside a repository instead of rejecting', async () => {
		const outside = vi
			.spyOn(run_carry, 'repository_directory')
			.mockRejectedValue(new Error('fatal: not a git repository'))

		try {
			await expect(lane_ledger.target()).resolves.toBeUndefined()
		} finally {
			outside.mockRestore()
		}
	})
})

describe('lane_ledger.target_of', () => {
	it('names one ledger per repository', () => {
		expect(lane_ledger.target_of('/repo/a')).not.toBe(lane_ledger.target_of('/repo/b'))
		expect(lane_ledger.target_of('/repo/a')).toBe(lane_ledger.target_of('/repo/a'))
	})
})
