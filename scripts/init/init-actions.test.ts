import { describe, expect, it } from 'vitest'
import { init_actions, type FileAction } from './init-actions'

const GITIGNORE = '.gitignore'
const NPMRC = '.npmrc'
const ESLINT = 'eslint.config.js'
const PRETTIER = 'prettier.config.js'
const PLAYWRIGHT = 'playwright.config.ts'
const TSCONFIG = 'tsconfig.json'
const CSPELL = 'cspell.config.yaml'
const LEFTHOOK = 'lefthook.yml'
const VSCODE_EXTENSIONS = '.vscode/extensions.json'
const VSCODE_SETTINGS = '.vscode/settings.json'

const COMMON_TAIL_DESTINATIONS = [TSCONFIG, CSPELL, LEFTHOOK, VSCODE_EXTENSIONS, VSCODE_SETTINGS]

const VANILLA_DESTINATIONS = [
	GITIGNORE,
	NPMRC,
	ESLINT,
	PRETTIER,
	PLAYWRIGHT,
	...COMMON_TAIL_DESTINATIONS,
]

describe('init_actions.build_file_actions', () => {
	it('returns the expected ordered destination list', () => {
		const destinations = init_actions.build_file_actions().map((action) => action.dest)

		expect(destinations).toEqual(VANILLA_DESTINATIONS)
	})

	it('omits a merge handler only for playwright.config.ts', () => {
		const without_merge = init_actions
			.build_file_actions()
			.filter((action) => action.merge === undefined)
			.map((action) => action.dest)

		expect(without_merge).toEqual([PLAYWRIGHT])
	})

	it('produces a non-empty create output for every action', () => {
		for (const action of init_actions.build_file_actions()) {
			expect(action.create().length).toBeGreaterThan(0)
		}
	})
})

function find_gitignore_action(): FileAction | undefined {
	return init_actions.build_file_actions().find((action) => action.dest === GITIGNORE)
}

describe('init_actions gitignore distribution', () => {
	it('creates from the kit template with core patterns', () => {
		const action = find_gitignore_action()

		expect(action).toBeDefined()
		expect(action?.create()).toContain('node_modules')
	})

	it('union-merges an existing file — consumer line kept, kit entry appended', () => {
		const action = find_gitignore_action()
		const merged = action?.merge?.('node_modules\n.audio/\n') ?? ''

		expect(merged).toContain('.audio/')
		expect(merged).toContain('.DS_Store')
	})
})

describe('init_actions extensions.json distribution', () => {
	it('distributes the common extensions.json', () => {
		const action = init_actions
			.build_file_actions()
			.find((candidate) => candidate.dest === VSCODE_EXTENSIONS)

		expect(action).toBeDefined()
		expect((action?.create() ?? '').length).toBeGreaterThan(0)
	})
})

describe('init_actions vscode settings distribution', () => {
	it('excludes kit-only SonarLint settings from the settings create output', () => {
		const action = init_actions
			.build_file_actions()
			.find((candidate) => candidate.dest === VSCODE_SETTINGS)

		expect(action).toBeDefined()

		const content = action?.create() ?? ''

		expect(content).not.toContain('sonarlint')
		expect(content).toContain('editor.formatOnSave')
	})
})
