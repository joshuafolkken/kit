import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import { run_wake, type RunWake } from '#scripts/run/wake/run-wake'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_roots } from './run-board-roots'

// joshuafolkken/kit#4171: the supervisor from its wake stamp and the parent session from the run's
// record, each dropped once its pid has become another process.

const REPOSITORY = '/repo/.git'
const SUPERVISOR = 101
const PARENT = 202
const START = 'Mon Oct 19 09:00:00 2026'
const STARTED_AT = '2026-10-19T09:00:00.000Z'
const WAKE: RunWake = {
	invocation: 'backlogrun',
	started_at: STARTED_AT,
	pid: SUPERVISOR,
	woke: 0,
	process_start: START,
}
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: STARTED_AT,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
	owner_pid: PARENT,
	owner_start: START,
}
const CARRIED: CarryRead = { kind: 'carried', carry: CARRY }

function same(answer: boolean | undefined): () => boolean | undefined {
	return () => answer
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_roots.roots_of', () => {
	it('names the supervisor and the parent while each is still the process recorded', () => {
		vi.spyOn(run_wake, 'read_wake').mockReturnValue(WAKE)

		expect(run_board_roots.roots_of(REPOSITORY, CARRIED, same(true))).toStrictEqual({
			supervisor: SUPERVISOR,
			parent: PARENT,
		})
	})

	it('keeps a pid recorded without a start, which cannot be checked', () => {
		vi.spyOn(run_wake, 'read_wake').mockReturnValue(WAKE)

		expect(run_board_roots.roots_of(REPOSITORY, CARRIED, same(undefined))).toStrictEqual({
			supervisor: SUPERVISOR,
			parent: PARENT,
		})
	})

	it('drops a pid that is now another process', () => {
		vi.spyOn(run_wake, 'read_wake').mockReturnValue(WAKE)

		expect(run_board_roots.roots_of(REPOSITORY, CARRIED, same(false))).toStrictEqual({
			supervisor: undefined,
			parent: undefined,
		})
	})

	it('names neither with no wake stamp and no carried run', () => {
		vi.spyOn(run_wake, 'read_wake').mockReturnValue(undefined)
		const is_same = vi.fn(same(true))

		expect(run_board_roots.roots_of(REPOSITORY, { kind: 'none' }, is_same)).toStrictEqual({
			supervisor: undefined,
			parent: undefined,
		})
		expect(is_same).not.toHaveBeenCalled()
	})
})
