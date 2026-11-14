import { expect, test } from 'vitest'
import { backlog_measure_schema } from './backlog-measure-schema'

const BASE = { name: 'one-and-five', mode: 'cold', repetitions: 1, reads: [], free_lanes: 1 }
const INVALID = [{ repetitions: 0 }, { mode: 'hot' }, { name: '../live' }, { free_lanes: -1 }]

test.each(INVALID)('rejects invalid measurement conditions %j', (override) => {
	expect(backlog_measure_schema.scenario_schema.safeParse({ ...BASE, ...override }).success).toBe(
		false,
	)
})

test('keeps fixed replay inputs and supplies explicit empty side effect defaults', () => {
	const input = {
		...BASE,
		reads: [{ method: 'gh.repo_get_name_with_owner', args: [], value: 'o/r' }],
	}

	expect(backlog_measure_schema.scenario_schema.parse(input)).toMatchObject({
		reads: input.reads,
		live_get: [],
		in_flight: [],
		outcomes: {},
		memory_held: false,
	})
})
