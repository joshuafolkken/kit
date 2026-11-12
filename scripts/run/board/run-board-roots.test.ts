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

describe('run_board_roots.session_is_active', () => {
	it.each([
		{ name: 'live session', carry: CARRY, live: true, expected: true },
		{ name: 'exited session', carry: CARRY, live: false, expected: false },
		{ name: 'unreadable identity', carry: CARRY, live: undefined, expected: true },
		{
			name: 'handed back session',
			carry: { ...CARRY, is_handed_off: true },
			live: true,
			expected: false,
		},
		{ name: 'driver', carry: { ...CARRY, owner_pid: SUPERVISOR }, live: true, expected: false },
	])('reads $name from ownership and process evidence', ({ carry, live, expected }) => {
		vi.spyOn(run_wake, 'read_wake').mockReturnValue(WAKE)

		expect(
			run_board_roots.session_is_active(REPOSITORY, { kind: 'carried', carry }, same(live)),
		).toBe(expected)
	})
})

describe('run_board_roots.session_is_active pid-less owners', () => {
	it.each([true, false])('reads a pid-less Codex session from the wake launch: %s', (live) => {
		vi.spyOn(run_wake, 'read_wake').mockReturnValue({ ...WAKE, woke_pid: PARENT })
		const carry = {
			...CARRY,
			owner_pid: undefined,
			owner_start: undefined,
			is_owner_headless: true,
		}

		expect(
			run_board_roots.session_is_active(REPOSITORY, { kind: 'carried', carry }, same(live)),
		).toBe(live)
	})

	it('has no session without a carried run or a recorded launch', () => {
		vi.spyOn(run_wake, 'read_wake').mockReturnValue(undefined)
		const carry = { ...CARRY, owner_pid: undefined, owner_start: undefined }

		expect(run_board_roots.session_is_active(REPOSITORY, { kind: 'none' }, same(true))).toBe(false)
		expect(
			run_board_roots.session_is_active(REPOSITORY, { kind: 'carried', carry }, same(true)),
		).toBe(false)
	})
})
