import { readFileSync } from 'node:fs'
import path from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface LefthookCommand {
	run?: string
	glob?: string
}

interface LefthookHook {
	commands?: Record<string, LefthookCommand>
}

type LefthookConfig = Record<string, LefthookHook>

const SVELTEKIT_LEFTHOOK = path.join('lefthook', 'sveltekit.yml')
const BASE_LEFTHOOK = path.join('lefthook', 'base.yml')
const VANILLA_LEFTHOOK = path.join('lefthook', 'vanilla.yml')
const PRE_COMMIT = 'pre-commit'
const PRE_PUSH = 'pre-push'
const TEST_E2E = 'test-e2e'
const CSPELL = 'cspell'
// lefthook resolves a nested `extends` from the consumer git root, so kit presets must reference
// base by this root-relative node_modules path — not the file-relative `./base.yml` that lefthook
// silently drops in consumers (kit#629).
const ROOT_RELATIVE_BASE = 'node_modules/@joshuafolkken/kit/lefthook/base.yml'
const FILE_RELATIVE_BASE = './base.yml'

function load_config(relative_path: string): LefthookConfig {
	const content = readFileSync(path.resolve(process.cwd(), relative_path), 'utf8')

	return load(content) as LefthookConfig
}

function load_extends(relative_path: string): ReadonlyArray<string> {
	const content = readFileSync(path.resolve(process.cwd(), relative_path), 'utf8')
	const parsed = load(content) as { extends?: ReadonlyArray<string> }

	return parsed.extends ?? []
}

function load_test_e2e_command(relative_path: string): LefthookCommand | undefined {
	return load_config(relative_path)[PRE_PUSH]?.commands?.[TEST_E2E]
}

function load_cspell_command(relative_path: string): LefthookCommand | undefined {
	return load_config(relative_path)[PRE_COMMIT]?.commands?.[CSPELL]
}

describe('lefthook/sveltekit.yml pre-push e2e gate', () => {
	const test_e2e = load_test_e2e_command(SVELTEKIT_LEFTHOOK)

	it('defines a test-e2e pre-push command', () => {
		expect(test_e2e).toBeDefined()
	})

	it('routes through the guarded josh test:e2e command', () => {
		expect(test_e2e?.run).toBe('pnpm josh test:e2e')
	})

	it('does not invoke playwright directly so the optional peer stays optional', () => {
		expect(test_e2e?.run).not.toContain('playwright test')
	})
})

describe.each([
	['lefthook/sveltekit.yml', SVELTEKIT_LEFTHOOK],
	['lefthook/base.yml', BASE_LEFTHOOK],
])('%s pre-commit cspell glob', (_label, relative_path) => {
	const cspell = load_cspell_command(relative_path)

	it('defines a cspell pre-commit command', () => {
		expect(cspell).toBeDefined()
	})

	it('includes .properties so kit-generated sonar-project.properties is checked locally like CI', () => {
		expect(cspell?.glob).toContain('properties')
	})
})

describe('lefthook/vanilla.yml base extends resolution (kit#629)', () => {
	const extends_list = load_extends(VANILLA_LEFTHOOK)

	it('references kit base by a root-relative node_modules path so it resolves in consumers', () => {
		expect(extends_list).toContain(ROOT_RELATIVE_BASE)
	})

	it('does not use the file-relative ./base.yml form that lefthook silently drops in consumers', () => {
		expect(extends_list).not.toContain(FILE_RELATIVE_BASE)
	})
})
