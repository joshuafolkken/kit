import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { run_park } from '#scripts/run/park/run-park'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_park } from './lane-park'
import { stop_rule_rows } from './stop-rule-rows'
import { stop_rules } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

// joshuafolkken/kit#8956: a lane child handed its stop back to the parent with nothing on the Issue,
// so a person had to ask again why it stopped and what to do next.

const ISSUE = '8956'
const DIRECTORY = 'lane-stop-park-checkout'
const PLACE = { directory: DIRECTORY, source: { [lane_child_marker.KEY]: ISSUE } }
const { context } = stop_rules_fixture

describe('lane_park.is_unrecorded_end', () => {
	beforeEach(() => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
		vi.spyOn(lane_handoff, 'is_handed_off').mockReturnValue(false)
		vi.spyOn(run_park, 'is_parked_sync').mockReturnValue(false)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reads an unparked child with no succeeded ship as an unrecorded end', () => {
		const succeeded = vi.spyOn(lane_handoff, 'is_ship_succeeded').mockReturnValue(false)

		expect(lane_park.is_unrecorded_end(PLACE)).toBe(true)
		expect(succeeded).toHaveBeenCalledWith(ISSUE, DIRECTORY, 0)
	})

	it('reads a child whose ship succeeded as recorded', () => {
		vi.spyOn(lane_handoff, 'is_ship_succeeded').mockReturnValue(true)

		expect(lane_park.is_unrecorded_end(PLACE)).toBe(false)
	})

	it('reads a parked child as recorded, without probing the ship', () => {
		vi.spyOn(run_park, 'is_parked_sync').mockReturnValue(true)
		const succeeded = vi.spyOn(lane_handoff, 'is_ship_succeeded')

		expect(lane_park.is_unrecorded_end(PLACE)).toBe(false)
		expect(succeeded).not.toHaveBeenCalled()
	})

	it('reads a session that is no lane child as recorded', () => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(false)

		expect(lane_park.is_unrecorded_end(PLACE)).toBe(false)
	})
})

describe('stop_rules.stop_outcome — a lane child ending unrecorded', () => {
	it('refuses the stop, naming the fields the Issue lacks', () => {
		const { reason, actions } = stop_rules.stop_outcome(
			context({ lane_child: true, lane_unrecorded: true }),
		)

		expect(reason).toBe(lane_park.LANE_STOP_PARK_REASON)
		expect(reason).toMatch(/reason, next action \(`--outcome`\), options or recommendation/u)
		expect(actions).toEqual([])
	})

	it.each([
		['the loop-breaker continuation', { stop_hook_active: true }],
		['a pre-gate cut', { cut_pending: true }],
	])('lets %s through', (_case, marks) => {
		const ending = context({ lane_child: true, lane_unrecorded: true, ...marks })

		expect(stop_rules.stop_outcome(ending).reason).toBeUndefined()
	})

	it('points at the one park body check rather than restating it', () => {
		expect(lane_park.LANE_STOP_PARK_REASON).toContain('scripts/run/park/run-park-body.ts')
	})
})

describe('stop_rules.stop_outcome — the park beside the other stop rules', () => {
	it('still releases the hold on the stop the loop-breaker lets through', () => {
		const ending = context({
			lane_child: true,
			lane_unrecorded: true,
			stop_hook_active: true,
			hold_issue: ISSUE,
			tree_clean: true,
			notified: true,
		})

		expect(stop_rules.stop_outcome(ending).actions).toEqual([{ kind: 'release', issue: ISSUE }])
	})

	it('joins the park with a filing offer, so neither is lost to the loop-breaker', () => {
		const offer = '起票するのが妥当だと考えます。起票してよければ言ってください。'
		const ending = context({
			lane_child: true,
			lane_unrecorded: true,
			session_lang: 'ja',
			message: offer,
		})
		const { reason } = stop_rules.stop_outcome(ending)

		expect(reason).toContain(lane_park.LANE_STOP_PARK_REASON)
		expect(reason).toContain(stop_rules.FILING_OFFER_REASON)
	})

	it('says nothing about a recorded lane child stop', () => {
		expect(stop_rules.stop_outcome(context({ lane_child: true })).reason).toBeUndefined()
	})
})

describe('stop_rule_rows.ROWS — the enumeration', () => {
	it('lists the lane-stop-park row', () => {
		expect(stop_rule_rows.ROWS.map((row) => row.id)).toContain('lane-stop-park')
	})
})
