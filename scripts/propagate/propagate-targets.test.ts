import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { propagate_targets } from './propagate-targets'

const KIT = '@joshuafolkken/kit'
const TARGET_VERSION = '1.111.0'
const OLD_VERSION = '1.110.0'
const MANIFEST = 'package.json'
const NODE_MODULES = 'node_modules'
const APP_KIT_KEY = 'joshuafolkken/app-kit'
const APP_KIT_NAME = '@joshuafolkken/app-kit'
const APP_KIT_DIR = 'app-kit'
const APP_KIT_RANGE = '^1.102.0'

const state = { workspace: '' }

interface ConsumerOptions {
	name: string
	range?: string
	is_dev_dependency?: boolean
	installed?: string
}

// The copy actually present under `node_modules`, which is what decides "already up to date".
function write_installed(repository_path: string, installed: string | undefined): void {
	if (installed === undefined) return
	const installed_path = path.join(repository_path, NODE_MODULES, KIT)

	mkdirSync(installed_path, { recursive: true })
	writeFileSync(
		path.join(installed_path, MANIFEST),
		JSON.stringify({ name: KIT, version: installed }),
	)
}

// A consumer checkout: a manifest declaring the dependency, and optionally the copy actually
// installed under `node_modules`.
function make_consumer(directory: string, options: ConsumerOptions): string {
	const repository_path = path.join(state.workspace, directory)
	const field = options.is_dev_dependency === true ? 'devDependencies' : 'dependencies'
	const manifest: Record<string, unknown> = { name: options.name }

	if (options.range !== undefined) manifest[field] = { [KIT]: options.range }
	mkdirSync(repository_path, { recursive: true })
	writeFileSync(path.join(repository_path, MANIFEST), JSON.stringify(manifest))

	write_installed(repository_path, options.installed)

	return repository_path
}

function classify(repository_path: string): string {
	return propagate_targets.classify_target(APP_KIT_KEY, repository_path, KIT, TARGET_VERSION).state
}

beforeEach(() => {
	state.workspace = mkdtempSync(path.join(tmpdir(), 'propagate-targets-'))
})

afterEach(() => {
	rmSync(state.workspace, { recursive: true, force: true })
})

describe('propagate_targets.classify_target', () => {
	it('is ready when the consumer declares the dependency and has an older copy installed', () => {
		const consumer = make_consumer(APP_KIT_DIR, {
			name: APP_KIT_NAME,
			range: APP_KIT_RANGE,
			installed: OLD_VERSION,
		})

		expect(classify(consumer)).toBe('ready')
	})

	it('accepts the dependency declared as a development dependency', () => {
		const consumer = make_consumer('site', {
			name: 'a-site',
			range: '1.104.0',
			is_dev_dependency: true,
			installed: OLD_VERSION,
		})

		expect(classify(consumer)).toBe('ready')
	})

	it('covers a consumer that is not a published package at all', () => {
		const consumer = make_consumer('site', { name: 'joshuafolkken-com', range: '1.104.0' })

		expect(classify(consumer)).toBe('ready')
	})

	it('skips a consumer that already carries the release', () => {
		const consumer = make_consumer(APP_KIT_DIR, {
			name: APP_KIT_NAME,
			range: APP_KIT_RANGE,
			installed: TARGET_VERSION,
		})

		expect(classify(consumer)).toBe('up_to_date')
	})
})

describe('propagate_targets.classify_target — installed, not declared', () => {
	it('is not fooled by a range that would accept the release but is not installed', () => {
		const consumer = make_consumer(APP_KIT_DIR, {
			name: APP_KIT_NAME,
			range: `^${TARGET_VERSION}`,
			installed: OLD_VERSION,
		})

		expect(classify(consumer)).toBe('ready')
	})
})

describe('propagate_targets.classify_target — what is not a target', () => {
	it('excludes a repository that does not depend on the package', () => {
		expect(classify(make_consumer('unrelated', { name: 'unrelated' }))).toBe('not_downstream')
	})

	it('excludes the supplier own repository', () => {
		const supplier = make_consumer('kit', { name: KIT })

		expect(classify(supplier)).toBe('not_downstream')
	})

	it('reports a missing checkout rather than cloning one', () => {
		expect(classify(path.join(state.workspace, 'never-cloned'))).toBe('missing_checkout')
	})

	// A parent directory holds Godot and Rust repositories too. Calling those damaged would put a
	// scary line in the report for every one of them.
	it('treats a repository that is not a Node project as simply not downstream', () => {
		const not_node = path.join(state.workspace, 'godot-game')

		mkdirSync(not_node, { recursive: true })

		expect(classify(not_node)).toBe('not_downstream')
	})

	it('reports a manifest that exists but cannot be parsed as unreadable', () => {
		const damaged = path.join(state.workspace, 'damaged')

		mkdirSync(damaged, { recursive: true })
		writeFileSync(path.join(damaged, MANIFEST), '{ not json')

		expect(classify(damaged)).toBe('unreadable')
	})

	it('reports the range the consumer declares, so a skip can name it', () => {
		const consumer = make_consumer(APP_KIT_DIR, {
			name: APP_KIT_NAME,
			range: APP_KIT_RANGE,
			installed: TARGET_VERSION,
		})
		const target = propagate_targets.classify_target(APP_KIT_KEY, consumer, KIT, TARGET_VERSION)

		expect(target.declared_range).toBe(APP_KIT_RANGE)
	})
})

describe('propagate_targets.resolve_targets', () => {
	it('classifies every entry of the map and drops none of them', () => {
		const app_kit = make_consumer(APP_KIT_DIR, {
			name: APP_KIT_NAME,
			range: APP_KIT_RANGE,
			installed: OLD_VERSION,
		})
		const unrelated = make_consumer('unrelated', { name: 'unrelated' })
		const map = new Map([
			[APP_KIT_KEY, app_kit],
			['joshuafolkken/unrelated', unrelated],
		])
		const targets = propagate_targets.resolve_targets(map, KIT, TARGET_VERSION)

		expect(targets.map((target) => target.state)).toEqual(['ready', 'not_downstream'])
	})

	// The map is the only source of candidates, and joshuafolkken/kit#869 already refuses another
	// owner. Nothing here may add a candidate the map did not produce.
	it('considers only what the discovery map handed it', () => {
		expect(propagate_targets.resolve_targets(new Map(), KIT, TARGET_VERSION)).toEqual([])
	})
})
