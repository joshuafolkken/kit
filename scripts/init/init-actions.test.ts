import { describe, expect, it, vi } from 'vitest'
import { init_actions, type FileAction } from './init-actions'
import type { ProjectShape } from './project-profile'

// The real builder reads this checkout's own `.claude/settings.json`, which wires the hook and so
// yields nothing; a fixed action keeps the destination lists independent of the checkout.
vi.mock('./session-language-environment', () => ({
	session_language_environment: {
		build_session_lang_actions: () => [
			{ dest: '.env', create: () => 'JOSH_SESSION_LANG=en\n', merge: (text: string) => text },
		],
	},
}))

const GITIGNORE = '.gitignore'
const ESLINT = 'eslint.config.js'
const PRETTIER = 'prettier.config.js'
const BASIC_PRETTIER = 'prettier.config.mjs'
const PLAYWRIGHT = 'playwright.config.ts'
const TSCONFIG = 'tsconfig.json'
const CSPELL = 'cspell.config.yaml'
const LEFTHOOK = 'lefthook.yml'
const SECRETLINT = '.secretlintrc.json'
const VSCODE_EXTENSIONS = '.vscode/extensions.json'
const VSCODE_SETTINGS = '.vscode/settings.json'
const ENV_FILE = '.env'

const COMMON_TAIL_DESTINATIONS = [
	TSCONFIG,
	CSPELL,
	LEFTHOOK,
	SECRETLINT,
	VSCODE_EXTENSIONS,
	VSCODE_SETTINGS,
	'.vscode/tasks.json',
	ENV_FILE,
]

const VANILLA_DESTINATIONS = [GITIGNORE, ESLINT, PRETTIER, PLAYWRIGHT, ...COMMON_TAIL_DESTINATIONS]

describe('init_actions.build_file_actions', () => {
	it('returns the expected ordered destination list', () => {
		const destinations = init_actions.build_file_actions().map((action) => action.dest)

		expect(destinations).toEqual(VANILLA_DESTINATIONS)
	})

	// .secretlintrc.json joins playwright.config.ts as create-only: its rule list is
	// project-owned once written, so re-running init must not rewrite a customized one.
	it('omits a merge handler only for the create-only configs', () => {
		const without_merge = init_actions
			.build_file_actions()
			.filter((action) => action.merge === undefined)
			.map((action) => action.dest)

		expect(without_merge).toEqual([PLAYWRIGHT, SECRETLINT])
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

describe('init_actions tsconfig distribution', () => {
	// A project that already has a tsconfig reaches the merge handler, not create — without the
	// exclude merge there it would keep type-checking the generated Playwright report (#712).
	it('adds the generated-output exclude entries when merging an existing tsconfig', () => {
		const action = init_actions.build_file_actions().find((entry) => entry.dest === TSCONFIG)
		const merged = action?.merge?.('{ "exclude": ["legacy-vendor"] }\n') ?? ''

		expect(merged).toContain('legacy-vendor')
		expect(merged).toContain('playwright-report')
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

function shape(overrides: Partial<ProjectShape> = {}): ProjectShape {
	return {
		profile: 'basic',
		reason: 'test',
		has_web: false,
		has_typescript: false,
		has_git: false,
		has_github: false,
		...overrides,
	}
}

function merge_action(
	actions: ReadonlyArray<FileAction>,
	destination: string,
	content: string,
): string {
	const action = actions.find((candidate) => candidate.dest === destination)

	return action?.merge?.(content) ?? ''
}

describe('basic profile file actions', () => {
	it('keeps a Web-free, Git-free project minimal', () => {
		const destinations = init_actions.build_file_actions(shape()).map((action) => action.dest)

		expect(destinations).toEqual([VSCODE_EXTENSIONS])
	})

	it('adds Web formatting without Svelte or Playwright tooling', () => {
		const actions = init_actions.build_file_actions(shape({ has_web: true }))
		const destinations = actions.map((action) => action.dest)

		expect(destinations).toEqual([BASIC_PRETTIER, VSCODE_EXTENSIONS, VSCODE_SETTINGS])
		expect(actions.find((action) => action.dest === BASIC_PRETTIER)?.create()).toContain(
			'prettier/basic',
		)
	})
})

describe('basic profile merge and optional settings', () => {
	it('merges recommendations and preserves existing formatters', () => {
		const actions = init_actions.build_file_actions(shape({ has_web: true }))
		const extensions = merge_action(
			actions,
			VSCODE_EXTENSIONS,
			'{"recommendations":["custom.extension"]}',
		)
		const settings = merge_action(
			actions,
			VSCODE_SETTINGS,
			'{"[python]":{"editor.defaultFormatter":"python"}}',
		)

		expect(extensions).toContain('custom.extension')
		expect(settings).toContain('python')
	})

	it('separates Git and TypeScript from the profile', () => {
		const destinations = init_actions
			.build_file_actions(
				shape({
					has_git: true,
					has_typescript: true,
				}),
			)
			.map((action) => action.dest)

		expect(destinations).toEqual([GITIGNORE, TSCONFIG, VSCODE_EXTENSIONS])
	})
})
