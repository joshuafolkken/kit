import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_owner_watch, type GateOwner, type OwnerProbe } from './gate-owner-watch'

const OWNER_PID = 4242
const OWNER_START = 'Mon Nov 23 19:56:12 2026'
const { OWNER_POLL_MS, ORPHAN_EXIT_CODE, OWNER_PID_KEY, OWNER_START_KEY } = gate_owner_watch
const OWNED = { [OWNER_PID_KEY]: String(OWNER_PID), [OWNER_START_KEY]: OWNER_START }

interface ProbeFixture {
	probe: OwnerProbe
	end_owner: () => void
	seen: () => ReadonlyArray<GateOwner>
	ended: () => number
	exits: () => ReadonlyArray<number>
}

function probe_fixture(): ProbeFixture {
	let is_alive = true
	let ended = 0
	const seen: Array<GateOwner> = []
	const exits: Array<number> = []
	const probe: OwnerProbe = {
		is_alive: (owner) => {
			seen.push(owner)

			return is_alive
		},
		end_tree: () => {
			ended += 1
		},
		exit: (code) => {
			exits.push(code)
		},
	}

	return {
		probe,
		end_owner: () => {
			is_alive = false
		},
		seen: () => seen,
		ended: () => ended,
		exits: () => exits,
	}
}

describe('gate_owner_watch.start', () => {
	let timer: NodeJS.Timeout | undefined

	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		clearInterval(timer)
		vi.useRealTimers()
	})

	it('ends its process tree and exits non-zero once the named owner is gone', () => {
		const fixture = probe_fixture()

		timer = gate_owner_watch.start(OWNED, fixture.probe)
		fixture.end_owner()
		vi.advanceTimersByTime(OWNER_POLL_MS)

		expect(fixture.seen()[0]).toStrictEqual({ pid: OWNER_PID, process_start: OWNER_START })
		expect(fixture.ended()).toBe(1)
		expect(fixture.exits()).toStrictEqual([ORPHAN_EXIT_CODE])
		expect(ORPHAN_EXIT_CODE).not.toBe(0)
	})

	it('leaves a gate alone while its owner lives', () => {
		const fixture = probe_fixture()

		timer = gate_owner_watch.start(OWNED, fixture.probe)
		vi.advanceTimersByTime(OWNER_POLL_MS * 10)

		expect(fixture.ended()).toBe(0)
		expect(fixture.exits()).toStrictEqual([])
	})

	it('does not hold the gate open: the poll timer is unref-ed', () => {
		timer = gate_owner_watch.start(OWNED, probe_fixture().probe)

		expect(timer?.hasRef()).toBe(false)
	})
})

describe('gate_owner_watch.start with no owner named', () => {
	it('does not watch the gate', () => {
		vi.useFakeTimers()
		const fixture = probe_fixture()
		const timer = gate_owner_watch.start({}, fixture.probe)

		fixture.end_owner()
		vi.advanceTimersByTime(OWNER_POLL_MS * 10)
		vi.useRealTimers()

		expect(timer).toBeUndefined()
		expect(fixture.seen()).toStrictEqual([])
		expect(fixture.ended()).toBe(0)
	})
})

describe('gate_owner_watch.read_owner', () => {
	it('reads back what environment_of wrote', () => {
		const owner = { pid: OWNER_PID, process_start: OWNER_START }

		expect(gate_owner_watch.read_owner(gate_owner_watch.environment_of(owner))).toStrictEqual(owner)
	})

	it('reads an owner with no start time as the pid alone', () => {
		expect(gate_owner_watch.environment_of({ pid: OWNER_PID })).toStrictEqual({
			[OWNER_PID_KEY]: String(OWNER_PID),
		})
		expect(gate_owner_watch.read_owner({ [OWNER_PID_KEY]: String(OWNER_PID) })).toStrictEqual({
			pid: OWNER_PID,
		})
	})

	it.each(['', 'abc', '0', '1', '-5'])('names no owner for the pid %j', (value) => {
		expect(gate_owner_watch.read_owner({ [OWNER_PID_KEY]: value })).toBeUndefined()
	})
})

// An attached ship runs its gate in ship's own process group, so the gate signals only what runs
// under it — never its parent or a sibling (joshuafolkken/kit#8845 round 1).
describe('gate_owner_watch.end_tree', () => {
	it('terminates every process under the gate and nothing above or beside it', () => {
		const CHECK = 9001
		const WORKER = 9002
		const children = new Map<number, Array<number>>([
			[process.pid, [CHECK]],
			[CHECK, [WORKER]],
		])
		const terminated: Array<number> = []

		gate_owner_watch.end_tree({
			matching: () => [],
			children_of: (pid) => children.get(pid) ?? [],
			parent_of: () => undefined,
			terminate: (pid) => {
				terminated.push(pid)

				return true
			},
		})

		expect(terminated).toStrictEqual([CHECK, WORKER])
	})
})

describe('gate_owner_watch.owner_of', () => {
	it('names the running process with its start time', () => {
		const owner = gate_owner_watch.owner_of(process.pid)

		expect(owner.pid).toBe(process.pid)
	})
})
