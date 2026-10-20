import { describe, expect, it, vi } from 'vitest'
import { lane_pause, type LaneSignal, type PauseProbes } from './lane-pause'
import { lane_registry, type LaneInfo } from './lane-registry'

// joshuafolkken/kit#4198: `lane:pause` suspends a lane child's whole process tree in place and
// `lane:resume` lets it carry on — the tree is `lane_reap`'s, the caller's own ancestry spared, and a
// child forked while the pause was under way is stopped on the next read.

const ISSUE = '4198'
const DIRECTORY = '/w/.kit-lanes/4198'
const TARGET = { issue: ISSUE, directory: DIRECTORY }
const OTHER = { issue: '4197', directory: '/w/.kit-lanes/4197' }
const CHILD = 48_848
const SHELL = 48_900
const LATE_CHILD = 48_950
const DAEMON = 20_611
const OWN_PARENT = 60_000
const INIT = 1
const DAEMON_PATTERN_START = '^eslint_d'
const TERMINATE = 'SIGTERM'
const LANE: LaneInfo = {
	issue: ISSUE,
	seat: 6,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	branch: '4198-lane',
	directory: DIRECTORY,
	is_stranded: false,
}

interface FakeTree {
	matching: Array<number>
	children: Record<number, Array<number>>
	// The detached `eslint_d` the daemon pattern finds.
	daemons?: Array<number>
}

interface Signalled {
	pid: number
	name: LaneSignal | typeof TERMINATE
}

function probes_over(tree: FakeTree, signalled: Array<Signalled>): PauseProbes {
	return {
		matching: (pattern) =>
			pattern.startsWith(DAEMON_PATTERN_START) ? [...(tree.daemons ?? [])] : [...tree.matching],
		children_of: (pid) => tree.children[pid] ?? [],
		parent_of: (pid) => ({ [process.pid]: OWN_PARENT, [OWN_PARENT]: INIT })[pid],
		signal: (pid, name) => {
			signalled.push({ pid, name })

			return true
		},
		terminate: (pid) => {
			signalled.push({ pid, name: TERMINATE })

			return true
		},
	}
}

describe('lane_pause.pause_lane — the tree', () => {
	it('stops the matched child and the whole tree under it', () => {
		const signalled: Array<Signalled> = []
		const probes = probes_over({ matching: [CHILD], children: { [CHILD]: [SHELL] } }, signalled)

		expect(lane_pause.pause_lane(TARGET, probes)).toStrictEqual({
			signalled: [CHILD, SHELL],
			ended: [],
		})
		expect(signalled).toStrictEqual([
			{ pid: CHILD, name: 'SIGSTOP' },
			{ pid: SHELL, name: 'SIGSTOP' },
		])
	})

	it('never stops the caller’s own ancestry, even when the pattern matches it', () => {
		const probes = probes_over({ matching: [OWN_PARENT, CHILD], children: {} }, [])

		expect(lane_pause.pause_lane(TARGET, probes).signalled).toStrictEqual([CHILD])
	})

	it('leaves out a process the signal could not reach', () => {
		const probes = probes_over({ matching: [CHILD], children: { [CHILD]: [SHELL] } }, [])
		const unreachable = { ...probes, signal: (pid: number): boolean => pid !== SHELL }

		expect(lane_pause.pause_lane(TARGET, unreachable).signalled).toStrictEqual([CHILD])
	})

	it('answers the empty list when the lane has no child running', () => {
		const probes = probes_over({ matching: [], children: {} }, [])

		expect(lane_pause.pause_lane(TARGET, probes)).toStrictEqual({ signalled: [], ended: [] })
	})
})

// joshuafolkken/kit#4265: the lane's detached `eslint_d` kept running under a pause, so `run:board`
// drew the lane as working. It is ended rather than stopped — a resume would not reach it.
describe('lane_pause.pause_lane — the lane’s daemon', () => {
	it('ends the daemon before it stops the tree', () => {
		const signalled: Array<Signalled> = []
		const tree: FakeTree = { matching: [CHILD], children: {}, daemons: [DAEMON] }

		expect(lane_pause.pause_lane(TARGET, probes_over(tree, signalled))).toStrictEqual({
			signalled: [CHILD],
			ended: [DAEMON],
		})
		expect(signalled).toStrictEqual([
			{ pid: DAEMON, name: TERMINATE },
			{ pid: CHILD, name: 'SIGSTOP' },
		])
	})

	it('never stops the daemon it ended', () => {
		const signalled: Array<Signalled> = []
		const tree: FakeTree = { matching: [], children: {}, daemons: [DAEMON] }

		lane_pause.pause_lane(TARGET, probes_over(tree, signalled))

		expect(signalled).toStrictEqual([{ pid: DAEMON, name: TERMINATE }])
	})
})

describe('lane_pause.pause_lane — a tree that forks under the pause', () => {
	it('stops a child forked after the first read, and each process once', () => {
		const tree: FakeTree = { matching: [CHILD], children: { [CHILD]: [SHELL] } }
		const stopped: Array<number> = []
		const signal = vi.fn((pid: number) => {
			stopped.push(pid)
			if (pid === SHELL) tree.children[SHELL] = [LATE_CHILD]

			return true
		})
		const probes = { ...probes_over(tree, []), signal }

		expect(lane_pause.pause_lane(TARGET, probes).signalled).toStrictEqual([
			CHILD,
			SHELL,
			LATE_CHILD,
		])
		expect(stopped).toStrictEqual([CHILD, SHELL, LATE_CHILD])
	})

	it('gives up after its round limit on a tree that keeps forking', () => {
		const tree: FakeTree = { matching: [CHILD], children: {} }
		const fork = { next: LATE_CHILD }
		const signal = vi.fn((pid: number) => {
			fork.next += 1
			tree.children[pid] = [fork.next]

			return true
		})
		const paused = lane_pause.pause_lane(TARGET, { ...probes_over(tree, []), signal })

		expect(paused.signalled).toHaveLength(lane_pause.PAUSE_ROUNDS)
	})
})

describe('lane_pause.resume_lane', () => {
	it('continues the whole tree, the caller’s own ancestry spared', () => {
		const signalled: Array<Signalled> = []
		const tree = { matching: [OWN_PARENT, CHILD], children: { [CHILD]: [SHELL] } }
		const resumed = lane_pause.resume_lane(TARGET, probes_over(tree, signalled))

		expect(resumed).toStrictEqual({ signalled: [CHILD, SHELL], ended: [] })
		expect(signalled.every(({ name }) => name === 'SIGCONT')).toBe(true)
	})
})

describe('lane_pause.open_lanes', () => {
	it('names every open lane by its issue and directory, as `--all` targets them', async () => {
		const other = { ...LANE, issue: OTHER.issue, directory: OTHER.directory }

		vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([other, LANE])

		expect(await lane_pause.open_lanes()).toStrictEqual([OTHER, TARGET])
	})
})
