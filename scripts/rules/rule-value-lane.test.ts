import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { lane_background } from './lane-background'
import { rule_value_fixture } from './rule-value-fixture'
import { stop_rules } from './stop-rules'

// joshuafolkken/kit#4961: the lane rules read `reached 0` while lane children were being refused and
// rewritten — the harness labels every deny, and the foreground rewrite's note was on no row.
const { context_line, reading_for, result_line, session, stop_line } = rule_value_fixture

const LANE_BACKGROUND = 'lane-background'
const HOOK_ERROR_LABEL = 'PreToolUse:Bash hook error: '
const LANE_RULES = delivered_rules.MEASURED_RULES.filter(
	(rule) => rule.id.startsWith('lane-') || rule.id === 'implementation-cut',
)

function lane_run(line: string): ReadonlyArray<ReadonlyArray<string>> {
	return [[`${session('ls')}\n${line}`]]
}

describe('rule_value.measure — what a lane child is delivered', () => {
	it.each(LANE_RULES.map((rule) => [rule.id, rule.reason]))(
		'counts a %s refusal written back behind the harness label',
		(id, reason) => {
			const reading = reading_for(id, lane_run(result_line(`${HOOK_ERROR_LABEL}${reason}`)))

			expect(reading.sessions).toBe(1)
			expect(reading.refusals).toBe(1)
		},
	)

	it('counts the foreground rewrite of a lone `josh ship` as a lane-background rewrite', () => {
		const reading = reading_for(
			LANE_BACKGROUND,
			lane_run(context_line(lane_background.FOREGROUND_NOTE)),
		)

		expect(reading.sessions).toBe(1)
		expect(reading.rewrites).toBe(1)
	})

	it('still reads a labelled dump of the enumeration as no refusal', () => {
		const dump = result_line(
			`${HOOK_ERROR_LABEL}import { lane_background } from './lane-background'`,
		)

		expect(reading_for(LANE_BACKGROUND, lane_run(dump)).refusals).toBe(0)
	})
})

// joshuafolkken/kit#4978: a run whose only delivery was a Stop-hook block read `reached 0`.
describe('rule_value.measure — what a Stop hook delivers to a lane child', () => {
	it.each([
		[LANE_BACKGROUND, lane_background.LANE_BACKGROUND_STOP_REASON],
		[LANE_BACKGROUND, lane_background.LANE_AGENT_STOP_REASON],
		['lane-interactive-ask', stop_rules.LANE_INDEX_REASON],
	])('counts a Stop-hook block as a %s refusal', (id, reason) => {
		const reading = reading_for(id, lane_run(stop_line(reason)))

		expect(reading.sessions).toBe(1)
		expect(reading.refusals).toBe(1)
	})

	it('reads no refusal from a prompt that is a Stop reason without the harness label', () => {
		const quoted = JSON.stringify({
			type: 'user',
			timestamp: rule_value_fixture.TIMESTAMP,
			message: { content: lane_background.LANE_BACKGROUND_STOP_REASON },
		})

		expect(reading_for(LANE_BACKGROUND, lane_run(quoted)).refusals).toBe(0)
	})
})
