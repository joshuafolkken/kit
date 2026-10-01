import { describe, expect, it } from 'vitest'
import { kit_written_paths } from './kit-written-paths'

const CLAUDE_MD = 'CLAUDE.md'
const MANIFEST = 'package.json'
const PERSONAL_NOTE = 'employment-test.md'
const EDITOR_FILE = '.serena/project.yml'

describe('the paths the kit setup writes (#2816)', () => {
	it.each([
		CLAUDE_MD,
		'AGENTS.md',
		'.gitignore',
		'.github/workflows/ci.yml',
		'.claude/settings.json',
		'.vscode/settings.json',
		'sonar-project.properties',
		'prettier.config.mjs',
		'.aikido',
		MANIFEST,
		'pnpm-lock.yaml',
	])('counts %s as written by kit', (file_path) => {
		expect(kit_written_paths.is_kit_written(file_path)).toBe(true)
	})

	it.each([PERSONAL_NOTE, EDITOR_FILE, '.serena/.gitignore', 'main.lua', 'src/package.json'])(
		'leaves %s, which kit did not write, out',
		(file_path) => {
			expect(kit_written_paths.is_kit_written(file_path)).toBe(false)
		},
	)

	it('keeps only the paths kit wrote, in their order', () => {
		const changed = [PERSONAL_NOTE, CLAUDE_MD, EDITOR_FILE, MANIFEST]

		expect(kit_written_paths.select(changed)).toStrictEqual([CLAUDE_MD, MANIFEST])
	})
})
