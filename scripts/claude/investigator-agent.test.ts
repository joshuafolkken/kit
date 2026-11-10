import { readFileSync } from 'node:fs'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
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
const PINNED_ALIAS = /^claude-(?<alias>[a-z]+)-/u

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

	// joshuafolkken/kit#5944: the guard names the profile's model, the Agent tool dispatches on this
	// alias — the profile's pinned id is the one source, the alias follows it.
	it('runs on the alias of the profile investigation model', () => {
		const pinned = agent_role_profile.investigation_model('anthropic', {})
		const alias = PINNED_ALIAS.exec(pinned)?.groups?.['alias']

		expect(alias).toBe('sonnet')
		expect(frontmatter()).toMatch(new RegExp(`^model: ${alias ?? ''}$`, 'mu'))
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

// joshuafolkken/kit#6094: the agent definition is the single source of what the unit returns;
// delegation.md points to it rather than restating it.
describe('investigation handoff', () => {
	it('delegation.md points to the agent definition for what the unit returns', () => {
		expect(read(DELEGATION_PATH)).toContain(AGENT_PATH)
	})

	it('requests callable signatures and reusable test fixtures with citations', () => {
		const document = read(AGENT_PATH)

		expect(document).toContain('existing function signatures')
		expect(document).toContain('parameters, return types')
		expect(document).toContain('overloads')
		expect(document).toContain('existing test fixtures')
		expect(document).toContain('paths and setup or')
		expect(document).toContain('helper usage')
		expect(document).toContain('`file:line` citations')
	})

	it('asks for explicit absence instead of invented interfaces', () => {
		const document = read(AGENT_PATH)

		expect(document).toContain('does not apply or was not found')
		expect(document).toContain('invent')
	})

	// joshuafolkken/kit#7045: the unit's reply is a top source of long outputs, so its shape is capped.
	it('caps the reply length and shape', () => {
		const document = read(AGENT_PATH)

		expect(document).toContain('Keep the reply within 60 lines')
		expect(document).toContain('one bullet per claim with its citations')
	})
})
