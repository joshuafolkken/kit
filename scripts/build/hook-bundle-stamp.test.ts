import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { hook_bundle_stamp, type HookSources } from './hook-bundle-stamp'

const { is_fresh, STAMP_NAME, stamp_text } = hook_bundle_stamp

const FIRST_INPUT = 'scripts/a.ts'
const SECOND_INPUT = 'scripts/b.ts'
const OUTPUT_NAME = 'hook.js'
const ORIGINAL_CONTENT = 'export const value = 1\n'

interface Fixture {
	package_directory: string
	out_directory: string
}

function write_stamp(out_directory: string, sources: HookSources): void {
	writeFileSync(path.join(out_directory, STAMP_NAME), stamp_text(sources, [OUTPUT_NAME]))
}

function sources_of(content: string): HookSources {
	const bytes = new TextEncoder().encode(content)

	return new Map([
		[FIRST_INPUT, bytes],
		[SECOND_INPUT, bytes],
	])
}

// A package with two inputs and one built output, stamped as built from them.
function create_fixture(): Fixture {
	const package_directory = mkdtempSync(path.join(tmpdir(), 'hook-bundle-stamp-'))
	const out_directory = path.join(package_directory, 'dist', 'hooks')

	onTestFinished(() => {
		rmSync(package_directory, { recursive: true, force: true })
	})
	mkdirSync(path.join(package_directory, 'scripts'))
	mkdirSync(out_directory, { recursive: true })
	writeFileSync(path.join(package_directory, FIRST_INPUT), ORIGINAL_CONTENT)
	writeFileSync(path.join(package_directory, SECOND_INPUT), ORIGINAL_CONTENT)
	writeFileSync(path.join(out_directory, OUTPUT_NAME), 'export {}\n')
	write_stamp(out_directory, sources_of(ORIGINAL_CONTENT))

	return { package_directory, out_directory }
}

function is_fixture_fresh({ package_directory, out_directory }: Fixture): boolean {
	return is_fresh(out_directory, package_directory)
}

describe('is_fresh', () => {
	it('reads bundles built from the current source as fresh', () => {
		expect(is_fixture_fresh(create_fixture())).toBe(true)
	})

	it('reads an edited input as stale', () => {
		const fixture = create_fixture()

		writeFileSync(path.join(fixture.package_directory, FIRST_INPUT), 'export const value = 2\n')

		expect(is_fixture_fresh(fixture)).toBe(false)
	})

	it('reads a deleted input as stale', () => {
		const fixture = create_fixture()

		rmSync(path.join(fixture.package_directory, SECOND_INPUT))

		expect(is_fixture_fresh(fixture)).toBe(false)
	})

	it('reads a missing record as stale', () => {
		const fixture = create_fixture()

		rmSync(path.join(fixture.out_directory, STAMP_NAME))

		expect(is_fixture_fresh(fixture)).toBe(false)
	})

	it('reads a missing bundle as stale', () => {
		const fixture = create_fixture()

		rmSync(path.join(fixture.out_directory, OUTPUT_NAME))

		expect(is_fixture_fresh(fixture)).toBe(false)
	})
})

describe('is_fresh against the recorded build', () => {
	// The digest is of what the build read: a source edited after that read is not what was bundled.
	it('reads a source changed after the build read it as stale', () => {
		const fixture = create_fixture()

		write_stamp(fixture.out_directory, sources_of('export const value = 0\n'))

		expect(is_fixture_fresh(fixture)).toBe(false)
	})

	it('reads a malformed record as stale', () => {
		const fixture = create_fixture()

		writeFileSync(path.join(fixture.out_directory, STAMP_NAME), '{"digest":"x"}\n')

		expect(is_fixture_fresh(fixture)).toBe(false)
	})

	// A copy or a fresh checkout rewrites every mtime but keeps the content, which must not rebuild.
	it('stays fresh when an input is rewritten with the same content', () => {
		const fixture = create_fixture()

		writeFileSync(path.join(fixture.package_directory, FIRST_INPUT), ORIGINAL_CONTENT)

		expect(is_fixture_fresh(fixture)).toBe(true)
	})
})
