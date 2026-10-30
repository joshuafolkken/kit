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
const RULE_FILE = 'naming-convention.js'
const RULE_MODULE = path.join('rules', RULE_FILE)
const PENDING_MODULE = path.join('rules', 'comment-why-only.js')
const PRESET_ENTRY = 'base.js'
const RULE_SOURCE = 'export const naming_convention_rules = {}\n'
const RULE_SPECIFIER = './rules/naming-convention.js'
const WIRING = "import { naming_convention_rules } from './rules/naming-convention.js'\n"
const PRESET_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.dirname(PRESET_DIRECTORY)

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

function wired(files: Record<string, string> = {}): Record<string, string> {
	return { [PRESET_ENTRY]: WIRING, [RULE_MODULE]: RULE_SOURCE, ...files }
}

describe('config_fingerprint.compute_config_fingerprint', () => {
	it('changes when a wired rule module changes', () => {
		const before = fingerprint_of(wired())
		const after = fingerprint_of(wired({ [RULE_MODULE]: `${RULE_SOURCE}// edited\n` }))

		expect(after).not.toBe(before)
	})

	// Each call writes its own temporary directory, so this is also two checkouts at two paths — the
	// agreement the restored CI cache needs.
	it('stays the same for the same sources, so a warm cache survives a run that changed nothing', () => {
		expect(fingerprint_of(wired())).toBe(fingerprint_of(wired()))
	})

	it('changes when a wired rule module is renamed', () => {
		const before = fingerprint_of(wired())
		const after = fingerprint_of({
			[PRESET_ENTRY]: WIRING.replace('naming-convention', 'naming'),
			[path.join('rules', 'naming.js')]: RULE_SOURCE,
		})

		expect(after).not.toBe(before)
	})

	it('ignores the tests beside the rules, which no cache entry depends on', () => {
		const before = fingerprint_of(wired())
		const after = fingerprint_of(
			wired({ [path.join('rules', 'naming-convention.test.ts')]: 'it("x", () => {})\n' }),
		)

		expect(after).toBe(before)
	})

	it('reads this package sources, so the shipped preset has a fingerprint of its own', () => {
		expect(config_fingerprint.compute_config_fingerprint(PRESET_DIRECTORY)).toMatch(/^[\da-f]+$/u)
	})
})

// joshuafolkken/kit#5380: a rule module the config does not import yet changes no lint result, so it
// must not throw the warm cache away until the commit that wires it in.
describe('config_fingerprint.compute_config_fingerprint before a module is wired in', () => {
	it('ignores a rule module no config imports yet, whether added or edited', () => {
		const before = fingerprint_of(wired())
		const added = fingerprint_of(wired({ [PENDING_MODULE]: RULE_SOURCE }))
		const edited = fingerprint_of(wired({ [PENDING_MODULE]: `${RULE_SOURCE}// edited\n` }))

		expect([added, edited]).toStrictEqual([before, before])
	})

	it('changes once the module is wired in', () => {
		const pending = fingerprint_of(wired({ [PENDING_MODULE]: RULE_SOURCE }))
		const imported = fingerprint_of(
			wired({
				[PRESET_ENTRY]: `${WIRING}import './rules/comment-why-only.js'\n`,
				[PENDING_MODULE]: RULE_SOURCE,
			}),
		)

		expect(imported).not.toBe(pending)
	})

	it('follows the project config entry into a module the preset itself does not import', () => {
		const directory = write_preset(wired({ [PENDING_MODULE]: RULE_SOURCE }))
		const project_entry = path.join(directory, 'eslint.config.js')
		const entries = [path.join(directory, PRESET_ENTRY), project_entry]

		writeFileSync(project_entry, "import './rules/comment-why-only.js'\n")
		const before = config_fingerprint.compute_config_fingerprint(directory, entries)

		writeFileSync(path.join(directory, PENDING_MODULE), `${RULE_SOURCE}// edited\n`)

		expect(config_fingerprint.compute_config_fingerprint(directory, entries)).not.toBe(before)
	})
})

describe('config_fingerprint.compute_config_fingerprint local import forms', () => {
	it.each([
		'await import(`./rules/naming-convention.js`)\n',
		"require('./rules')\n",
		"import '#rule'\n",
		"import 'fingerprint-fixture/rule'\n",
	])('invalidates a rule loaded through %j', (entry) => {
		const directory = write_preset(
			wired({
				[PRESET_ENTRY]: entry,
				'rules/package.json': JSON.stringify({ main: RULE_FILE }),
				'package.json': JSON.stringify({
					name: 'fingerprint-fixture',
					imports: { '#rule': { import: RULE_SPECIFIER } },
					exports: { './rule': { import: RULE_SPECIFIER } },
				}),
			}),
		)
		const before = config_fingerprint.compute_config_fingerprint(directory)

		writeFileSync(path.join(directory, RULE_MODULE), `${RULE_SOURCE}// edited\n`)

		expect(config_fingerprint.compute_config_fingerprint(directory)).not.toBe(before)
	})
})

describe('config_fingerprint.list_reachable_modules import syntax', () => {
	it('follows commented imports, CommonJS requires and cycles', () => {
		const directory = write_preset({
			'entry.cjs': "require(/* module */ './a.js')\n",
			'a.js': "import /* module */ './b.js'\n",
			'b.js': "export * from // module\n './a.js'\n",
		})
		const reached = config_fingerprint.list_reachable_modules([path.join(directory, 'entry.cjs')])

		expect(new Set([...reached].map((file) => path.basename(file)))).toStrictEqual(
			new Set(['entry.cjs', 'a.js', 'b.js']),
		)
	})
})

describe('config_fingerprint.list_reachable_modules', () => {
	it('follows re-exports and literal dynamic imports, and drops a specifier naming no file', () => {
		const directory = write_preset({
			'entry.js': "export * from './a.js'\nawait import('./b.js')\nimport './missing.js'\n",
			'a.js': '',
			'b.js': '',
			'c.js': '',
		})
		const reached: ReadonlySet<string> = config_fingerprint.list_reachable_modules([
			path.join(directory, 'entry.js'),
		])
		const names = new Set([...reached].map((file) => path.basename(file)))

		expect(names).toStrictEqual(new Set(['a.js', 'b.js', 'entry.js']))
	})

	it('resolves a TypeScript config specifier: no extension, a directory index, a .js for a .ts', () => {
		const directory = write_preset({
			'eslint.config.ts': "import './bare'\nimport './folder'\nimport './typed.js'\n",
			'bare.ts': '',
			[path.join('folder', 'index.ts')]: '',
			'typed.ts': '',
		})
		const reached: ReadonlySet<string> = config_fingerprint.list_reachable_modules(
			config_fingerprint.list_config_entries(directory),
		)
		const names = new Set([...reached].map((file) => path.relative(directory, file)))

		expect(names).toStrictEqual(
			new Set(['eslint.config.ts', 'bare.ts', path.join('folder', 'index.ts'), 'typed.ts']),
		)
	})
})

// The block is what reaches ESLint, and it has to reach it through a key that survives the
// serialization the cache hash is taken over. A block carrying the value in a function, or under a
// key ESLint strips, would leave the tests above passing while nothing was invalidated.
describe('config_fingerprint.create_config_fingerprint_block', () => {
	it('carries the fingerprint of the preset and the project config together', () => {
		const block = config_fingerprint.create_config_fingerprint_block(PROJECT_ROOT)
		const expected = config_fingerprint.compute_config_fingerprint(PRESET_DIRECTORY, [
			path.join(PRESET_DIRECTORY, PRESET_ENTRY),
			...config_fingerprint.list_config_entries(PROJECT_ROOT),
		])

		expect(JSON.stringify(block)).toContain(expected)
	})

	it('covers a module only the project config wires', () => {
		const with_project = config_fingerprint.create_config_fingerprint_block(PROJECT_ROOT)

		expect(with_project).not.toStrictEqual(config_fingerprint.create_config_fingerprint_block())
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
			tsconfig_root_dir: PROJECT_ROOT,
		})
		const carried = blocks.filter(
			(block) => block.settings?.[config_fingerprint.SETTINGS_KEY] !== undefined,
		)

		expect(carried).toHaveLength(1)
		expect(carried[0]).toStrictEqual(
			config_fingerprint.create_config_fingerprint_block(PROJECT_ROOT),
		)
	})
})
