import { describe, expect, it } from 'vitest'
import { review_agent_type } from './review-agent-type'

// joshuafolkken/kit#2297: `chain-rule.md` names the `/code-review` subagent's agent type, and it is a
// real Claude Code type rather than a plausible invention like `code-reviewer`. A run that read no name
// guessed one and received `Agent type not found`.

describe('chain-rule.md names the review agent type', () => {
	it('names an agent type at all', () => {
		expect(review_agent_type.named_agent_type()).toBeDefined()
	})

	it('names a real Claude Code agent type', () => {
		expect(review_agent_type.names_known_type()).toBe(true)
	})

	it('names general-purpose, the type that carries every tool', () => {
		expect(review_agent_type.named_agent_type()).toBe('general-purpose')
	})
})

describe('review_agent_type.names_known_type', () => {
	it('rejects an invented type name', () => {
		expect(review_agent_type.names_known_type('use the `code-reviewer` agent type')).toBe(false)
	})

	it('rejects a document that names none', () => {
		expect(review_agent_type.names_known_type('launch the subagent with the brief')).toBe(false)
	})
})
