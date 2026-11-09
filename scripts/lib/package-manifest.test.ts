import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PACKAGE_JSON, package_manifest } from './package-manifest'

const name_schema = z.object({ name: z.string() })
const READS_THROUGH_SCHEMA = 'reads the manifest through the schema'
const UNREADABLE_CASES: ReadonlyArray<[string, string | undefined]> = [
	['a missing manifest', undefined],
	['text that is not JSON', '{"name":'],
	['a shape the schema rejects', '{"version":"1.0.0"}'],
]
const fixture = { directory: '' }
const make_directory = temporary_directory()

function write_manifest(text: string | undefined): void {
	if (text !== undefined) writeFileSync(path.join(fixture.directory, PACKAGE_JSON), text)
}

beforeEach(() => {
	fixture.directory = make_directory('package-manifest-')
})

describe('package_manifest.manifest_path', () => {
	it('names package.json inside the directory', () => {
		expect(package_manifest.manifest_path('/project')).toBe(path.join('/project', 'package.json'))
	})
})

describe('package_manifest.read_manifest — a manifest that must exist', () => {
	it(READS_THROUGH_SCHEMA, () => {
		write_manifest('{"name":"kit","version":"1.0.0"}')

		expect(package_manifest.read_manifest(fixture.directory, name_schema)).toEqual({ name: 'kit' })
	})

	it.each(UNREADABLE_CASES)('throws on %s', (_label, text) => {
		write_manifest(text)

		expect(() => package_manifest.read_manifest(fixture.directory, name_schema)).toThrow()
	})
})

describe('package_manifest.read_manifest_if_valid — a manifest that may be absent', () => {
	it(READS_THROUGH_SCHEMA, () => {
		write_manifest('{"name":"kit"}')

		expect(package_manifest.read_manifest_if_valid(fixture.directory, name_schema)).toEqual({
			name: 'kit',
		})
	})

	it.each(UNREADABLE_CASES)('answers undefined for %s', (_label, text) => {
		write_manifest(text)

		expect(package_manifest.read_manifest_if_valid(fixture.directory, name_schema)).toBeUndefined()
	})
})
