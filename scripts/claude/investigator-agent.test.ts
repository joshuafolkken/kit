import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The investigation unit's definition (joshuafolkken/kit#3139). The model is inherited from the parent
// on purpose — the user's instruction was to lower the effort and keep the model — so a `model:` key
// is a regression, not a tuning choice. It ships through the plugin like the skills do, so the package
// `files` entry is guarded beside it. Matched as text, as `plugin-manifest.test.ts` does.
const ROOT = process.cwd()
const AGENT_PATH = '.claude/agents/investigator.md'
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

	it('inherits the model from the parent rather than naming one', () => {
		expect(frontmatter()).not.toMatch(/^model:/mu)
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
