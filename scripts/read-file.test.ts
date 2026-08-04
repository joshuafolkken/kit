import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_mock = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({ readFileSync: read_mock }))

const { file_reader } = await import('./read-file')

beforeEach(() => {
	vi.clearAllMocks()
})

describe('file_reader.read_file_or_empty', () => {
	it('returns the file content when the file exists', () => {
		read_mock.mockReturnValue('content')

		expect(file_reader.read_file_or_empty('any.txt')).toBe('content')
	})

	it('returns an empty string when the file is absent', () => {
		read_mock.mockImplementation(() => {
			throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
		})

		expect(file_reader.read_file_or_empty('missing.txt')).toBe('')
	})
})
