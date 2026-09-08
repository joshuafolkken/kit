import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adopt_toolkits } from './adopt-toolkits'

const KIT = '@joshuafolkken/kit'
const APP_KIT = '@joshuafolkken/app-kit'
const EXAMPLE = '@joshuafolkken/example'
const MANIFEST = 'package.json'
const NODE_MODULES = 'node_modules'
const BIN = '.bin'
const JOSH = 'josh'
const JOSH_APP = 'josh-app'
const RANGE = '^1.0.0'

const state = { project: '' }

function write_manifest(directory: string, content: Record<string, unknown>): void {
	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, MANIFEST), JSON.stringify(content))
}

// An installed toolkit: its own manifest declares the CLI, and the shim exists in `node_modules/.bin`.
function install_toolkit(package_name: string, bin_name: string, has_shim = true): void {
	write_manifest(path.join(state.project, NODE_MODULES, package_name), {
		name: package_name,
		version: '1.0.0',
		bin: { [bin_name]: 'dist/entry.js' },
	})

	if (!has_shim) return
	const bin_directory = path.join(state.project, NODE_MODULES, BIN)

	mkdirSync(bin_directory, { recursive: true })
	writeFileSync(path.join(bin_directory, bin_name), '#!/bin/sh\n')
}

// A scoped package that is installed perfectly well and simply ships no CLI — a shared config or a
// types package, not a toolkit. Nothing about it is broken, so nothing may refuse on it.
function install_library(package_name: string): void {
	write_manifest(path.join(state.project, NODE_MODULES, package_name), {
		name: package_name,
		version: '1.0.0',
	})
}

beforeEach(() => {
	state.project = mkdtempSync(path.join(tmpdir(), 'adopt-toolkits-'))
})

afterEach(() => {
	rmSync(state.project, { recursive: true, force: true })
})

describe('adopt_toolkits.declared_toolkits', () => {
	// kit is the base tier and app-kit overlays files derived from it, so a sync that ran kit last
	// would overwrite the overlay with the original. Name order would do exactly that.
	it('puts the base toolkit first, not in name order', () => {
		write_manifest(state.project, {
			name: 'consumer',
			devDependencies: { [APP_KIT]: RANGE, [KIT]: RANGE, zod: RANGE },
		})

		expect(adopt_toolkits.declared_toolkits(state.project)).toEqual([KIT, APP_KIT])
	})

	// The upgrade installs with `pnpm add -D`, which would relocate a toolkit declared under
	// `dependencies` — a manifest rewrite riding silently into the pull request.
	it('leaves out a toolkit declared under dependencies', () => {
		write_manifest(state.project, {
			name: 'consumer',
			dependencies: { [APP_KIT]: RANGE },
			devDependencies: { [KIT]: RANGE },
		})

		expect(adopt_toolkits.declared_toolkits(state.project)).toEqual([KIT])
	})

	it('answers nothing for a directory with no manifest at all', () => {
		expect(adopt_toolkits.declared_toolkits(state.project)).toEqual([])
	})
})

describe('adopt_toolkits.misplaced_toolkits', () => {
	it('names what was left out, so the omission is not silent', () => {
		write_manifest(state.project, {
			name: 'consumer',
			dependencies: { [APP_KIT]: RANGE, zod: RANGE },
			devDependencies: { [KIT]: RANGE },
		})
		install_toolkit(APP_KIT, JOSH_APP)

		expect(adopt_toolkits.misplaced_toolkits(state.project)).toEqual([APP_KIT])
	})

	it('says nothing about a toolkit declared in both fields', () => {
		write_manifest(state.project, {
			name: 'consumer',
			dependencies: { [KIT]: RANGE },
			devDependencies: { [KIT]: RANGE },
		})
		install_toolkit(KIT, JOSH)

		expect(adopt_toolkits.misplaced_toolkits(state.project)).toEqual([])
	})

	// Telling the owner of a scoped runtime library to move it into `devDependencies` would break the
	// build it is there to serve. Only a package that ships a CLI can be a misplaced toolkit.
	it('says nothing about a scoped package that ships no CLI', () => {
		write_manifest(state.project, { name: 'consumer', dependencies: { [EXAMPLE]: RANGE } })
		install_library(EXAMPLE)

		expect(adopt_toolkits.misplaced_toolkits(state.project)).toEqual([])
	})
})

// npm accepts two shapes for `bin`, and the string form names the package unscoped name.
describe('adopt_toolkits.pick_bin_name', () => {
	it('reads the object form by its declared key', () => {
		expect(adopt_toolkits.pick_bin_name(KIT, { [JOSH]: 'dist/josh.js' })).toBe(JOSH)
	})

	it('answers the unscoped package name for the string form', () => {
		expect(adopt_toolkits.pick_bin_name(EXAMPLE, 'dist/cli.js')).toBe('example')
	})

	// A toolkit shipping several CLIs still resolves to one deterministically.
	it('prefers the entry named after the package over an arbitrary first key', () => {
		expect(
			adopt_toolkits.pick_bin_name(EXAMPLE, {
				'example-mcp': 'a.js',
				example: 'b.js',
			}),
		).toBe('example')
	})
})

describe('adopt_toolkits.read_bin_name', () => {
	// The mapping is derived rather than written down, so a fourth toolkit needs no edit here.
	it('reads the CLI name from the installed package own bin field', () => {
		install_toolkit(APP_KIT, JOSH_APP)

		expect(adopt_toolkits.read_bin_name(state.project, APP_KIT)).toBe(JOSH_APP)
	})

	it('answers nothing when the package is not installed', () => {
		expect(adopt_toolkits.read_bin_name(state.project, KIT)).toBeUndefined()
	})
})

describe('adopt_toolkits.discover_toolkits', () => {
	it('carries every installed toolkit at latest, with its own CLI name', () => {
		write_manifest(state.project, {
			name: 'consumer',
			devDependencies: { [KIT]: RANGE },
		})
		install_toolkit(KIT, JOSH)

		expect(adopt_toolkits.discover_toolkits(state.project)).toEqual([
			{ package_name: KIT, version: adopt_toolkits.LATEST_VERSION, bin_name: JOSH },
		])
	})

	// A declared dependency whose shim is missing cannot be told to sync, so it is dropped rather
	// than spawned and reported as a failed sync step.
	it('drops a declared toolkit whose CLI shim is not installed', () => {
		write_manifest(state.project, {
			name: 'consumer',
			devDependencies: { [KIT]: RANGE, [APP_KIT]: RANGE },
		})
		install_toolkit(KIT, JOSH)
		install_toolkit(APP_KIT, JOSH_APP, false)

		expect(adopt_toolkits.discover_toolkits(state.project).map((one) => one.package_name)).toEqual([
			KIT,
		])
	})

	it('drops dependencies outside the toolkit scope', () => {
		write_manifest(state.project, { name: 'consumer', devDependencies: { zod: RANGE } })

		expect(adopt_toolkits.discover_toolkits(state.project)).toEqual([])
	})
})

// The drop `discover_toolkits` makes used to be invisible, which is how a partial install synced kit
// alone and reverted the overlay tier (joshuafolkken/kit#1540). This is what makes it nameable.
describe('adopt_toolkits.unresolved_toolkits', () => {
	it('names a declared toolkit whose CLI shim is not installed', () => {
		write_manifest(state.project, {
			name: 'consumer',
			devDependencies: { [KIT]: RANGE, [APP_KIT]: RANGE },
		})
		install_toolkit(KIT, JOSH)
		install_toolkit(APP_KIT, JOSH_APP, false)

		expect(adopt_toolkits.unresolved_toolkits(state.project)).toEqual([APP_KIT])
	})

	it('names a declared toolkit that was never installed at all', () => {
		write_manifest(state.project, { name: 'consumer', devDependencies: { [APP_KIT]: RANGE } })

		expect(adopt_toolkits.unresolved_toolkits(state.project)).toEqual([APP_KIT])
	})

	// `resolve_toolkit` and `is_unreachable_toolkit` share the same two primitives, so a resolved
	// toolkit can never appear in both lists.
	it('names nothing when every declared toolkit resolves', () => {
		write_manifest(state.project, { name: 'consumer', devDependencies: { [KIT]: RANGE } })
		install_toolkit(KIT, JOSH)

		expect(adopt_toolkits.unresolved_toolkits(state.project)).toEqual([])
	})

	// It is installed exactly as asked; `pnpm install` would change nothing, so refusing on it would
	// leave the consumer with a diagnosis that is false and a fix that can never work.
	it('names nothing for a scoped package that is installed but ships no CLI', () => {
		write_manifest(state.project, { name: 'consumer', devDependencies: { [EXAMPLE]: RANGE } })
		install_library(EXAMPLE)

		expect(adopt_toolkits.unresolved_toolkits(state.project)).toEqual([])
	})

	// A broken install is a broken install wherever it was declared, and `pnpm install` is the fix in
	// both fields — so this list reads `dependencies` too.
	it('names a broken install declared under dependencies as well', () => {
		write_manifest(state.project, { name: 'consumer', dependencies: { [APP_KIT]: RANGE } })

		expect(adopt_toolkits.unresolved_toolkits(state.project)).toEqual([APP_KIT])
	})
})
