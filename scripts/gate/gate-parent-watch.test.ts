import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_parent_watch, type ParentProbe } from './gate-parent-watch'

const LAUNCH_PARENT = 4242
const INIT_PID = 1
const { PARENT_POLL_MS, ORPHAN_EXIT_CODE } = gate_parent_watch

interface ProbeFixture {
	probe: ParentProbe
	set_parent: (pid: number) => void
	ended: () => number
	exits: () => ReadonlyArray<number>
}

function probe_fixture(): ProbeFixture {
	let parent = LAUNCH_PARENT
	let ended = 0
	const exits: Array<number> = []
	const probe: ParentProbe = {
		read_parent: () => parent,
		end_group: () => {
			ended += 1
		},
		exit: (code) => {
			exits.push(code)
		},
	}

	return {
		probe,
		set_parent: (pid) => {
			parent = pid
		},
		ended: () => ended,
		exits: () => exits,
	}
}

describe('gate_parent_watch.start', () => {
	let timer: NodeJS.Timeout | undefined

	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		clearInterval(timer)
		vi.useRealTimers()
	})

	it('ends the process group and exits non-zero once the parent is gone', () => {
		const fixture = probe_fixture()

		timer = gate_parent_watch.start(fixture.probe)
		fixture.set_parent(INIT_PID)
		vi.advanceTimersByTime(PARENT_POLL_MS)

		expect(fixture.ended()).toBe(1)
		expect(fixture.exits()).toStrictEqual([ORPHAN_EXIT_CODE])
		expect(ORPHAN_EXIT_CODE).not.toBe(0)
	})

	it('leaves a gate alone while its parent lives', () => {
		const fixture = probe_fixture()

		timer = gate_parent_watch.start(fixture.probe)
		vi.advanceTimersByTime(PARENT_POLL_MS * 10)

		expect(fixture.ended()).toBe(0)
		expect(fixture.exits()).toStrictEqual([])
	})

	it('does not hold the gate open: the poll timer is unref-ed', () => {
		timer = gate_parent_watch.start(probe_fixture().probe)

		expect(timer.hasRef()).toBe(false)
	})
})

describe('gate_parent_watch.check_parent', () => {
	it('acts on any parent other than the one read at launch', () => {
		const fixture = probe_fixture()

		fixture.set_parent(LAUNCH_PARENT + 1)
		gate_parent_watch.check_parent(LAUNCH_PARENT, fixture.probe)

		expect(fixture.ended()).toBe(1)
		expect(fixture.exits()).toStrictEqual([ORPHAN_EXIT_CODE])
	})
})
