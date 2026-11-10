import { readFileSync } from 'node:fs'
import path from 'node:path'
import { agent_consultation_model } from '#scripts/agent/agent-consultation-model'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#6901: the consultation main line runs on Opus and hands a design consultation to
// this unit on Fable. Matched as text, as `investigator-agent.test.ts` does.
const ROOT = process.cwd()
const AGENT_PATH = '.claude/agents/design-consultant.md'
const DELEGATION_PATH = '.claude/skills/workflow-commands/delegation.md'
const FRONTMATTER = /^---\n(?<body>[\s\S]*?)\n---\n/u

function read(relative: string): string {
	return readFileSync(path.join(ROOT, relative), 'utf8')
}

function frontmatter(): string {
	return FRONTMATTER.exec(read(AGENT_PATH))?.groups?.['body'] ?? ''
}

describe('design-consultant agent definition', () => {
	it('is named design-consultant', () => {
		expect(frontmatter()).toMatch(/^name: design-consultant$/mu)
	})

	it('runs on the Fable alias of the consultation model', () => {
		const alias = agent_consultation_model.CONSULTATION_ALIAS

		expect(alias).toBe('fable')
		expect(frontmatter()).toMatch(new RegExp(`^model: ${alias}$`, 'mu'))
	})

	it('is given no editing tool', () => {
		expect(frontmatter()).not.toMatch(/^tools:.*\b(?:Edit|Write|NotebookEdit)\b/mu)
	})
})

describe('design consultation handoff', () => {
	it('delegation.md names the unit and the Opus consultation main line', () => {
		const document = read(DELEGATION_PATH)

		expect(document).toContain(AGENT_PATH)
		expect(document).toContain(agent_consultation_model.CONSULTATION_MAIN_MODEL)
	})
})
