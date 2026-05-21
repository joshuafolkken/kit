import { describe, expect, it } from 'vitest'
import { init_logic_workspace } from './init-logic-workspace'

const TEMPLATE = 'packages:\n  - apps/*\n'
const EXISTING_WITH_APP = 'packages:\n  - app\n'

describe('init_logic_workspace.merge_workspace_yaml — empty existing', () => {
	it('returns template unchanged when existing is empty string', () => {
		expect(init_logic_workspace.merge_workspace_yaml('', TEMPLATE)).toBe(TEMPLATE)
	})

	it('returns template unchanged when existing is whitespace only', () => {
		expect(init_logic_workspace.merge_workspace_yaml('   \n', TEMPLATE)).toBe(TEMPLATE)
	})
})

describe('init_logic_workspace.merge_workspace_yaml — existing key overlaps with template', () => {
	it('returns existing content when all keys already match template keys', () => {
		const existing = EXISTING_WITH_APP

		expect(init_logic_workspace.merge_workspace_yaml(existing, TEMPLATE)).toBe(existing)
	})

	it('preserves user value in managed key instead of overwriting with template value', () => {
		const existing = EXISTING_WITH_APP

		const result = init_logic_workspace.merge_workspace_yaml(existing, TEMPLATE)

		expect(result).toContain('- app')
		expect(result).not.toContain('apps/*')
	})
})

describe('init_logic_workspace.merge_workspace_yaml — user keys not in template', () => {
	const EXISTING = 'packages:\n  - app\ncustom:\n  - src\n'
	const result = init_logic_workspace.merge_workspace_yaml(EXISTING, TEMPLATE)

	it('preserves existing key that is in both existing and template', () => {
		expect(result).toContain('packages:')
		expect(result).toContain('- app')
	})

	it('preserves user-only key that is not in the template', () => {
		expect(result).toContain('custom:')
	})

	it('preserves user block content under user-only key', () => {
		expect(result).toContain('- src')
	})
})

describe('init_logic_workspace.merge_workspace_yaml — additive: new template keys', () => {
	const MULTI_TEMPLATE = 'packages:\n  - apps/*\n\noverrides:\n  svelte: ^5\n'
	const SVELTE_OVERRIDE = 'svelte: ^5'

	it('adds template key that does not exist in existing', () => {
		const existing = EXISTING_WITH_APP

		const result = init_logic_workspace.merge_workspace_yaml(existing, MULTI_TEMPLATE)

		expect(result).toContain('overrides:')
		expect(result).toContain(SVELTE_OVERRIDE)
	})

	it('does not add template key that already exists in existing', () => {
		const existing = 'packages:\n  - app\noverrides:\n  react: ^18\n'

		const result = init_logic_workspace.merge_workspace_yaml(existing, MULTI_TEMPLATE)

		expect(result).toContain('react: ^18')
		expect(result).not.toContain(SVELTE_OVERRIDE)
	})
})

describe('init_logic_workspace.merge_workspace_yaml — deprecated key removal', () => {
	const DEPRECATED_KEY = 'onlyBuiltDependencies'

	it('returns template when existing has only deprecated key', () => {
		const existing = `${DEPRECATED_KEY}:\n  - esbuild\n`

		expect(init_logic_workspace.merge_workspace_yaml(existing, TEMPLATE)).toBe(TEMPLATE)
	})

	it('removes deprecated key and preserves other existing keys', () => {
		const existing = `packages:\n  - app\n${DEPRECATED_KEY}:\n  - old\n`

		const result = init_logic_workspace.merge_workspace_yaml(existing, TEMPLATE)

		expect(result).toContain('packages:')
		expect(result).not.toContain(DEPRECATED_KEY)
		expect(result).not.toContain('old')
	})

	it('removes deprecated key and adds missing template keys', () => {
		const multi_template = `${TEMPLATE}extras:\n  key: val\n`
		const existing = `packages:\n  - app\n${DEPRECATED_KEY}:\n  - old\n`

		const result = init_logic_workspace.merge_workspace_yaml(existing, multi_template)

		expect(result).toContain('extras:')
		expect(result).not.toContain(DEPRECATED_KEY)
	})
})
