import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { kit_only } from './kit-only'

const FALLBACK_ENTRY = {
	description: '',
	category: 'AI tools',
	reference: ['', 'automation', ['none']],
} as const

// The kit-only flag is what a consumer's help and dispatch read to drop a command that only runs in
// kit itself (joshuafolkken/kit#1988).

describe('kit_only.is_kit_only', () => {
	it('is true for a command marked kit-only', () => {
		expect(kit_only.is_kit_only(COMMAND_MAP['eval'] ?? FALLBACK_ENTRY)).toBe(true)
	})

	it('is false for an unmarked command', () => {
		expect(kit_only.is_kit_only(COMMAND_MAP['cost'] ?? FALLBACK_ENTRY)).toBe(false)
	})
})

describe('kit_only.command_names', () => {
	it('lists eval', () => {
		expect(kit_only.command_names()).toContain('eval')
	})

	// `cost` stays a consumer command because its `--over` mode runs in the consumer workflow.
	it('does not list cost', () => {
		expect(kit_only.command_names()).not.toContain('cost')
	})
})

describe('kit_only.notice', () => {
	it('names the command and points at the kit repository', () => {
		const notice = kit_only.notice('eval')

		expect(notice).toContain('josh eval')
		expect(notice).toContain('kit')
	})
})
