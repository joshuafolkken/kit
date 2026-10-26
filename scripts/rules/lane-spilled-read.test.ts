import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { lane_spilled_read } from './lane-spilled-read'

// joshuafolkken/kit#5040: a lane child reading a spilled Bash result back whole put the largest single
// result of a cut session into its context. **Both directions matter**: a row silent in a lane leaves
// the spill read whole, and one that fires on a narrowed read or outside a lane takes a needed read away.

const RULE_ID = 'lane-spilled-read'
const SPILLED =
	'/Users/someone/.claude/projects/-Users-someone-kit-lanes-5040/session/tool-results/b3mcr32i7.txt'
const SOURCE = '/Users/someone/kit/scripts/rules/delivered-rules.ts'
const PAGE = 40
const is_lane_child = true
const is_not_lane_child = false

function read_of(file_path: string, page: Record<string, number> = {}): GuardedCall {
	return { name: 'Read', input: { file_path, ...page } }
}

const WHOLE_SPILL = read_of(SPILLED)
const LIMITED_SPILL = read_of(SPILLED, { limit: PAGE })
const OFFSET_SPILL = read_of(SPILLED, { offset: PAGE })
const GREP_SPILL: GuardedCall = { name: 'Bash', input: { command: `grep -n entry ${SPILLED}` } }

describe('lane_spilled_read.is_whole_spilled_read', () => {
	it("refuses a lane child's whole Read of a spilled result", () => {
		expect(lane_spilled_read.is_whole_spilled_read(WHOLE_SPILL, is_lane_child)).toBe(true)
	})

	it.each([
		['a limit', LIMITED_SPILL],
		['an offset', OFFSET_SPILL],
		['another file', read_of(SOURCE)],
		['a grep over the spill', GREP_SPILL],
		['an input that is not a record', { name: 'Read', input: SPILLED }],
	])('passes a lane child reading with %s', (_label, call) => {
		expect(lane_spilled_read.is_whole_spilled_read(call, is_lane_child)).toBe(false)
	})

	it('passes the same whole read outside a lane child', () => {
		expect(lane_spilled_read.is_whole_spilled_read(WHOLE_SPILL, is_not_lane_child)).toBe(false)
	})
})

describe('the row rule:value scores', () => {
	it('reaches every Read of a spilled result, whole or narrowed', () => {
		expect(lane_spilled_read.reaches_spilled_result(WHOLE_SPILL)).toBe(true)
		expect(lane_spilled_read.reaches_spilled_result(LIMITED_SPILL)).toBe(true)
		expect(lane_spilled_read.reaches_spilled_result(read_of(SOURCE))).toBe(false)
	})

	it('counts a narrowed Read as kept and a whole one as not', () => {
		expect(lane_spilled_read.keeps_narrowed_read(LIMITED_SPILL)).toBe(true)
		expect(lane_spilled_read.keeps_narrowed_read(WHOLE_SPILL)).toBe(false)
	})

	it('is one delivered row that declares both compliance tests and refuses every occurrence', () => {
		const rows = delivered_rules.DELIVERED_RULES.filter((rule) => rule.id === RULE_ID)

		expect(rows).toHaveLength(1)
		expect(rows[0]?.keeps).toBeDefined()
		expect(rows[0]?.reaches).toBeDefined()
		expect(lane_spilled_read.ROW.decide()).toBe(true)
	})

	it('hands over the narrowed read in its refusal', () => {
		expect(lane_spilled_read.LANE_SPILLED_READ_REASON).toContain('grep -n')
		expect(lane_spilled_read.LANE_SPILLED_READ_REASON).toContain('sed -n')
	})
})
