import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { stamped_store } from './stamped-store'

// joshuafolkken/kit#7134: the answers a stamped memo held outlive the process that computed them.

const make_directory = temporary_directory('suite')
const VERSION = 'v1'
const KEY = 'key'
const OTHER = 'other'
const STAMP = 'stamp'

function store_file(): string {
	return path.join(make_directory('stamped-store-test-'), 'store.json')
}

// A store at `file` holding `value` under `KEY`, saved and reopened.
function saved(file: string, value: number): void {
	const store = stamped_store.open(file, VERSION, z.number())

	store.of(KEY, STAMP, () => value)
	store.save()
}

describe('stamped_store.open — the answers a saved store holds', () => {
	it('answers from the saved file while the stamp holds, without computing', () => {
		const file = store_file()
		const compute = vi.fn(() => 2)

		saved(file, 1)

		expect(stamped_store.open(file, VERSION, z.number()).of(KEY, STAMP, compute)).toBe(1)
		expect(compute).not.toHaveBeenCalled()
	})

	it('computes again once the stamp moved', () => {
		const file = store_file()

		saved(file, 1)

		expect(stamped_store.open(file, VERSION, z.number()).of(KEY, 'moved', () => 2)).toBe(2)
	})

	it('writes only the kept keys', () => {
		const file = store_file()
		const store = stamped_store.open(file, VERSION, z.number())

		for (const key of [KEY, OTHER]) store.of(key, STAMP, () => 1)
		store.keep(new Set([KEY]))
		store.save()

		const compute = vi.fn(() => 2)
		const reopened = stamped_store.open(file, VERSION, z.number())

		expect(reopened.of(OTHER, STAMP, compute)).toBe(2)
		expect(reopened.of(KEY, STAMP, compute)).toBe(1)
		expect(compute).toHaveBeenCalledOnce()
	})
})

describe('stamped_store.open — a file it cannot trust opens empty', () => {
	it('computes everything again under another version', () => {
		const file = store_file()

		saved(file, 1)

		expect(stamped_store.open(file, 'v2', z.number()).of(KEY, STAMP, () => 2)).toBe(2)
	})

	it('computes everything again when the file does not parse against the schema', () => {
		const file = store_file()

		saved(file, 1)

		expect(stamped_store.open(file, VERSION, z.string()).of(KEY, STAMP, () => 'a')).toBe('a')
	})

	it('opens a corrupt or missing file empty', () => {
		const file = store_file()

		expect(stamped_store.open(file, VERSION, z.number()).of(KEY, STAMP, () => 2)).toBe(2)
		writeFileSync(file, '{not json')
		expect(stamped_store.open(file, VERSION, z.number()).of(KEY, STAMP, () => 3)).toBe(3)
	})

	it('leaves an unwritable target as it was without throwing', () => {
		const file = store_file()

		mkdirSync(file)

		expect(() => {
			saved(file, 1)
		}).not.toThrow()
		expect(() => readFileSync(file, 'utf8')).toThrow()
	})
})
