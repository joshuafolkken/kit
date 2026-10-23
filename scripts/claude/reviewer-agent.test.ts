import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The review's agent type (joshuafolkken/kit#4715). A `general-purpose` review agent loaded the
// `/code-review` skill, which forked a second agent that read the same diff and brief again, so the
// definition carries no tool that opens a nested agent. Matched as text, as `investigator-agent.test.ts`
// does.
const AGENT_PATH = '.claude/agents/reviewer.md'
const FRONTMATTER = /^---\n(?<body>[\s\S]*?)\n---\n/u

function frontmatter(): string {
	const text = readFileSync(path.join(process.cwd(), AGENT_PATH), 'utf8')

	return FRONTMATTER.exec(text)?.groups?.['body'] ?? ''
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
})
