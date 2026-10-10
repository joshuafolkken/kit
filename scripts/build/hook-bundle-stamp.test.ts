import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { hook_bundle_stamp, type HookSources } from './hook-bundle-stamp'

const { is_fresh, STAMP_NAME, stamp_text, VERIFIED_NAME } = hook_bundle_stamp

const FIRST_INPUT = 'scripts/a.ts'
const SECOND_INPUT = 'scripts/b.ts'
const OUTPUT_NAME = 'hook.js'
const ORIGINAL_CONTENT = 'export const value = 1\n'
const EARLIER_CONTENT = 'export const value = 0\n'
// Same length as the original, so only the content tells the two apart.
const EDITED_CONTENT = 'export const value = 9\n'

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

		write_stamp(fixture.out_directory, sources_of(EARLIER_CONTENT))

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

// Whole-second times, which `utimesSync` can set back exactly — a sub-millisecond mtime read off disk
// would not survive the round trip. The settled one is long past; the current second is still inside
// the timestamp granularity window.
const SETTLED_TIME = new Date('2026-01-01T00:00:00Z')
const MS_PER_SECOND = 1000

function current_second(): Date {
	return new Date(Math.floor(Date.now() / MS_PER_SECOND) * MS_PER_SECOND)
}

function pin_inputs(fixture: Fixture, time: Date = SETTLED_TIME): void {
	for (const input of [FIRST_INPUT, SECOND_INPUT]) {
		utimesSync(path.join(fixture.package_directory, input), time, time)
	}
}

// Rewrites an input's content while restoring the mtime the verification saw.
function edit_keeping_signature(
	fixture: Fixture,
	content: string,
	time: Date = SETTLED_TIME,
): void {
	writeFileSync(path.join(fixture.package_directory, FIRST_INPUT), content)
	pin_inputs(fixture, time)
}

describe('is_fresh with a remembered verification', () => {
	it('remembers the inputs it verified', () => {
		const fixture = create_fixture()

		pin_inputs(fixture)
		is_fixture_fresh(fixture)

		expect(existsSync(path.join(fixture.out_directory, VERIFIED_NAME))).toBe(true)
	})

	// Only a skipped hash can read changed content as fresh, so this is the mtime-first path.
	it('skips the hash while every input keeps its remembered signature', () => {
		const fixture = create_fixture()

		pin_inputs(fixture)
		is_fixture_fresh(fixture)
		edit_keeping_signature(fixture, EDITED_CONTENT)

		expect(is_fixture_fresh(fixture)).toBe(true)
	})

	// The edit keeps the size, so only the moved mtime can send it back to the hash.
	it('hashes again and reads stale once an input is edited after the verification', () => {
		const fixture = create_fixture()

		pin_inputs(fixture)
		is_fixture_fresh(fixture)
		writeFileSync(path.join(fixture.package_directory, FIRST_INPUT), EDITED_CONTENT)

		expect(is_fixture_fresh(fixture)).toBe(false)
	})

	// A rebuild records a new digest, so a memory of the old one vouches for nothing.
	it('ignores a remembered verification of another digest', () => {
		const fixture = create_fixture()

		pin_inputs(fixture)
		is_fixture_fresh(fixture)
		edit_keeping_signature(fixture, EDITED_CONTENT)
		write_stamp(fixture.out_directory, sources_of(EARLIER_CONTENT))

		expect(is_fixture_fresh(fixture)).toBe(false)
	})
})

describe('is_fresh on a coarse-mtime volume', () => {
	// The edit lands in the tick the signature was taken in, so a remembered signature would hide it.
	it('does not remember inputs whose mtime is still within the timestamp granularity', () => {
		const fixture = create_fixture()
		const recent = current_second()

		pin_inputs(fixture, recent)
		is_fixture_fresh(fixture)
		edit_keeping_signature(fixture, EDITED_CONTENT, recent)

		expect(is_fixture_fresh(fixture)).toBe(false)
	})
})
