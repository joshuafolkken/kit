import { describe, expect, it } from 'vitest'
import { distributed_files } from './distributed-files'

const LEFTHOOK = 'lefthook.yml'
const ESLINT_CONFIG = 'eslint.config.js'
const PREPARE_SCRIPT = 'scripts.prepare'
const BASIC_FILES = [
	'CLAUDE.md',
	'AGENTS.md',
	'GEMINI.md',
	'prettier.config.mjs',
	'.vscode/settings.json',
	'.github/pull_request_template.md',
	'.pnpmfile.mjs',
]

function destinations(profile: 'basic' | 'full'): Array<string> {
	return distributed_files.list(profile).map((file) => file.dest)
}

function manifest(profile: 'basic' | 'full'): unknown {
	return JSON.parse(distributed_files.kit_manifest(profile))
}

describe('list', () => {
	it('names the files the basic profile writes, whatever the project holds today', () => {
		expect(destinations('basic')).toStrictEqual(expect.arrayContaining(BASIC_FILES))
	})

	it('leaves the full-only tooling out of the basic list', () => {
		const basic = destinations('basic')

		expect(basic).not.toContain(LEFTHOOK)
		expect(basic).not.toContain(ESLINT_CONFIG)
	})

	it('adds the full tooling for the full profile', () => {
		expect(destinations('full')).toStrictEqual(
			expect.arrayContaining([LEFTHOOK, ESLINT_CONFIG, '.claude/settings.json', 'CLAUDE.md']),
		)
	})

	it('leaves out the ignore file, so it can never be removed', () => {
		expect([...destinations('basic'), ...destinations('full')]).not.toContain('.gitignore')
	})

	it('carries the CLAUDE.md kit writes into a project without one', () => {
		const claude_md = distributed_files.list('basic').find((file) => file.dest === 'CLAUDE.md')

		expect(claude_md?.distributed).toContain(
			'@node_modules/@joshuafolkken/kit/dist/CLAUDE.basic.md',
		)
	})
})

describe('kit_manifest', () => {
	it('names the entries the basic merge adds to a new manifest', () => {
		expect(manifest('basic')).toMatchObject({
			private: true,
			scripts: { josh: 'josh' },
			josh: { profile: 'basic' },
		})
	})

	it('names the git hook script only for the full profile', () => {
		expect(manifest('full')).toHaveProperty(PREPARE_SCRIPT)
		expect(manifest('basic')).not.toHaveProperty(PREPARE_SCRIPT)
	})
})
