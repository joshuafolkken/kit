import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { lane_state_record } from './lane-state-record'

const COMMON = '/repository/.git'
const ISSUE = '6916'

const make_directory = temporary_directory()

function state_root_with(state: string | undefined): string {
	const directory = make_directory('josh-lane-state-record-test-')

	if (state === undefined) return directory

	const record = { issue: ISSUE, state, changed_at: '2026-11-10T00:00:00Z', changed_by: 'test' }

	writeFileSync(
		path.join(directory, lane_state_record.record_name(COMMON, ISSUE)),
		JSON.stringify(record),
	)

	return directory
}

describe('lane_state_record.record_name', () => {
	it('names the record by its prefix, its common-directory key and its issue', () => {
		expect(lane_state_record.record_name(COMMON, ISSUE)).toMatch(
			/^josh-lane-state-[\da-f]{16}-6916\.json$/u,
		)
	})
})

describe('lane_state_record.is_idle', () => {
	it.each(['paused', 'human-review', 'ended'])('answers a %s lane idle', (state) => {
		expect(lane_state_record.is_idle(state_root_with(state), COMMON, ISSUE)).toBe(true)
	})

	it.each(['open', 'running'])('answers a %s lane in use', (state) => {
		expect(lane_state_record.is_idle(state_root_with(state), COMMON, ISSUE)).toBe(false)
	})

	it('answers a lane with no record in use', () => {
		expect(lane_state_record.is_idle(state_root_with(undefined), COMMON, ISSUE)).toBe(false)
	})

	it('answers a lane whose record names no known state in use', () => {
		expect(lane_state_record.is_idle(state_root_with('asleep'), COMMON, ISSUE)).toBe(false)
	})
})
