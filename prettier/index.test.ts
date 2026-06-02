import type { Options } from 'prettier'
import { describe, expect, it } from 'vitest'
import { config } from './index.js'

// prettier-plugin-svelte v4 removed these options; keeping them triggers
// "Ignored unknown option { ... }" warnings on every .svelte file.
const REMOVED_SVELTE_OPTIONS = ['svelteStrictMode', 'svelteBracketNewLine']

// Options that are still valid in prettier-plugin-svelte v4 and must remain.
const REQUIRED_SVELTE_OPTIONS = ['svelteIndentScriptAndStyle', 'svelteSortOrder']

function find_svelte_override(): Options {
	const override = config.overrides?.find((entry) => entry.files === '*.svelte')

	if (!override) throw new Error('Expected a *.svelte override in the Prettier config')

	return override.options
}

describe('shared Prettier config — *.svelte override', () => {
	it('does not set any prettier-plugin-svelte v4 removed options', () => {
		const options = find_svelte_override() as Record<string, unknown>

		for (const removed of REMOVED_SVELTE_OPTIONS) {
			expect(options).not.toHaveProperty(removed)
		}
	})

	it('keeps the svelte options still supported in v4', () => {
		const options = find_svelte_override() as Record<string, unknown>

		expect(options.parser).toBe('svelte')

		for (const required of REQUIRED_SVELTE_OPTIONS) {
			expect(options).toHaveProperty(required)
		}
	})
})
