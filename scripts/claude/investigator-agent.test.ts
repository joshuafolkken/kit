import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The investigation unit's definition (joshuafolkken/kit#3139). joshuafolkken/kit#3394 pins it to
// `sonnet`: it only returns `file:line` citations the main line re-opens, so the parent's top-tier
// model was billed for work a cheaper one does, and `sonnet` over `haiku` keeps a wrong conclusion
// from costing the main line more than it saved. It ships through the plugin like the skills do, so
// the package `files` entry is guarded beside it. Matched as text, as `plugin-manifest.test.ts` does.
const ROOT = process.cwd()
const AGENT_PATH = '.claude/agents/investigator.md'
const DELEGATION_PATH = '.claude/skills/workflow-commands/delegation.md'
const FRONTMATTER = /^---\n(?<body>[\s\S]*?)\n---\n/u

function read(relative: string): string {
	return readFileSync(path.join(ROOT, relative), 'utf8')
}

function frontmatter(): string {
	return FRONTMATTER.exec(read(AGENT_PATH))?.groups?.['body'] ?? ''
}

describe('investigator agent definition', () => {
	it('is named investigator', () => {
		expect(frontmatter()).toMatch(/^name: investigator$/mu)
	})

	it('runs on a cheaper model than the parent', () => {
		expect(frontmatter()).toMatch(/^model: sonnet$/mu)
	})

	it('lowers the effort', () => {
		expect(frontmatter()).toMatch(/^effort: low$/mu)
	})

	it('is given no editing tool', () => {
		expect(frontmatter()).not.toMatch(/^tools:.*\b(?:Edit|Write|NotebookEdit)\b/mu)
	})
})

describe('package ships the agent definitions', () => {
	it('lists .claude/agents in files', () => {
		expect(read('package.json')).toContain('".claude/agents"')
	})
})

describe.each([AGENT_PATH, DELEGATION_PATH])('investigation handoff in %s', (relative) => {
	it('requests callable signatures and reusable test fixtures with citations', () => {
		const document = read(relative)

		expect(document).toContain('existing function signatures')
		expect(document).toContain('parameters, return types')
		expect(document).toContain('overloads')
		expect(document).toContain('existing test fixtures')
		expect(document).toContain('paths and setup or')
		expect(document).toContain('helper usage')
		expect(document).toContain('`file:line` citations')
	})

	it('asks for explicit absence instead of invented interfaces', () => {
		const document = read(relative)

		expect(document).toContain('does not apply or was not found')
		expect(document).toContain('invent')
	})
})
