import { beforeEach, describe, expect, it } from 'vitest'
import { run_ship_gate_runs } from './run-ship-gate-runs'

// joshuafolkken/kit#5567: why a ship's `josh gate` ran again, against the last tree it met green.

const OK = 0
const FAILED = 1
const FIRST = 'a.ts'
const SECOND = 'b.ts'
const TREE = { files: { [FIRST]: 'one' }, base: 'base' }
const { REASON } = run_ship_gate_runs

beforeEach(() => {
	run_ship_gate_runs.forget()
})

describe('run_ship_gate_runs.reason_of', () => {
	it('names no record before any gate met a tree green', () => {
		expect(run_ship_gate_runs.reason_of(TREE)).toBe(REASON.NO_RECORD)
	})

	it('names the merge when the base moved since the green tree', () => {
		run_ship_gate_runs.met(TREE, OK)

		expect(run_ship_gate_runs.reason_of({ ...TREE, base: 'merged' })).toBe(REASON.MERGE)
	})

	it('names a fix when the branch side moved on the same base', () => {
		run_ship_gate_runs.met(TREE, OK)

		expect(run_ship_gate_runs.reason_of({ ...TREE, files: { [FIRST]: 'two' } })).toBe(REASON.FIX)
	})

	it('compares against no red tree', () => {
		run_ship_gate_runs.met(TREE, FAILED)

		expect(run_ship_gate_runs.reason_of({ ...TREE, base: 'merged' })).toBe(REASON.NO_RECORD)
	})
})

describe('run_ship_gate_runs.tree_hash', () => {
	it('is the same for one tree whatever order its files are listed in', () => {
		const forward = { files: { [FIRST]: 'one', [SECOND]: 'two' }, base: 'base' }
		const backward = { files: { [SECOND]: 'two', [FIRST]: 'one' }, base: 'base' }

		expect(run_ship_gate_runs.tree_hash(backward)).toBe(run_ship_gate_runs.tree_hash(forward))
	})

	it('differs once the base moves', () => {
		expect(run_ship_gate_runs.tree_hash(TREE)).not.toBe(
			run_ship_gate_runs.tree_hash({ ...TREE, base: 'merged' }),
		)
	})

	it('names the hash on the reused line', () => {
		expect(run_ship_gate_runs.reused_line(TREE)).toBe(
			`reused gate (${run_ship_gate_runs.tree_hash(TREE)})`,
		)
	})
})
