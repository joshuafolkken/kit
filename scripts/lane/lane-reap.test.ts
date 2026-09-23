import { describe, expect, it } from 'vitest'
import { lane_reap, type ReapProbes } from './lane-reap'

// joshuafolkken/kit#2421: a lane child that hung after its merge lived on for a day, and the pgrep
// liveness check answered `alive` for its issue number forever. What is pinned here is which processes
// the reaper signals — the matched child, everything under it, and never the caller's own ancestry.

const ISSUE = '2398'
const CHILD = 48_848
const LOOP_SHELL = 48_900
const LOOP_SUBSHELL = 48_901
const STRANGER = 70_000
const OWN_PARENT = 60_000
const INIT = 1

interface FakeTable {
	matching: Array<number>
	children: Record<number, Array<number>>
	parents: Record<number, number>
	immune?: Array<number>
}

function probes_over(table: FakeTable, signalled: Array<number>): ReapProbes {
	return {
		matching: () => [...table.matching],
		children_of: (pid) => table.children[pid] ?? [],
		parent_of: (pid) => table.parents[pid],
		terminate: (pid) => {
			if (table.immune?.includes(pid) === true) return false
			signalled.push(pid)

			return true
		},
	}
}

function own_ancestry(): Record<number, number> {
	return { [process.pid]: OWN_PARENT, [OWN_PARENT]: INIT }
}

describe('lane_reap.reap_child', () => {
	it('terminates the matched child and the whole tree under it', () => {
		const signalled: Array<number> = []
		const probes = probes_over(
			{
				matching: [CHILD],
				children: { [CHILD]: [LOOP_SHELL], [LOOP_SHELL]: [LOOP_SUBSHELL] },
				parents: own_ancestry(),
			},
			signalled,
		)

		expect(lane_reap.reap_child(ISSUE, probes)).toStrictEqual([CHILD, LOOP_SHELL, LOOP_SUBSHELL])
		expect(signalled).toStrictEqual([CHILD, LOOP_SHELL, LOOP_SUBSHELL])
	})

	it('answers the empty list when the child already ended by itself', () => {
		const signalled: Array<number> = []
		const probes = probes_over({ matching: [], children: {}, parents: own_ancestry() }, signalled)

		expect(lane_reap.reap_child(ISSUE, probes)).toStrictEqual([])
		expect(signalled).toStrictEqual([])
	})
})

describe('lane_reap.reap_child — what it spares', () => {
	// A `lane:close` issued from inside the lane it closes must not end the session running it.
	it('never signals the caller or its ancestors, even when they match', () => {
		const signalled: Array<number> = []
		const probes = probes_over(
			{
				matching: [OWN_PARENT, CHILD],
				children: { [OWN_PARENT]: [process.pid], [CHILD]: [] },
				parents: own_ancestry(),
			},
			signalled,
		)

		expect(lane_reap.reap_child(ISSUE, probes)).toStrictEqual([CHILD])
		expect(signalled).not.toContain(process.pid)
		expect(signalled).not.toContain(OWN_PARENT)
	})

	it('reports only the processes a signal actually reached', () => {
		const signalled: Array<number> = []
		const probes = probes_over(
			{
				matching: [CHILD, STRANGER],
				children: {},
				parents: own_ancestry(),
				immune: [STRANGER],
			},
			signalled,
		)

		expect(lane_reap.reap_child(ISSUE, probes)).toStrictEqual([CHILD])
	})
})

describe('lane_reap.parse_pids', () => {
	it('reads one pid per line and drops blanks, init and non-numbers', () => {
		expect(
			lane_reap.parse_pids(`${String(CHILD)}\n\n 1\nfoo\n${String(LOOP_SHELL)}\n`),
		).toStrictEqual([CHILD, LOOP_SHELL])
	})
})
