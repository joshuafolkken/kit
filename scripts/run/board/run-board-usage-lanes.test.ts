import { describe, expect, it, vi } from 'vitest'
import { run_board_usage_lanes, type DirectoryRead, type LaneLookup } from './run-board-usage-lanes'

// joshuafolkken/kit#4359: a lane's eslint ran at 130% CPU while the board drew its lane at 0.1 — the
// process's working directory went unanswered once and was remembered as being in no lane.

const { lanes_for } = run_board_usage_lanes
const ROOT = '/Users/me/Development/.kit-lanes'
const LANE = `${ROOT}/4346`
const OUTSIDE = '/Users/me/Development/kit'
// A lane's node (1) runs an eslint (2), which runs a worker (3); 4 is outside every lane.
const CHAIN = new Map([
	[1, 0],
	[2, 1],
	[3, 2],
	[4, 0],
])
// Two processes re-parented to pid 0, each traceable by its own directory alone.
const ORPHANS = new Map([
	[2, 0],
	[4, 0],
])

// Each lookup's answer in turn, `undefined` for one cut short before answering any.
function lookup_of(
	...answers: Array<ReadonlyMap<number, string> | DirectoryRead | undefined>
): LaneLookup {
	function read_of(answer: (typeof answers)[number]): DirectoryRead {
		if (answer === undefined) return { directories: new Map(), is_complete: false }

		return 'is_complete' in answer ? answer : { directories: answer, is_complete: true }
	}

	return {
		directories: vi.fn(async () => read_of(answers.length === 0 ? new Map() : answers.shift())),
		root: ROOT,
	}
}

describe('run_board_usage_lanes.lanes_for by ancestry', () => {
	it('counts a process whose directory went unanswered, or names no lane, in its nearest ancestor’s lane', async () => {
		const lookup = lookup_of(
			new Map([
				[1, LANE],
				[3, `${OUTSIDE}/packages/app`],
				[4, OUTSIDE],
			]),
		)
		const read = await lanes_for(undefined, CHAIN, lookup)

		expect(read.lanes).toStrictEqual(
			new Map([
				[1, '4346'],
				[2, '4346'],
				[3, '4346'],
				[4, undefined],
			]),
		)
	})

	it('recounts a remembered process in no lane once an ancestor’s lane is read', async () => {
		const lookup = lookup_of(
			{ directories: new Map([[3, OUTSIDE]]), is_complete: false },
			new Map([[1, LANE]]),
		)
		const first = await lanes_for(undefined, CHAIN, lookup)
		const second = await lanes_for(first, CHAIN, lookup)

		expect(first.lanes.get(3)).toBeUndefined()
		expect(lookup.directories).toHaveBeenNthCalledWith(2, [1, 2, 4])
		expect(second.lanes.get(3)).toBe('4346')
	})

	it('counts a process in no lane when no ancestor has one', async () => {
		const read = await lanes_for(undefined, new Map([[2, 1]]), lookup_of(new Map()))

		expect(read.lanes).toStrictEqual(new Map([[2, undefined]]))
	})
})

describe('run_board_usage_lanes.lanes_for after a lookup cut short', () => {
	it('asks again for the processes a lookup cut short was asked about, and only for them', async () => {
		const lookup = lookup_of(
			new Map([[4, OUTSIDE]]),
			undefined,
			new Map([[2, `${LANE}/node_modules/.bin`]]),
		)
		const first = await lanes_for(undefined, new Map([[4, 0]]), lookup)
		const second = await lanes_for(first, ORPHANS, lookup)
		const third = await lanes_for(second, ORPHANS, lookup)

		expect(second.unread).toStrictEqual(new Set([2]))
		expect(lookup.directories).toHaveBeenNthCalledWith(3, [2])
		expect(third.lanes.get(2)).toBe('4346')
		expect(third.unread.size).toBe(0)
	})

	// A non-root `lsof` never reads another user's process, so asking again would rerun it every second.
	it('remembers a process a finished lookup left out, rather than asking for it again', async () => {
		const lookup = lookup_of(new Map([[4, OUTSIDE]]))
		const first = await lanes_for(undefined, ORPHANS, lookup)

		await lanes_for(first, ORPHANS, lookup)

		expect(first.unread.size).toBe(0)
		expect(lookup.directories).toHaveBeenCalledTimes(1)
	})

	it('runs no lookup once every listed process has answered', async () => {
		const lookup = lookup_of(new Map([[1, LANE]]))
		const first = await lanes_for(undefined, new Map([[1, 0]]), lookup)

		await lanes_for(first, new Map([[1, 0]]), lookup)

		expect(lookup.directories).toHaveBeenCalledTimes(1)
	})
})

// joshuafolkken/kit#8922: a run in the root checkout sits under no lane directory; its hold names it.
const RUN = '8922'
const SESSION = 10
const TOOL = 11
const WORKER = 12
const SIBLING = 20
const GONE = 99
// The run's session (10) runs a tool (11), which runs a worker (12); 20 is a person's session.
const TREE = new Map([
	[SESSION, 0],
	[TOOL, SESSION],
	[WORKER, TOOL],
	[SIBLING, 0],
])
const ROOT_DIRECTORIES = new Map(
	[SESSION, TOOL, SIBLING].map((pid) => [pid, `${OUTSIDE}/packages`] as const),
)

function held_lookup(hold: { issue: string; pid: number } | undefined): LaneLookup {
	return { ...lookup_of(ROOT_DIRECTORIES), held: () => hold }
}

describe('run_board_usage_lanes.lanes_for with a run holding the checkout', () => {
	it('counts the hold’s session and its descendants in the run’s lane, not a sibling session', async () => {
		const read = await lanes_for(undefined, TREE, held_lookup({ issue: RUN, pid: SESSION }))

		expect(read.lanes).toStrictEqual(
			new Map([
				[SESSION, RUN],
				[TOOL, RUN],
				[WORKER, RUN],
				[SIBLING, undefined],
			]),
		)
		expect(read.held).toStrictEqual(new Set([SESSION, TOOL, WORKER]))
	})

	it('counts nothing through a hold whose session is no longer listed', async () => {
		const read = await lanes_for(undefined, TREE, held_lookup({ issue: RUN, pid: GONE }))

		expect(new Set(read.lanes.values())).toStrictEqual(new Set([undefined]))
		expect(read.held).toStrictEqual(new Set())
	})

	it('drops the held processes from the lane once the hold is released', async () => {
		const first = await lanes_for(undefined, TREE, held_lookup({ issue: RUN, pid: SESSION }))
		const second = await lanes_for(first, TREE, held_lookup(undefined))

		expect(new Set(second.lanes.values())).toStrictEqual(new Set([undefined]))
		expect(second.held).toStrictEqual(new Set())
	})
})

describe('run_board_usage_lanes.lanes_for with a hold beside a lane of its own', () => {
	it('keeps the lanes a reading with no held set remembered', async () => {
		const before = { lanes: new Map([[SESSION, RUN]]), unread: new Set<number>() }
		const read = await lanes_for(before, TREE, held_lookup(undefined))

		expect(read.lanes.get(WORKER)).toBe(RUN)
	})

	it('keeps a held session working in a lane’s directory in that lane', async () => {
		const lookup = {
			...lookup_of(new Map([[SESSION, LANE]])),
			held: () => ({ issue: RUN, pid: SESSION }),
		}
		const read = await lanes_for(undefined, TREE, lookup)

		expect(read.lanes.get(SESSION)).toBe('4346')
		expect(read.lanes.get(WORKER)).toBe('4346')
		expect(read.held).toStrictEqual(new Set())
	})
})

// Under sustained load every lookup may be cut short; asking every process again would never finish.
describe('run_board_usage_lanes.lanes_for after a lookup cut short partway', () => {
	it('keeps what it did answer, and asks again for the rest alone', async () => {
		const lookup = lookup_of({ directories: new Map([[2, LANE]]), is_complete: false })
		const first = await lanes_for(undefined, ORPHANS, lookup)

		await lanes_for(first, ORPHANS, lookup)

		expect(first.lanes.get(2)).toBe('4346')
		expect(first.unread).toStrictEqual(new Set([4]))
		expect(lookup.directories).toHaveBeenNthCalledWith(2, [4])
	})
})
