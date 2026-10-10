import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { RunCarry } from './run-carry'
import { run_carry_ended } from './run-carry-ended'

// joshuafolkken/kit#3439: the run `--end` closed stays readable until the next `--end` replaces it.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-ended-test-'))
const STARTED_AT = '2026-10-08T09:00:00.000Z'
const EPIC_RUN = 'backlogrun #3431'
const ENDED_AT = new Date('2026-10-08T12:00:00.000Z')

function carry(invocation: string): RunCarry {
	return {
		invocation,
		started_at: STARTED_AT,
		merged: 2,
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
	}
}

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('run_carry_ended', () => {
	it('records the ended run’s invocation, start and end, and the next end replaces it', () => {
		const target = path.join(scratch, 'replace.json')

		run_carry_ended.record_ended(target, { kind: 'carried', carry: carry('backlogrun') }, ENDED_AT)
		run_carry_ended.record_ended(target, { kind: 'expired', carry: carry(EPIC_RUN) }, ENDED_AT)

		expect(run_carry_ended.read_ended(target)).toStrictEqual({
			invocation: EPIC_RUN,
			started_at: STARTED_AT,
			ended_at: ENDED_AT.toISOString(),
		})
	})
})

// joshuafolkken/kit#3437: a stopped run keeps the session the board offers to resume.
describe('run_carry_ended stop', () => {
	it('keeps a stopped run’s reason and the session its owner transcript names', () => {
		const target = path.join(scratch, 'stopped.json')
		const owned = { ...carry(EPIC_RUN), owner_transcript: '/p/0b7e1c2a.jsonl' }

		run_carry_ended.record_ended(target, { kind: 'carried', carry: owned }, ENDED_AT, 'decision')

		expect(run_carry_ended.read_ended(target)).toStrictEqual({
			invocation: EPIC_RUN,
			started_at: STARTED_AT,
			ended_at: ENDED_AT.toISOString(),
			stopped: 'decision',
			session: '0b7e1c2a',
		})
	})

	it('keeps no session for a clean end, nor for a stop with no owner transcript', () => {
		const clean = path.join(scratch, 'clean.json')
		const bare = path.join(scratch, 'bare.json')
		const owned = { ...carry(EPIC_RUN), owner_transcript: '/p/abc.jsonl' }

		run_carry_ended.record_ended(clean, { kind: 'carried', carry: owned }, ENDED_AT)
		run_carry_ended.record_ended(bare, { kind: 'carried', carry: carry(EPIC_RUN) }, ENDED_AT, 'x')

		expect(run_carry_ended.read_ended(clean)).not.toHaveProperty('stopped')
		expect(run_carry_ended.read_ended(bare)).toStrictEqual({
			invocation: EPIC_RUN,
			started_at: STARTED_AT,
			ended_at: ENDED_AT.toISOString(),
			stopped: 'x',
		})
	})
})

describe('run_carry_ended reads', () => {
	it('keeps the previous record when the end found no record to close', () => {
		const target = path.join(scratch, 'keep.json')

		run_carry_ended.record_ended(target, { kind: 'carried', carry: carry('backlogrun') }, ENDED_AT)
		run_carry_ended.record_ended(target, { kind: 'none' })
		run_carry_ended.record_ended(target, { kind: 'unreadable' })

		expect(run_carry_ended.read_ended(target)?.invocation).toBe('backlogrun')
	})

	it('reads nothing when no run has ended or the record is not one', () => {
		const corrupt = path.join(scratch, 'corrupt.json')

		writeFileSync(corrupt, '{"invocation":1}')

		expect(run_carry_ended.read_ended(path.join(scratch, 'absent.json'))).toBeUndefined()
		expect(run_carry_ended.read_ended(corrupt)).toBeUndefined()
	})

	it('keys the record on the common git directory, apart from the carry record', () => {
		expect(run_carry_ended.ended_path('/a/.git')).toBe(run_carry_ended.ended_path('/a/.git'))
		expect(run_carry_ended.ended_path('/a/.git')).not.toBe(run_carry_ended.ended_path('/b/.git'))
		expect(path.basename(run_carry_ended.ended_path('/a/.git'))).toMatch(/^josh-run-ended-/u)
	})
})
