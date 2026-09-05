import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { create_base_config } from './base.js'
import { config_fingerprint } from './config-fingerprint.js'

// joshuafolkken/kit#1347: ESLint hashes the *serialized* config to decide whether a cached lint
// result is still valid, and serializing drops every function — so editing a rule's `create` left
// every entry in every cache file valid and the gate reported the pre-edit verdict for each unchanged
// file. The fingerprint below is what makes such an edit visible to that hash.
const RULE_MODULE = path.join('rules', 'naming-convention.js')
const PRESET_ENTRY = 'base.js'
const RULE_SOURCE = 'export const naming_convention_rules = {}\n'

function write_preset(files: Record<string, string>): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'kit-config-fingerprint-'))

	for (const [relative_path, contents] of Object.entries(files)) {
		const full_path = path.join(directory, relative_path)

		mkdirSync(path.dirname(full_path), { recursive: true })
		writeFileSync(full_path, contents)
	}

	return directory
}

function fingerprint_of(files: Record<string, string>): string {
	return config_fingerprint.compute_config_fingerprint(write_preset(files))
}

describe('config_fingerprint.compute_config_fingerprint', () => {
	it('changes when a rule module changes', () => {
		const before = fingerprint_of({ [RULE_MODULE]: RULE_SOURCE, [PRESET_ENTRY]: '' })
		const after = fingerprint_of({ [RULE_MODULE]: `${RULE_SOURCE}// edited\n`, [PRESET_ENTRY]: '' })

		expect(after).not.toBe(before)
	})

	it('stays the same for the same sources, so a warm cache survives a run that changed nothing', () => {
		const files = { [RULE_MODULE]: RULE_SOURCE, [PRESET_ENTRY]: '' }

		expect(fingerprint_of(files)).toBe(fingerprint_of(files))
	})

	it('changes when a rule module is renamed', () => {
		const before = fingerprint_of({ [RULE_MODULE]: RULE_SOURCE })
		const after = fingerprint_of({ [path.join('rules', 'naming.js')]: RULE_SOURCE })

		expect(after).not.toBe(before)
	})

	it('ignores the tests beside the rules, which no cache entry depends on', () => {
		const before = fingerprint_of({ [RULE_MODULE]: RULE_SOURCE })
		const after = fingerprint_of({
			[RULE_MODULE]: RULE_SOURCE,
			[path.join('rules', 'naming-convention.test.ts')]: 'it("x", () => {})\n',
		})

		expect(after).toBe(before)
	})

	it('reads this package sources, so the shipped preset has a fingerprint of its own', () => {
		const preset_directory = path.dirname(fileURLToPath(import.meta.url))

		expect(config_fingerprint.compute_config_fingerprint(preset_directory)).toMatch(/^[\da-f]+$/u)
	})
})

// The block is what reaches ESLint, and it has to reach it through a key that survives the
// serialization the cache hash is taken over. A block carrying the value in a function, or under a
// key ESLint strips, would leave the tests above passing while nothing was invalidated.
describe('config_fingerprint.create_config_fingerprint_block', () => {
	it('carries the fingerprint where serializing the config keeps it', () => {
		const directory = write_preset({ [RULE_MODULE]: RULE_SOURCE })
		const block = config_fingerprint.create_config_fingerprint_block(directory)
		const expected = config_fingerprint.compute_config_fingerprint(directory)

		expect(JSON.stringify(block)).toContain(expected)
	})

	it('applies to every linted file rather than to a glob', () => {
		expect(Object.keys(config_fingerprint.create_config_fingerprint_block())).toStrictEqual([
			'settings',
		])
	})
})

// The acceptance this Issue turns on: one value invalidates the gate's cache and the edit hook's
// together. Both sides load their config through `create_base_config`, so this assertion is what says
// the fingerprint reaches both — `scripts/josh/gate-cache-flags.test.ts` asserts the other half, that
// neither side bypasses this config.
describe('create_base_config', () => {
	it('carries the fingerprint, so every cache the package writes is invalidated by a rule edit', () => {
		const blocks = create_base_config({
			gitignore_path: new URL('../.gitignore', import.meta.url),
			tsconfig_root_dir: fileURLToPath(new URL('..', import.meta.url)),
		})
		const carried = blocks.filter(
			(block) => block.settings?.[config_fingerprint.SETTINGS_KEY] !== undefined,
		)

		expect(carried).toHaveLength(1)
		expect(carried[0]?.settings?.[config_fingerprint.SETTINGS_KEY]).toBe(
			config_fingerprint.compute_config_fingerprint(),
		)
	})
})
