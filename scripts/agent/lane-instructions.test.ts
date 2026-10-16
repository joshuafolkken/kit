import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lane_instructions } from './lane-instructions'

const ROOT_CAUSE_ITEM = '- **Fix root causes.** Never a symptom.'
const RULES_FILE = 'CLAUDE.md'
const QUALITY_LIMITS = '### Quality limits'
const RULES = [
	'# Rules',
	'',
	'## Communication',
	'',
	'- **Ask first.** Only an interactive session can.',
	ROOT_CAUSE_ITEM,
	'',
	'## Git Rules',
	'',
	'- No commits unless asked.',
].join('\n')
const LANE = [
	'# Lane',
	'',
	'<!-- include: CLAUDE.md → "Fix root causes." -->',
	'',
	'<!-- include: CLAUDE.md → "Git Rules" -->',
].join('\n')
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const KIT_RULES = readFileSync(path.join(REPO_ROOT, RULES_FILE), 'utf8')
const IMPORTED_RULES = 'node_modules/@joshuafolkken/kit/dist/CLAUDE.md'
const AGENTS_FILE = 'AGENTS.md'

function checkout_with(rules: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'lane-instructions-'))

	writeFileSync(path.join(directory, RULES_FILE), rules)

	return directory
}

describe('lane instruction composition', () => {
	it('expands each include from CLAUDE.md and drops the rules it does not name', () => {
		const composed = lane_instructions.compose(LANE, RULES) ?? ''

		expect(composed).toContain(ROOT_CAUSE_ITEM)
		expect(composed).toContain('## Git Rules\n\n- No commits unless asked.')
		expect(composed).not.toContain('Ask first')
		expect(composed).not.toContain('<!-- include')
	})

	it('refuses the whole set when one include no longer resolves', () => {
		const renamed = LANE.replace('Git Rules', 'Version Control')

		expect(lane_instructions.compose(renamed, RULES)).toBeUndefined()
	})

	it('resolves every include of the shipped document against the repository CLAUDE.md', () => {
		const composed = lane_instructions.composed_in(REPO_ROOT, REPO_ROOT)

		expect(composed).toBeDefined()
		expect(composed).toContain(QUALITY_LIMITS)
		expect(composed).not.toContain('Explicit invocation required')
		expect(composed).not.toContain('Distinguish consultation from execution')
	})
})

function value_after(flags: ReadonlyArray<string>, flag: string): string {
	return flags[flags.indexOf(flag) + 1] ?? ''
}

function excludes_of(flags: ReadonlyArray<string>): unknown {
	return JSON.parse(value_after(flags, lane_instructions.SETTINGS_FLAG))
}

describe('lane instruction launch flags', () => {
	it('passes the composed set as a file and excludes the checkout CLAUDE.md and AGENTS.md', () => {
		const cwd = checkout_with(KIT_RULES)
		const flags = lane_instructions.flags(cwd)
		const prompt_file = value_after(flags, lane_instructions.PROMPT_FILE_FLAG)

		expect(readFileSync(prompt_file, 'utf8')).toContain(QUALITY_LIMITS)
		expect(lane_instructions.flags(cwd)).toEqual(flags)
		expect(excludes_of(flags)).toEqual({
			claudeMdExcludes: [path.join(cwd, RULES_FILE), path.join(cwd, AGENTS_FILE)],
		})
	})

	it('composes from the imported package copy and keeps the consumer CLAUDE.md loaded', () => {
		const cwd = checkout_with(`> Bootstrap note.\n\n@${IMPORTED_RULES}\n\n## Our own rule\n`)
		const package_copy = path.join(cwd, IMPORTED_RULES)

		mkdirSync(path.dirname(package_copy), { recursive: true })
		writeFileSync(package_copy, KIT_RULES)

		expect(excludes_of(lane_instructions.flags(cwd))).toEqual({
			claudeMdExcludes: [package_copy, path.join(cwd, AGENTS_FILE)],
		})
	})

	it('passes nothing, leaving CLAUDE.md loaded, when the set cannot be composed', () => {
		expect(lane_instructions.flags(checkout_with(RULES))).toEqual([])
	})

	it('reports the resident cost of both instruction sets', () => {
		expect(lane_instructions.resident_line(REPO_ROOT)).toMatch(
			/lane instructions [\d,]+ tok in place of CLAUDE\.md [\d,]+ tok/u,
		)
	})
})
