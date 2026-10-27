import { readFileSync } from 'node:fs'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { describe, expect, it } from 'vitest'

// The review's agent type (joshuafolkken/kit#4715). A `general-purpose` review agent loaded the
// `/code-review` skill, which forked a second agent that read the same diff and brief again, so the
// definition carries no tool that opens a nested agent. Matched as text, as `investigator-agent.test.ts`
// does.
const AGENT_PATH = '.claude/agents/reviewer.md'
// joshuafolkken/kit#5106: the Agent tool passes no effort, so an in-session round takes it from the
// definition's frontmatter — round 1 from `reviewer`, the verification pass from its own definition.
const VERIFICATION_PATH = '.claude/agents/reviewer-verification.md'
const FENCE = '\n---\n'

// The text before the closing frontmatter fence, and the instructions after it.
function definition(file: string): { head: string; body: string } {
	const text = readFileSync(path.join(process.cwd(), file), 'utf8')
	const fence = text.indexOf(FENCE)

	return { head: text.slice(0, fence), body: text.slice(fence + FENCE.length) }
}

function frontmatter(file: string = AGENT_PATH): string {
	return definition(file).head
}

function effort_line(effort: string): RegExp {
	return new RegExp(`^effort: ${effort}$`, 'mu')
}

describe('reviewer agent definition', () => {
	it('is named reviewer', () => {
		expect(frontmatter()).toMatch(/^name: reviewer$/mu)
	})

	it('is given no tool that opens a nested agent', () => {
		expect(frontmatter()).toMatch(/^tools: /mu)
		expect(frontmatter()).not.toMatch(/^tools:.*\b(?:Agent|Task|Skill)\b/mu)
	})

	it('can edit, so a --fix review applies its findings', () => {
		expect(frontmatter()).toMatch(/^tools:.*\bEdit\b.*\bWrite\b/mu)
	})

	it('reviews at the round-1 effort the reviewer profile names', () => {
		expect(frontmatter()).toMatch(effort_line(agent_role_profile.DEFAULT_PROFILES.reviewer.effort))
		expect(frontmatter()).toMatch(effort_line('medium'))
	})
})

describe('reviewer-verification agent definition', () => {
	it('is named reviewer-verification', () => {
		expect(frontmatter(VERIFICATION_PATH)).toMatch(/^name: reviewer-verification$/mu)
	})

	it('reviews at the effort the verification profile names', () => {
		const { effort } = agent_role_profile.VERIFICATION_PROFILES.anthropic

		expect(frontmatter(VERIFICATION_PATH)).toMatch(effort_line(effort))
		expect(frontmatter(VERIFICATION_PATH)).toMatch(effort_line('high'))
	})

	it('carries the reviewer tools and instructions unchanged', () => {
		const tools = /^tools: .*$/mu

		expect(tools.exec(frontmatter(VERIFICATION_PATH))?.[0]).toBe(tools.exec(frontmatter())?.[0])
		expect(definition(VERIFICATION_PATH).body).toBe(definition(AGENT_PATH).body)
	})
})
