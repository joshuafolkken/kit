import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { package_version_schema } from './schemas'

vi.mock('node:fs', () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}))

const MOCK_PKG = JSON.stringify({ name: 'kit', version: '1.2.3' }, undefined, '\t')
const ORIGINAL_ARGV = process.argv[2] ?? ''

afterEach(() => {
	process.argv[2] = ORIGINAL_ARGV
})

describe('bump-version.ts — version increment', () => {
	beforeEach(() => {
		vi.resetModules()
	})

	it('increments patch version', async () => {
		process.argv[2] = 'patch'

		const { readFileSync: read_file_sync, writeFileSync: write_file_sync } = await import('node:fs')

		vi.mocked(read_file_sync).mockReturnValue(MOCK_PKG)

		await import('./bump-version')

		expect(vi.mocked(write_file_sync)).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining('"version": "1.2.4"'),
		)
	})

	it('increments minor version and resets patch', async () => {
		process.argv[2] = 'minor'

		const { readFileSync: read_file_sync, writeFileSync: write_file_sync } = await import('node:fs')

		vi.mocked(read_file_sync).mockReturnValue(MOCK_PKG)

		await import('./bump-version')

		expect(vi.mocked(write_file_sync)).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining('"version": "1.3.0"'),
		)
	})

	it('increments major version and resets minor and patch', async () => {
		process.argv[2] = 'major'

		const { readFileSync: read_file_sync, writeFileSync: write_file_sync } = await import('node:fs')

		vi.mocked(read_file_sync).mockReturnValue(MOCK_PKG)

		await import('./bump-version')

		expect(vi.mocked(write_file_sync)).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining('"version": "2.0.0"'),
		)
	})
})

describe('bump-version.ts — key order preservation', () => {
	beforeEach(() => {
		vi.resetModules()
	})

	it('preserves original key order after version bump', async () => {
		process.argv[2] = 'patch'

		const { readFileSync: read_file_sync, writeFileSync: write_file_sync } = await import('node:fs')

		vi.mocked(read_file_sync).mockReturnValue(MOCK_PKG)

		await import('./bump-version')

		expect(vi.mocked(write_file_sync)).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringMatching(/"name"[\s\S]*"version"/u),
		)
	})
})

describe('bump-version.ts — JSON-safe write', () => {
	beforeEach(() => {
		vi.resetModules()
	})

	it('writes valid parseable JSON after version bump', async () => {
		process.argv[2] = 'patch'

		const { readFileSync: read_file_sync, writeFileSync: write_file_sync } = await import('node:fs')

		vi.mocked(read_file_sync).mockReturnValue(MOCK_PKG)

		await import('./bump-version')

		const [, written_content] = vi.mocked(write_file_sync).mock.calls[0] ?? []

		if (typeof written_content !== 'string') throw new Error('Expected string content')

		expect(JSON.parse(written_content)).toMatchObject({ version: '1.2.4' })
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
