import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { lane_state_record } from '#scripts/lane/lane-state-record'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { unit_lane_count } from './unit-lane-count'

// joshuafolkken/kit#6916: a lane waiting on a person, or over, opens no suite, so it holds no share of
// the machine. Its lane-state record says so; a lane with none keeps the place its directory gives it.

const REPOSITORY = 'repo'
const LANES_ROOT = '.repo-lanes'
const FIRST = '6682'
const SECOND = '6905'
const THIRD = '7001'

const make_directory = temporary_directory()

function probe_directory(): string {
	return make_directory('josh-unit-lane-count-test-')
}

interface LinkedLanes {
	checkout: string
	common: string
}

// Each lane a linked work tree of `<parent>/repo`, whose common git directory holds the records.
function linked_lanes(lanes: ReadonlyArray<string>): LinkedLanes {
	const parent = probe_directory()
	const common = path.join(parent, REPOSITORY, '.git')

	for (const issue of lanes) {
		const own = path.join(common, 'worktrees', issue)
		const lane = path.join(parent, LANES_ROOT, issue)

		mkdirSync(own, { recursive: true })
		mkdirSync(lane, { recursive: true })
		writeFileSync(path.join(own, 'commondir'), '../..\n')
		writeFileSync(path.join(lane, '.git'), `gitdir: ${own}\n`)
	}

	return { checkout: path.join(parent, REPOSITORY), common }
}

function write_record(directory: string, common: string, issue: string, body: string): void {
	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, lane_state_record.record_name(common, issue)), body)
}

function run_state(common: string): string {
	return path.join(common, 'josh', 'run-state')
}

function record_of(issue: string, state: string): string {
	return JSON.stringify({ issue, state, changed_at: '2026-11-10T00:00:00Z', changed_by: 'test' })
}

// joshuafolkken/kit#6682: the run count sees a lane only once its suite is in flight, so the first of
// several lanes took the whole machine. The live lanes divide it from the start.
describe('unit_lane_count.live_lane_count — lane directories', () => {
	const LANES = [FIRST, SECOND, THIRD]

	// A repository checkout beside its lanes root holding three lanes and two entries that are not lanes.
	function lanes_fixture(): string {
		const parent = probe_directory()

		for (const name of [...LANES, '.seat-locks', 'notes']) {
			mkdirSync(path.join(parent, LANES_ROOT, name), { recursive: true })
		}

		return parent
	}

	it('counts the issue-number directories under the lanes root, read from a main checkout', () => {
		const checkout = path.join(lanes_fixture(), REPOSITORY)

		expect(unit_lane_count.live_lane_count(checkout, {})).toBe(LANES.length)
	})

	it('counts the same lanes from inside one of them', () => {
		const lane = path.join(lanes_fixture(), LANES_ROOT, FIRST)

		expect(unit_lane_count.live_lane_count(lane, {})).toBe(LANES.length)
	})

	// No lanes root — CI, a repository that never opened a lane — leaves the division to the run count.
	it('answers no lane when the lanes root cannot be read', () => {
		const checkout = path.join(probe_directory(), REPOSITORY)

		expect(unit_lane_count.live_lane_count(checkout, {})).toBe(0)
	})
})

describe('unit_lane_count.live_lane_count — lane-state records', () => {
	it.each(['paused', 'human-review', 'ended'])('leaves out a lane whose record is %s', (state) => {
		const { checkout, common } = linked_lanes([FIRST, SECOND])

		write_record(run_state(common), common, FIRST, record_of(FIRST, state))

		expect(unit_lane_count.live_lane_count(checkout, {})).toBe(1)
	})

	it('counts an open or running lane and one with no record', () => {
		const { checkout, common } = linked_lanes([FIRST, SECOND, THIRD])

		write_record(run_state(common), common, FIRST, record_of(FIRST, 'open'))
		write_record(run_state(common), common, SECOND, record_of(SECOND, 'running'))

		expect(unit_lane_count.live_lane_count(checkout, {})).toBe(3)
	})

	it('counts a lane whose record cannot be read as one', () => {
		const { checkout, common } = linked_lanes([FIRST])

		write_record(run_state(common), common, FIRST, '{ not json')

		expect(unit_lane_count.live_lane_count(checkout, {})).toBe(1)
	})

	it('counts a lane directory that is no work tree', () => {
		const { checkout } = linked_lanes([])

		mkdirSync(path.join(path.dirname(checkout), LANES_ROOT, FIRST), { recursive: true })

		expect(unit_lane_count.live_lane_count(checkout, {})).toBe(1)
	})

	it('reads the records under the temp-root override the environment names', () => {
		const { checkout, common } = linked_lanes([FIRST])
		const override = probe_directory()

		write_record(path.join(override, 'josh-state'), common, FIRST, record_of(FIRST, 'paused'))

		expect(unit_lane_count.live_lane_count(checkout, { JOSH_TEMP_ROOT: override })).toBe(0)
	})
})

describe('unit_lane_count.live_lane_count — the asking lane', () => {
	it('counts the lane it is asked from whatever its record says', () => {
		const { common } = linked_lanes([FIRST, SECOND])
		const inside = path.join(path.dirname(path.dirname(common)), LANES_ROOT, FIRST)
		const idle = record_of(FIRST, lane_state_record.HUMAN_REVIEW)

		write_record(run_state(common), common, FIRST, idle)
		write_record(run_state(common), common, SECOND, record_of(SECOND, 'ended'))

		expect(unit_lane_count.live_lane_count(inside, {})).toBe(1)
	})
})
