import { readFileSync } from 'node:fs'
import type { Options } from 'prettier'
import semver from 'semver'
import { describe, expect, it } from 'vitest'
import { config } from './index.js'

const MANIFEST = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
	devDependencies: Record<string, string>
	peerDependencies: Record<string, string>
	peerDependenciesMeta: Record<string, { optional?: boolean }>
}

// Every package the exported config loads by name, plus Prettier itself.
const LOADED_PACKAGES = ['prettier', ...config.plugins]

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

describe('shared Prettier config — peer dependencies', () => {
	it.each(LOADED_PACKAGES)('declares %s as an optional peer', (name: string) => {
		expect(MANIFEST.peerDependenciesMeta[name]?.optional).toBe(true)
	})

	// `pnpm update --latest` lifts devDependencies but never peerDependencies, so the peer range is a
	// floor that has to admit the verified version rather than equal its range.
	it.each(LOADED_PACKAGES)('admits the verified %s version in its peer range', (name: string) => {
		const peer_range = MANIFEST.peerDependencies[name]
		const development_range = MANIFEST.devDependencies[name]

		expect(peer_range).toBeDefined()
		expect(development_range).toBeDefined()

		const verified = semver.minVersion(development_range ?? '')

		expect(verified).not.toBeNull()
		expect(semver.satisfies(verified ?? '', peer_range ?? '')).toBe(true)
	})
})
