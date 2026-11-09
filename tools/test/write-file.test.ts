import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { temporary_directory } from './temporary-directory'
import { write_file } from './write-file'

const PREFIX = 'write-file-'
const make_directory = temporary_directory()

describe('write_file', () => {
	it('creates the missing parent directories under the root', () => {
		const root = make_directory(PREFIX)

		write_file(root, 'a/b/c.txt', 'nested\n')

		expect(readFileSync(path.join(root, 'a/b/c.txt'), 'utf8')).toBe('nested\n')
	})

	it('overwrites a file that already exists', () => {
		const root = make_directory(PREFIX)

		write_file(root, 'file.txt', 'first\n')
		write_file(root, 'file.txt', 'second\n')

		expect(readFileSync(path.join(root, 'file.txt'), 'utf8')).toBe('second\n')
	})
})
