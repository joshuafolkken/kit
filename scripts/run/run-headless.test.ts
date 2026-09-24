import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CarryRead, RunCarry } from './run-carry'

// joshuafolkken/kit#2437. Under `claude -p` a turn-end is the process's end, so a headless parent with
// lanes in flight must keep waiting; everything else — an attached session, a lane child, a parent
// whose cut handed the record off — may stop as before.

vi.mock('./run-watcher-guard', () => ({
	run_watcher_guard: { has_lanes_in_flight: vi.fn() },
}))

vi.mock('./run-carry', () => ({
	run_carry: {
		repository_directory: vi.fn(),
		carry_path: vi.fn(() => '/carry.json'),
		read_carry: vi.fn(),
	},
}))

const { run_watcher_guard } = await import('./run-watcher-guard')
const { run_carry } = await import('./run-carry')
const { run_headless } = await import('./run-headless')

const lanes_in_flight = vi.mocked(run_watcher_guard.has_lanes_in_flight)
const repository_directory = vi.mocked(run_carry.repository_directory)
const read_carry = vi.mocked(run_carry.read_carry)

const HEADLESS = { [run_headless.HEADLESS_ENV_KEY]: '1' }
const HEADLESS_CHILD = { ...HEADLESS, JOSH_LANE_CHILD: '2437' }
const ATTACHED = {}

function carry(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: 'backlogrun',
		started_at: '2026-09-23T08:00:00.000Z',
		merged: 0,
		filed: 0,
		cuts: 1,
		failures: 0,
		outages: 0,
		...overrides,
	}
}

const DRIVING: CarryRead = { kind: 'carried', carry: carry() }
const SESSION_PID = 6445
const SUCCESSOR_PID = 83_508
const OWNED: CarryRead = { kind: 'carried', carry: carry({ owner_pid: SESSION_PID }) }
const HANDED_OFF: CarryRead = {
	kind: 'carried',
	carry: carry({ owner_pid: SESSION_PID, is_handed_off: true }),
}

function own_ancestry(): ReadonlySet<number> {
	return new Set([process.pid, SESSION_PID])
}

beforeEach(() => {
	vi.clearAllMocks()
	lanes_in_flight.mockResolvedValue(true)
	repository_directory.mockResolvedValue('/repo/.git')
	read_carry.mockReturnValue(DRIVING)
})

describe('run_headless.environment', () => {
	it('marks the launched session headless', () => {
		expect(run_headless.is_headless(run_headless.environment())).toBe(true)
		expect(run_headless.is_headless(ATTACHED)).toBe(false)
	})
})

describe('run_headless.must_keep_waiting', () => {
	it('holds a headless parent with lanes in flight and a live record', async () => {
		expect(await run_headless.must_keep_waiting(HEADLESS)).toBe(true)
	})

	it('lets a headless parent with no lanes in flight stop', async () => {
		lanes_in_flight.mockResolvedValue(false)

		expect(await run_headless.must_keep_waiting(HEADLESS)).toBe(false)
	})

	it('never holds an attached session', async () => {
		expect(await run_headless.must_keep_waiting(ATTACHED)).toBe(false)
	})

	it('never holds a lane child that inherited the mark', async () => {
		expect(await run_headless.must_keep_waiting(HEADLESS_CHILD)).toBe(false)
	})

	it('lets a parent whose cut handed the record off stop', async () => {
		read_carry.mockReturnValue(HANDED_OFF)

		expect(await run_headless.must_keep_waiting(HEADLESS)).toBe(false)
	})

	it('lets a parent whose run ended stop', async () => {
		read_carry.mockReturnValue({ kind: 'none' })

		expect(await run_headless.must_keep_waiting(HEADLESS)).toBe(false)
	})
})

// joshuafolkken/kit#2452: the pick-up rules bind the driving `backlogrun` parent, attached or headless.
describe('run_headless.is_backlog_parent', () => {
	beforeEach(() => {
		read_carry.mockReturnValue(OWNED)
	})

	it('reads an attached session that owns a live record as the parent', async () => {
		expect(await run_headless.is_backlog_parent(ATTACHED, own_ancestry)).toBe(true)
	})

	it('never reads a lane child as the parent', async () => {
		expect(await run_headless.is_backlog_parent(HEADLESS_CHILD, own_ancestry)).toBe(false)
	})

	it('does not read a handed-off or absent record as the parent', async () => {
		read_carry.mockReturnValue(HANDED_OFF)
		expect(await run_headless.is_backlog_parent(ATTACHED, own_ancestry)).toBe(false)

		read_carry.mockReturnValue({ kind: 'none' })
		expect(await run_headless.is_backlog_parent(ATTACHED, own_ancestry)).toBe(false)
	})
})

// joshuafolkken/kit#2472: after a cut the successor owns the record, and the session that cut —
// reading the same file — kept being blocked as though it still drove the run.
describe('run_headless.is_backlog_parent — ownership', () => {
	it('does not read a session another owner drives as the parent', async () => {
		read_carry.mockReturnValue({ kind: 'carried', carry: carry({ owner_pid: SUCCESSOR_PID }) })

		expect(await run_headless.is_backlog_parent(ATTACHED, own_ancestry)).toBe(false)
	})

	it('does not read a record that declared no owner as anyone’s', async () => {
		read_carry.mockReturnValue(DRIVING)

		expect(await run_headless.is_backlog_parent(ATTACHED, own_ancestry)).toBe(false)
	})
})

describe('run_headless.current_carry', () => {
	it('answers the live record whoever owns it, and nothing without one', async () => {
		expect(await run_headless.current_carry()).toStrictEqual(carry())

		read_carry.mockReturnValue({ kind: 'none' })
		expect(await run_headless.current_carry()).toBeUndefined()
	})
})
