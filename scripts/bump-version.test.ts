import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { package_version_schema } from './schemas'

vi.mock('node:fs', () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}))

const { readFileSync: read_file_sync, writeFileSync: write_file_sync } = await import('node:fs')
const { bump_version } = await import('./bump-version')

const import_time_write_calls = vi.mocked(write_file_sync).mock.calls.length

const MOCK_PKG = JSON.stringify({ name: 'kit', version: '1.2.3' }, undefined, '\t')

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(read_file_sync).mockReturnValue(MOCK_PKG)
})

describe('bump_version — version increment', () => {
	it('increments patch version', () => {
		bump_version('patch')

		expect(vi.mocked(write_file_sync)).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining('"version": "1.2.4"'),
		)
	})

	it('increments minor version and resets patch', () => {
		bump_version('minor')

		expect(vi.mocked(write_file_sync)).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining('"version": "1.3.0"'),
		)
	})

	it('increments major version and resets minor and patch', () => {
		bump_version('major')

		expect(vi.mocked(write_file_sync)).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining('"version": "2.0.0"'),
		)
	})
})

describe('bump_version — key order preservation', () => {
	it('preserves original key order after version bump', () => {
		bump_version('patch')

		expect(vi.mocked(write_file_sync)).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringMatching(/"name"[\s\S]*"version"/u),
		)
	})
})

describe('bump_version — JSON-safe write', () => {
	it('writes valid parseable JSON after version bump', () => {
		bump_version('patch')

		const [, written_content] = vi.mocked(write_file_sync).mock.calls[0] ?? []

		if (typeof written_content !== 'string') throw new Error('Expected string content')

		expect(JSON.parse(written_content)).toMatchObject({ version: '1.2.4' })
	})
})

describe('bump-version — side-effect-free import', () => {
	it('does not call writeFileSync on import', () => {
		expect(import_time_write_calls).toBe(0)
	})
})

describe('package_version_schema — valid input', () => {
	it('parses a semver version string', () => {
		const result = package_version_schema.parse({ version: '1.2.3' })

		expect(result.version).toBe('1.2.3')
	})

	it('strips unknown fields from the result', () => {
		const result = package_version_schema.parse({ version: '0.1.0', name: 'kit', extra: true })

		expect(result).toStrictEqual({ version: '0.1.0' })
	})
})

describe('package_version_schema — invalid input', () => {
	it('throws ZodError when version field is missing', () => {
		expect(() => package_version_schema.parse({ name: 'kit' })).toThrow(ZodError)
	})

	it('throws ZodError when version is a number instead of string', () => {
		expect(() => package_version_schema.parse({ version: 42 })).toThrow(ZodError)
	})

	it('throws ZodError for non-object input', () => {
		expect(() => package_version_schema.parse('string')).toThrow(ZodError)
	})
})
