import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { self_sync_guard } from './self-sync-guard-logic'

const PACKAGE_NAME = '@joshuafolkken/kit'
const CONSUMER_NAME = '@example/consumer'
const MANIFEST = 'package.json'
const PACKAGE_LABEL = 'package'

function make_directory(name: string): string {
	return mkdtempSync(path.join(tmpdir(), `self-sync-${name}-`))
}

function write_manifest(directory: string, content: string): string {
	writeFileSync(path.join(directory, MANIFEST), content)

	return directory
}

function named_directory(label: string, name: string): string {
	return write_manifest(make_directory(label), JSON.stringify({ name }))
}

describe('self_sync_reason — the package’s own repository', () => {
	it('refuses when the project manifest carries the package’s own name', () => {
		const package_directory = named_directory(PACKAGE_LABEL, PACKAGE_NAME)
		const project_root = named_directory('project', PACKAGE_NAME)

		expect(self_sync_guard.self_sync_reason(package_directory, project_root)).toContain(
			PACKAGE_NAME,
		)
	})

	// The signal that matters: game-kit's incident ran a global install against its own repository,
	// so the two directories were different and only the name matched (joshuafolkken/kit#868).
	it('refuses on the name alone, with the two directories far apart', () => {
		const package_directory = named_directory('global-install', PACKAGE_NAME)
		const project_root = named_directory('checkout', PACKAGE_NAME)

		expect(path.resolve(package_directory)).not.toBe(path.resolve(project_root))
		expect(self_sync_guard.self_sync_reason(package_directory, project_root)).toBeDefined()
	})

	it('refuses when the package directory and the project root are the same directory', () => {
		const directory = make_directory('same')

		expect(self_sync_guard.self_sync_reason(directory, directory)).toContain('same directory')
	})
})

describe('self_sync_reason — an ordinary consumer project', () => {
	it('allows a project whose manifest carries a different name', () => {
		const package_directory = named_directory(PACKAGE_LABEL, PACKAGE_NAME)
		const project_root = named_directory('consumer', CONSUMER_NAME)

		expect(self_sync_guard.self_sync_reason(package_directory, project_root)).toBeUndefined()
	})

	// `josh init` writes into projects that have no manifest yet, so an absent one must not refuse.
	it('allows a project with no manifest at all', () => {
		const package_directory = named_directory(PACKAGE_LABEL, PACKAGE_NAME)
		const project_root = make_directory('bare')

		expect(self_sync_guard.self_sync_reason(package_directory, project_root)).toBeUndefined()
	})

	it('allows a project whose manifest is malformed JSON', () => {
		const package_directory = named_directory(PACKAGE_LABEL, PACKAGE_NAME)
		const project_root = write_manifest(make_directory('broken'), '{ not json')

		expect(self_sync_guard.self_sync_reason(package_directory, project_root)).toBeUndefined()
	})

	it('allows a project whose manifest has no name field', () => {
		const package_directory = named_directory(PACKAGE_LABEL, PACKAGE_NAME)
		const project_root = write_manifest(
			make_directory('nameless'),
			JSON.stringify({ version: '1' }),
		)

		expect(self_sync_guard.self_sync_reason(package_directory, project_root)).toBeUndefined()
	})

	// Two manifests that both fail to parse must not read as "the same package".
	it('allows when neither manifest can be read', () => {
		const package_directory = make_directory('unreadable-package')
		const project_root = make_directory('unreadable-project')

		expect(self_sync_guard.self_sync_reason(package_directory, project_root)).toBeUndefined()
	})

	// app-kit runs kit's base sync inside its own repository as a legitimate consumer of kit; the
	// guard must not fire on that, or `josh-app sync` breaks for the package it was written for.
	it('allows a downstream distributor syncing its upstream', () => {
		const package_directory = named_directory('kit', PACKAGE_NAME)
		const project_root = named_directory('app-kit', '@joshuafolkken/app-kit')

		expect(self_sync_guard.self_sync_reason(package_directory, project_root)).toBeUndefined()
	})
})

describe('self_sync_refusal', () => {
	it('names the reason and points at a consumer project', () => {
		const directory = named_directory(PACKAGE_LABEL, PACKAGE_NAME)
		const message = self_sync_guard.self_sync_refusal(directory, directory)

		expect(message).toContain(PACKAGE_NAME)
		expect(message).toContain('Refusing to sync')
		expect(message).toContain('consumer project')
	})

	it('returns nothing for a consumer project', () => {
		const package_directory = named_directory(PACKAGE_LABEL, PACKAGE_NAME)
		const project_root = named_directory('consumer', CONSUMER_NAME)

		expect(self_sync_guard.self_sync_refusal(package_directory, project_root)).toBeUndefined()
	})
})

describe('read_package_name', () => {
	it('reads the name from a manifest', () => {
		expect(self_sync_guard.read_package_name(named_directory('read', CONSUMER_NAME))).toBe(
			CONSUMER_NAME,
		)
	})

	// A directory where package.json is itself a directory answers EISDIR, not ENOENT.
	it('returns undefined when package.json is a directory', () => {
		const directory = make_directory('eisdir')

		mkdirSync(path.join(directory, MANIFEST))

		expect(self_sync_guard.read_package_name(directory)).toBeUndefined()
	})
})

describe('self_sync_reason — run from inside the source checkout', () => {
	// `pnpm josh sync` from `kit/docs`: no manifest at the project root and the two directories
	// differ, so only containment is left to catch it.
	it('refuses a project root nested inside the package directory', () => {
		const package_directory = named_directory(PACKAGE_LABEL, PACKAGE_NAME)
		const nested = path.join(package_directory, 'docs')

		mkdirSync(nested)

		expect(self_sync_guard.self_sync_reason(package_directory, nested)).toContain('inside')
	})

	// The ordinary consumer layout is the same containment the other way round: the package lives
	// at `<project>/node_modules/@joshuafolkken/kit`. Refusing on that would refuse every sync.
	it('allows the package directory nested inside the project root', () => {
		const project_root = named_directory('consumer', CONSUMER_NAME)
		const package_directory = path.join(project_root, 'node_modules', PACKAGE_NAME)

		mkdirSync(package_directory, { recursive: true })
		write_manifest(package_directory, JSON.stringify({ name: PACKAGE_NAME }))

		expect(self_sync_guard.self_sync_reason(package_directory, project_root)).toBeUndefined()
	})

	// A sibling directory whose path merely starts with the package directory's name is not inside
	// it; a string prefix test would read `kit-consumer` as nested under `kit`.
	it('allows a sibling whose path shares the package directory prefix', () => {
		const package_directory = named_directory(PACKAGE_LABEL, PACKAGE_NAME)
		const sibling = `${package_directory}-consumer`

		mkdirSync(sibling)
		write_manifest(sibling, JSON.stringify({ name: CONSUMER_NAME }))

		expect(self_sync_guard.self_sync_reason(package_directory, sibling)).toBeUndefined()
	})
})

describe('self_sync_reason — containment is a fallback, not a rule', () => {
	// A fixture consumer scaffolded under the checkout is nested, but its manifest names it as
	// something else — containment must not override that.
	it('allows a nested project whose manifest carries a different name', () => {
		const package_directory = named_directory(PACKAGE_LABEL, PACKAGE_NAME)
		const nested = path.join(package_directory, 'tmp', 'consumer')

		mkdirSync(nested, { recursive: true })
		write_manifest(nested, JSON.stringify({ name: CONSUMER_NAME }))

		expect(self_sync_guard.self_sync_reason(package_directory, nested)).toBeUndefined()
	})
})
