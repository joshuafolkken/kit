import { describe, expect, it } from 'vitest'
import { init_actions } from './init-actions'

const NPMRC = '.npmrc'
const ESLINT = 'eslint.config.js'
const PRETTIER = 'prettier.config.js'
const PLAYWRIGHT = 'playwright.config.ts'
const VITE = 'vite.config.ts'
const TSCONFIG = 'tsconfig.json'
const CSPELL = 'cspell.config.yaml'
const LEFTHOOK = 'lefthook.yml'
const VSCODE_EXTENSIONS = '.vscode/extensions.json'
const VSCODE_SETTINGS = '.vscode/settings.json'

const COMMON_TAIL_DESTINATIONS = [TSCONFIG, CSPELL, LEFTHOOK, VSCODE_EXTENSIONS, VSCODE_SETTINGS]

const VANILLA_DESTINATIONS = [NPMRC, ESLINT, PRETTIER, PLAYWRIGHT, ...COMMON_TAIL_DESTINATIONS]

const SVELTEKIT_DESTINATIONS = [
	NPMRC,
	ESLINT,
	PRETTIER,
	PLAYWRIGHT,
	VITE,
	...COMMON_TAIL_DESTINATIONS,
]

describe('init_actions.build_file_actions', () => {
	it('returns the expected ordered destination list for vanilla projects', () => {
		const destinations = init_actions.build_file_actions('vanilla').map((action) => action.dest)

		expect(destinations).toEqual(VANILLA_DESTINATIONS)
	})

	it('inserts vite.config.ts only for sveltekit projects', () => {
		const destinations = init_actions.build_file_actions('sveltekit').map((action) => action.dest)

		expect(destinations).toEqual(SVELTEKIT_DESTINATIONS)
	})

	it('omits a merge handler only for playwright.config.ts', () => {
		const without_merge = init_actions
			.build_file_actions('sveltekit')
			.filter((action) => action.merge === undefined)
			.map((action) => action.dest)

		expect(without_merge).toEqual([PLAYWRIGHT])
	})

	it('produces a non-empty create output for every action', () => {
		for (const action of init_actions.build_file_actions('vanilla')) {
			expect(action.create().length).toBeGreaterThan(0)
		}
	})

	it('distributes the common extensions.json regardless of project style', () => {
		const extensions_create = (type: 'vanilla' | 'sveltekit'): string => {
			const action = init_actions
				.build_file_actions(type)
				.find((candidate) => candidate.dest === VSCODE_EXTENSIONS)

			expect(action).toBeDefined()

			return action?.create() ?? ''
		}

		expect(extensions_create('sveltekit')).toBe(extensions_create('vanilla'))
	})
})

describe('init_actions vscode settings distribution', () => {
	it('excludes kit-only SonarLint settings from the vanilla settings create output', () => {
		const action = init_actions
			.build_file_actions('vanilla')
			.find((candidate) => candidate.dest === VSCODE_SETTINGS)

		expect(action).toBeDefined()

		const content = action?.create() ?? ''

		expect(content).not.toContain('sonarlint')
		expect(content).toContain('editor.formatOnSave')
	})
})
