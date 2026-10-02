import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_mock = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({ readFileSync: read_mock }))

const { file_reader } = await import('./read-file')

const CONTENT = 'content'
const ANY_FILE = 'any.txt'
const MISSING_FILE = 'missing.txt'
const LOCKED_FILE = 'locked.txt'
const ABSENT = 'ENOENT'
const DENIED = 'EACCES'
const RETURNS_CONTENT = 'returns the file content when the file exists'
const THROWS_OTHER = 'throws a failure other than absence'
const UNDEFINED_WHEN_ABSENT = 'returns undefined when the file is absent'

function fail_with(code: string): void {
	read_mock.mockImplementation(() => {
		throw Object.assign(new Error(code), { code })
	})
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('file_reader.read_file_or_empty', () => {
	it(RETURNS_CONTENT, () => {
		read_mock.mockReturnValue(CONTENT)

		expect(file_reader.read_file_or_empty(ANY_FILE)).toBe(CONTENT)
	})

	it('returns an empty string when the file is absent', () => {
		fail_with(ABSENT)

		expect(file_reader.read_file_or_empty(MISSING_FILE)).toBe('')
	})

	it(THROWS_OTHER, () => {
		fail_with(DENIED)

		expect(() => file_reader.read_file_or_empty(LOCKED_FILE)).toThrow(DENIED)
	})
})

describe('file_reader.read_optional', () => {
	it(RETURNS_CONTENT, () => {
		read_mock.mockReturnValue(CONTENT)

		expect(file_reader.read_optional(ANY_FILE)).toBe(CONTENT)
	})

	it(UNDEFINED_WHEN_ABSENT, () => {
		fail_with(ABSENT)

		expect(file_reader.read_optional(MISSING_FILE)).toBeUndefined()
	})

	it(THROWS_OTHER, () => {
		fail_with('EISDIR')

		expect(() => file_reader.read_optional('a-directory')).toThrow('EISDIR')
	})

	it('throws an error that carries no code rather than reading it as absence', () => {
		read_mock.mockImplementation(() => {
			throw new Error(ABSENT)
		})

		expect(() => file_reader.read_optional(ANY_FILE)).toThrow(ABSENT)
	})
})

describe('file_reader.read_if_readable', () => {
	it(RETURNS_CONTENT, () => {
		read_mock.mockReturnValue(CONTENT)

		expect(file_reader.read_if_readable(ANY_FILE)).toBe(CONTENT)
	})

	it(UNDEFINED_WHEN_ABSENT, () => {
		fail_with(ABSENT)

		expect(file_reader.read_if_readable(MISSING_FILE)).toBeUndefined()
	})

	it('returns undefined for a failure other than absence', () => {
		fail_with(DENIED)

		expect(file_reader.read_if_readable(LOCKED_FILE)).toBeUndefined()
	})
})
