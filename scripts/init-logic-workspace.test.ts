import { describe, expect, it } from 'vitest'
import { init_logic_workspace } from './init-logic-workspace'

const TEMPLATE = 'packages:\n  - apps/*\n'

describe('init_logic_workspace.merge_workspace_yaml — empty existing', () => {
	it('returns template unchanged when existing is empty string', () => {
		expect(init_logic_workspace.merge_workspace_yaml('', TEMPLATE)).toBe(TEMPLATE)
	})

	it('returns template unchanged when existing is whitespace only', () => {
		expect(init_logic_workspace.merge_workspace_yaml('   \n', TEMPLATE)).toBe(TEMPLATE)
	})
})

describe('init_logic_workspace.merge_workspace_yaml — all existing keys in template', () => {
	it('returns template unchanged when existing has only template keys', () => {
		const existing = 'packages:\n  - app\n'

		expect(init_logic_workspace.merge_workspace_yaml(existing, TEMPLATE)).toBe(TEMPLATE)
	})
})

describe('init_logic_workspace.merge_workspace_yaml — user keys not in template', () => {
	const EXISTING = 'packages:\n  - app\ncustom:\n  - src\n'

	const result = init_logic_workspace.merge_workspace_yaml(EXISTING, TEMPLATE)

	it('includes the template packages section', () => {
		expect(result).toContain('packages:')
		expect(result).toContain('apps/*')
	})

	it('appends user key that was not in the template', () => {
		expect(result).toContain('custom:')
	})

	it('preserves user block content under the appended key', () => {
		expect(result).toContain('- src')
	})
})
