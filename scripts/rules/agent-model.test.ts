import { describe, expect, it } from 'vitest'
import { agent_model } from './agent-model'
import { delivered_rules } from './delivered-rules'

// joshuafolkken/kit#3927: a `general-purpose` subagent with no `model` inherits the parent's, so the
// row refuses that dispatch until it names one. **Both directions matter**: a row silent on the
// omission leaves the measured cost where it was, and one that speaks on a named type or a set model
// refuses a call that already chose its tier.

const PROMPT = 'Summarize the diff'
const SONNET = 'sonnet'
const GENERAL_PURPOSE = 'general-purpose'

function agent_call(
	input: Record<string, unknown>,
	name = 'Agent',
): { name: string; input: unknown } {
	return { name, input: { prompt: PROMPT, ...input } }
}

describe('agent_model.is_unnamed_model — the refusal', () => {
	it.each([
		['the general-purpose type with no model', agent_call({ subagent_type: GENERAL_PURPOSE })],
		['an absent type, the harness default', agent_call({})],
		['an empty model', agent_call({ subagent_type: GENERAL_PURPOSE, model: '' })],
		['the published `Task` spelling', agent_call({ subagent_type: GENERAL_PURPOSE }, 'Task')],
	])('refuses %s', (_case, call) => {
		expect(agent_model.is_unnamed_model(call)).toBe(true)
	})

	it.each([
		['a named model', agent_call({ subagent_type: GENERAL_PURPOSE, model: SONNET })],
		['an absent type with a model', agent_call({ model: SONNET })],
		[
			'a named agent type, whose definition carries its model',
			agent_call({ subagent_type: 'investigator' }),
		],
		[
			'the named `claude` type with no model, whose definition decides its model',
			agent_call({ subagent_type: 'claude' }),
		],
		['a `fork`, which inherits the parent by design', agent_call({ subagent_type: 'fork' })],
		['a call of another tool', { name: 'Bash', input: { command: 'ls' } }],
		['an input that is not an object', { name: 'Agent', input: PROMPT }],
	])('lets %s through', (_case, call) => {
		expect(agent_model.is_unnamed_model(call)).toBe(false)
	})
})

describe('agent_model.ROW — delivered by the rule guard', () => {
	it('refuses every occurrence', () => {
		expect(agent_model.ROW.decide()).toBe(true)
	})

	it('scores a named-model dispatch as kept and reaches every general-purpose dispatch', () => {
		const kept = agent_call({ subagent_type: GENERAL_PURPOSE, model: SONNET })
		const missed = agent_call({ subagent_type: GENERAL_PURPOSE })

		expect(agent_model.ROW.keeps(kept)).toBe(true)
		expect(agent_model.ROW.keeps(missed)).toBe(false)
		expect(agent_model.ROW.reaches(missed)).toBe(true)
	})

	// The only row that claims a subagent call, so no other row's reason is delivered in its place.
	it('is the one delivered row whose trigger fires on an unnamed-model dispatch', () => {
		const call = agent_call({ subagent_type: GENERAL_PURPOSE })
		const claiming = delivered_rules.DELIVERED_RULES.filter((rule) => rule.is_trigger(call))

		expect(claiming.map((rule) => rule.id)).toEqual(['agent-model'])
	})

	it('names the remedy and the document it points at', () => {
		expect(agent_model.AGENT_MODEL_REASON).toContain('`model`')
		expect(agent_model.AGENT_MODEL_REASON).toContain('delegation.md')
	})
})
