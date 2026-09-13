import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The five skill directories ship as the `kit` Claude Code plugin instead of being copied
// (joshuafolkken/kit#1879). These guards keep the two manifests and their package-`files` coverage in
// place, since a consumer receives the skills only through them. Content is matched as text rather
// than parsed to stay within the no-`any` rule the JSON parse would otherwise trip.
const ROOT = process.cwd()
const SKILLS = ['workflow-commands', 'epic-commands', 'dependency-update', 'verify-ui', 'diag']
const NAME_KIT = '"name": "kit"'

function read(relative: string): string {
	return readFileSync(path.join(ROOT, relative), 'utf8')
}

describe('kit plugin manifest', () => {
	it('declares a plugin named kit at the .claude root', () => {
		expect(read('.claude/.claude-plugin/plugin.json')).toContain(NAME_KIT)
	})

	it.each(SKILLS)('ships the %s skill for the plugin to discover', (skill) => {
		expect(existsSync(path.join(ROOT, '.claude', 'skills', skill, 'SKILL.md'))).toBe(true)
	})
})

describe('kit plugin marketplace', () => {
	const marketplace = read('.claude-plugin/marketplace.json')

	it('names the marketplace kit', () => {
		expect(marketplace).toContain(NAME_KIT)
	})

	it('sources the plugin at the .claude plugin root', () => {
		expect(marketplace).toContain('"source": "./.claude"')
	})
})

describe('package ships the plugin manifests', () => {
	const package_json = read('package.json')

	it.each(['.claude/.claude-plugin', '.claude-plugin'])('lists %s in files', (entry) => {
		expect(package_json).toContain(`"${entry}"`)
	})
})
