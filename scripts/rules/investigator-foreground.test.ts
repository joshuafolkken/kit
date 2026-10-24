import { delegation_policy } from '#scripts/delegation/delegation-policy'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { investigator_foreground } from './investigator-foreground'

// joshuafolkken/kit#4721: a background `investigator` leaves its result queued until a later turn, so
// the row refuses that dispatch until it sets `run_in_background: false`. **Both directions matter**:
// a row silent on the background launch leaves the idle wait where it was, and one that speaks on a
// foreground dispatch or another agent type refuses a call that already did the right thing.

const PROMPT = 'Find where the guard reads the transcript'
const INVESTIGATOR = 'investigator'
const FOREGROUND_FIELD = '`run_in_background: false`'

function agent_call(
	input: Record<string, unknown>,
	name = 'Agent',
): { name: string; input: unknown } {
	return { name, input: { prompt: PROMPT, ...input } }
}

describe('investigator_foreground.is_background_investigator — the refusal', () => {
	it.each([
		['an investigator with no `run_in_background`', agent_call({ subagent_type: INVESTIGATOR })],
		[
			'an investigator launched in the background',
			agent_call({ subagent_type: INVESTIGATOR, run_in_background: true }),
		],
		['the consumer spelling', agent_call({ subagent_type: 'kit:investigator' })],
		['the published `Task` spelling', agent_call({ subagent_type: INVESTIGATOR }, 'Task')],
	])('refuses %s', (_case, call) => {
		expect(investigator_foreground.is_background_investigator(call)).toBe(true)
	})

	it.each([
		[
			'an investigator in the foreground',
			agent_call({ subagent_type: INVESTIGATOR, run_in_background: false }),
		],
		[
			'another agent type in the background',
			agent_call({ subagent_type: 'general-purpose', model: 'sonnet' }),
		],
		['an absent type', agent_call({})],
		['a type that only contains the name', agent_call({ subagent_type: 'investigator-x' })],
		['a call of another tool', { name: 'Bash', input: { command: 'ls' } }],
		['an input that is not an object', { name: 'Agent', input: PROMPT }],
	])('lets %s through', (_case, call) => {
		expect(investigator_foreground.is_background_investigator(call)).toBe(false)
	})
})

describe('investigator_foreground.ROW — delivered by the rule guard', () => {
	it('refuses every occurrence', () => {
		expect(investigator_foreground.ROW.decide()).toBe(true)
	})

	it('scores a foreground dispatch as kept and reaches every investigator dispatch', () => {
		const kept = agent_call({ subagent_type: INVESTIGATOR, run_in_background: false })
		const missed = agent_call({ subagent_type: INVESTIGATOR })

		expect(investigator_foreground.ROW.keeps(kept)).toBe(true)
		expect(investigator_foreground.ROW.keeps(missed)).toBe(false)
		expect(investigator_foreground.ROW.reaches(missed)).toBe(true)
	})

	it('is the one delivered row whose trigger fires on a background investigator', () => {
		const call = agent_call({ subagent_type: INVESTIGATOR })
		const claiming = delivered_rules.DELIVERED_RULES.filter((rule) => rule.is_trigger(call))

		expect(claiming.map((rule) => rule.id)).toEqual(['investigator-foreground'])
	})

	it('names the remedy and the document it points at', () => {
		expect(investigator_foreground.INVESTIGATOR_FOREGROUND_REASON).toContain(FOREGROUND_FIELD)
		expect(investigator_foreground.INVESTIGATOR_FOREGROUND_REASON).toContain('delegation.md')
	})

	// `run:prep` and the investigation guard print this step, so a run is told the field before it
	// dispatches rather than only on this row's refusal.
	it('is named by the investigation step the entry and the read guard print', () => {
		expect(delegation_policy.INVESTIGATION_STEP).toContain(FOREGROUND_FIELD)
	})
})
