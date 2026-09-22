import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { afterAll, describe, expect, it } from 'vitest'
import { run_carry, type RunCarry } from './run-carry'

// joshuafolkken/kit#2328: the end-of-run retrospective runs once per invocation, so the fact that it
// has run lives on the record that survives every session cut. `--retrospective` sets a sticky flag,
// and the adoption that carries a budget across a cut carries the flag with it. Colocated apart from
// `run-carry.test.ts` to keep that file under its line ceiling.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-retro-'))
const TARGET = run_carry.carry_path(path.join(scratch, 'repository.git'))
const INVOCATION = 'backlogrun --max 5'
const START = new Date('2026-09-10T00:00:00.000Z')

function begun(): RunCarry {
	run_carry.end_carry(TARGET)

	const carry = run_carry.begin_carry(TARGET, INVOCATION, run_carry.NO_OWNER, START)

	if (carry === undefined) throw new Error('the scratch record was claimed by something else')

	return carry
}

function dead_owner(): ReturnType<typeof run_carry.owner_of> {
	return run_carry.owner_of(process_identity_fixture.DEAD_PID)
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('the retrospective flag', () => {
	it('sets a sticky flag that survives a later count and a hand-off', () => {
		expect(run_carry.apply_change(TARGET, begun(), { merged: 1 }).retrospective).toBeUndefined()

		const marked = run_carry.apply_change(TARGET, begun(), { retrospective: true })

		expect(run_carry.apply_change(TARGET, marked, { merged: 1 }).retrospective).toBe(true)

		const cut = run_carry.apply_change(TARGET, marked, { cuts: 1 })

		expect(run_carry.adopt_carry(TARGET, cut, dead_owner())?.retrospective).toBe(true)
	})

	it('reads the flag off a record, and false off a read with none', () => {
		const marked = run_carry.apply_change(TARGET, begun(), { retrospective: true })

		expect(run_carry.retrospective_done_of({ kind: 'carried', carry: marked })).toBe(true)
		expect(run_carry.retrospective_done_of({ kind: 'none' })).toBe(false)
	})
})
