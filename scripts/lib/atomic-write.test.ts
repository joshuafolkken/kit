import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	type PathLike,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The rename is the one instant both writers' staging files exist at once, so a second write to the
// same target is started from inside the first one's rename.

const before_rename = vi.hoisted(() => vi.fn<() => void>())

vi.mock(import('node:fs'), async (import_original) => {
	const actual = await import_original()

	function rename_after_probe(old_path: PathLike, new_path: PathLike): void {
		before_rename()
		actual.renameSync(old_path, new_path)
	}

	return { ...actual, renameSync: rename_after_probe }
})

const { atomic_write } = await import('./atomic-write')

const scratch = mkdtempSync(path.join(tmpdir(), 'atomic-write-test-'))
const FIRST = 'first'
const SECOND = 'second'
const PRIVATE_MODE = 0o600
const EXECUTABLE_MODE = 0o755
// The permission bits are the low three octal digits of `stat.mode`, below the file-type bits.
const PERMISSION_RANGE = 0o1000
const RENAME_FAILURE = 'rename failed'
const RECORD = 'record.json'

function directory_for(name: string): string {
	const directory = path.join(scratch, name)

	mkdirSync(directory, { recursive: true })

	return directory
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

beforeEach(() => {
	before_rename.mockReset()
})

describe('atomic_write.replace_file — two writes to one target at once', () => {
	it('stages each write under its own name, so neither collides with the other', () => {
		const directory = directory_for('concurrent')
		const target = path.join(directory, RECORD)
		const staged: Array<Array<string>> = []

		before_rename.mockImplementationOnce(function write_again(): void {
			staged.push(readdirSync(directory))
			atomic_write.replace_file(target, SECOND)
		})

		atomic_write.replace_file(target, FIRST)

		expect(staged[0]).toEqual([expect.stringMatching(/^record\.json\..+\.tmp$/u)])
		expect(readFileSync(target, 'utf8')).toBe(FIRST)
		expect(readdirSync(directory)).toEqual([RECORD])
	})
})

describe('atomic_write.replace_file — the written file', () => {
	it('replaces an existing file and creates its directory when absent', () => {
		const target = path.join(scratch, 'nested', 'deeper', 'file.txt')

		atomic_write.replace_file(target, FIRST)
		atomic_write.replace_file(target, SECOND)

		expect(readFileSync(target, 'utf8')).toBe(SECOND)
	})

	it.each([PRIVATE_MODE, EXECUTABLE_MODE])('applies mode %o to the replaced file', (mode) => {
		const target = path.join(directory_for(`mode-${String(mode)}`), 'file')

		atomic_write.replace_file(target, FIRST, { mode })

		expect(statSync(target).mode % PERMISSION_RANGE).toBe(mode)
	})
})

describe('atomic_write.replace_file — the staging file', () => {
	it('stages in the directory it is given and leaves nothing there', () => {
		const staging_directory = directory_for('staging')
		const target = path.join(directory_for('published'), 'cache')
		const staged: Array<Array<string>> = []

		before_rename.mockImplementationOnce(function list_staging(): void {
			staged.push(readdirSync(staging_directory))
		})

		atomic_write.replace_file(target, FIRST, { staging_directory })

		expect(staged[0]).toEqual([expect.stringMatching(/^cache\..+\.tmp$/u)])
		expect(readdirSync(staging_directory)).toEqual([])
	})

	it('removes its staging file and keeps the old content when the rename fails', () => {
		const directory = directory_for('failing')
		const target = path.join(directory, 'kept')

		atomic_write.replace_file(target, FIRST)
		before_rename.mockImplementationOnce(function fail(): void {
			throw new Error(RENAME_FAILURE)
		})

		expect(() => {
			atomic_write.replace_file(target, SECOND)
		}).toThrow(RENAME_FAILURE)
		expect(readFileSync(target, 'utf8')).toBe(FIRST)
		expect(readdirSync(directory)).toEqual(['kept'])
	})
})
