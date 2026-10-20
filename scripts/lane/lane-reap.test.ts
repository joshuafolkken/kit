import { describe, expect, it } from 'vitest'
import { lane_reap, type ReapProbes } from './lane-reap'

// joshuafolkken/kit#2421: a lane child that hung after its merge lived on for a day, and the pgrep
// liveness check answered `alive` for its issue number forever. What is pinned here is which processes
// the reaper signals — the matched child, everything under it, and never the caller's own ancestry.

const ISSUE = '2398'
const DIRECTORY = '/w/.kit-lanes/2398'
const LANE = { issue: ISSUE, directory: DIRECTORY }
const CHILD = 48_848
const LOOP_SHELL = 48_900
const LOOP_SUBSHELL = 48_901
const STRANGER = 70_000
const OWN_PARENT = 60_000
const INIT = 1
const DAEMON = 20_611
const DAEMON_PATTERN_START = '^eslint_d'

interface FakeTable {
	matching: Array<number>
	children: Record<number, Array<number>>
	parents: Record<number, number>
	immune?: Array<number>
	// Detached processes by the title `ps` shows, matched as `pgrep -f` would.
	titles?: Record<number, string>
}

function matching_titles(table: FakeTable, pattern: string): Array<number> {
	const titles = Object.entries(table.titles ?? {})

	return titles
		.filter(([, title]) => new RegExp(pattern, 'u').test(title))
		.map(([pid]) => Number(pid))
}

function probes_over(table: FakeTable, signalled: Array<number>): ReapProbes {
	return {
		matching: (pattern) =>
			pattern.startsWith(DAEMON_PATTERN_START)
				? matching_titles(table, pattern)
				: [...table.matching],
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

		expect(lane_reap.reap_child(LANE, probes)).toStrictEqual([CHILD, LOOP_SHELL, LOOP_SUBSHELL])
		expect(signalled).toStrictEqual([CHILD, LOOP_SHELL, LOOP_SUBSHELL])
	})

	it('answers the empty list when the child already ended by itself', () => {
		const signalled: Array<number> = []
		const probes = probes_over({ matching: [], children: {}, parents: own_ancestry() }, signalled)

		expect(lane_reap.reap_child(LANE, probes)).toStrictEqual([])
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

		expect(lane_reap.reap_child(LANE, probes)).toStrictEqual([CHILD])
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

		expect(lane_reap.reap_child(LANE, probes)).toStrictEqual([CHILD])
	})
})

// joshuafolkken/kit#4265: the edit hook's `eslint_d` detaches to pid 1, so no tree reaches it, and a
// paused lane kept it running. It is found by its `eslint_d - <lane directory>` title.
describe('lane_reap.lane_daemons', () => {
	it('finds only the daemon serving that lane directory', () => {
		const titles = {
			[DAEMON]: `eslint_d - ${DIRECTORY}     PORT_SEED=1 TERM_PROGRAM=vscode`,
			[DAEMON + 1]: `eslint_d - ${DIRECTORY}0`,
			[DAEMON + 2]: 'eslint_d - /w/kit',
			[DAEMON + 3]: 'eslint_d - /w/_kit-lanes/2398',
			[DAEMON + 4]: `node ${DIRECTORY}/eslint_d - ${DIRECTORY}`,
		}
		const probes = probes_over({ matching: [], children: {}, parents: own_ancestry(), titles }, [])

		expect(lane_reap.lane_daemons(DIRECTORY, probes)).toStrictEqual([DAEMON])
	})

	it('never answers the caller or its ancestors', () => {
		const titles = { [OWN_PARENT]: `eslint_d - ${DIRECTORY}` }
		const probes = probes_over({ matching: [], children: {}, parents: own_ancestry(), titles }, [])

		expect(lane_reap.lane_daemons(DIRECTORY, probes)).toStrictEqual([])
	})
})

describe('lane_reap.reap_child — the lane’s daemon', () => {
	it('terminates the daemon with the tree and counts only the child’s processes', () => {
		const signalled: Array<number> = []
		const table: FakeTable = {
			matching: [CHILD],
			children: {},
			parents: own_ancestry(),
			titles: { [DAEMON]: `eslint_d - ${DIRECTORY}` },
		}

		expect(lane_reap.reap_child(LANE, probes_over(table, signalled))).toStrictEqual([CHILD])
		expect(signalled).toStrictEqual([CHILD, DAEMON])
	})

	it('ends a daemon a child that already ended left behind', () => {
		const signalled: Array<number> = []
		const titles = { [DAEMON]: `eslint_d - ${DIRECTORY}` }
		const probes = probes_over(
			{ matching: [], children: {}, parents: own_ancestry(), titles },
			signalled,
		)

		expect(lane_reap.reap_child(LANE, probes)).toStrictEqual([])
		expect(signalled).toStrictEqual([DAEMON])
	})
})

// joshuafolkken/kit#3772: `lane:restart` asks before it claims the marker, so the probe must signal
// nothing and must not count the caller's own ancestry as the child.
describe('lane_reap.is_child_running', () => {
	it('answers true for a matched child without signalling it', () => {
		const signalled: Array<number> = []
		const probes = probes_over(
			{ matching: [CHILD], children: {}, parents: own_ancestry() },
			signalled,
		)

		expect(lane_reap.is_child_running(ISSUE, probes)).toBe(true)
		expect(signalled).toStrictEqual([])
	})

	it('answers false when only the caller itself matches', () => {
		const probes = probes_over(
			{ matching: [process.pid], children: {}, parents: own_ancestry() },
			[],
		)

		expect(lane_reap.is_child_running(ISSUE, probes)).toBe(false)
	})
})

// joshuafolkken/kit#2472: the Stop hook matches a carry record's owner against this chain.
describe('lane_reap.own_ancestry', () => {
	it('holds this process and every process above it', () => {
		const probes = probes_over({ matching: [], children: {}, parents: own_ancestry() }, [])

		expect([...lane_reap.own_ancestry(probes)]).toStrictEqual([process.pid, OWN_PARENT, INIT])
	})
})

describe('lane_reap.parse_pids', () => {
	it('reads one pid per line and drops blanks, init and non-numbers', () => {
		expect(
			lane_reap.parse_pids(`${String(CHILD)}\n\n 1\nfoo\n${String(LOOP_SHELL)}\n`),
		).toStrictEqual([CHILD, LOOP_SHELL])
	})
})
