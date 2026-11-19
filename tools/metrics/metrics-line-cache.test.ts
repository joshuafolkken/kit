import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { metrics_line_cache } from './metrics-line-cache'

const OPTIONS = { max: 300, skipBlankLines: true, skipComments: true }
const TEXT = 'const a = 1\n'
const RECORD_NAME = 'record.json'
const KEY_PREFIX = 'josh-line-key-'
const STORE_PREFIX = 'josh-line-store-'
const CONFIG_NAME = 'eslint.config.js'
const make_directory = temporary_directory()

function file(directory: string, name: string, text: string): string {
	const target = path.join(directory, name)

	mkdirSync(path.dirname(target), { recursive: true })
	writeFileSync(target, text)

	return target
}

describe('metrics_line_cache.entry_key', () => {
	it('keys the same text under the same options alike, wherever the file sits', () => {
		const left = file(make_directory(KEY_PREFIX), 'scripts/a.ts', TEXT)
		const right = file(make_directory(KEY_PREFIX), 'tools/b.ts', TEXT)

		expect(metrics_line_cache.entry_key(left, OPTIONS)).toBe(
			metrics_line_cache.entry_key(right, OPTIONS),
		)
	})

	it('keys a file anew once its text, its options or its extension change', () => {
		const directory = make_directory(KEY_PREFIX)
		const source = file(directory, 'a.ts', TEXT)
		const before = metrics_line_cache.entry_key(source, OPTIONS)

		expect(metrics_line_cache.entry_key(source, { ...OPTIONS, skipComments: false })).not.toBe(
			before,
		)
		expect(metrics_line_cache.entry_key(file(directory, 'a.js', TEXT), OPTIONS)).not.toBe(before)
		writeFileSync(source, `${TEXT}const b = 2\n`)
		expect(metrics_line_cache.entry_key(source, OPTIONS)).not.toBe(before)
	})

	it('gives an unreadable file no key, so it is counted', () => {
		const missing = path.join(make_directory(KEY_PREFIX), 'missing.ts')

		expect(metrics_line_cache.entry_key(missing, OPTIONS)).toBeUndefined()
	})
})

describe('metrics_line_cache.file_store', () => {
	it('loads what it saved, beside what another run saved since', () => {
		const target = path.join(make_directory(STORE_PREFIX), RECORD_NAME)
		const store = metrics_line_cache.file_store(target)

		store.save(new Map([['first', 1]]))
		metrics_line_cache.file_store(target).save(new Map([['second', 2]]))

		expect([...store.load()]).toStrictEqual([
			['first', 1],
			['second', 2],
		])
	})

	it('reads a record that no longer parses as empty', () => {
		const target = file(make_directory(STORE_PREFIX), RECORD_NAME, '{"key": "seven"}')

		expect(metrics_line_cache.file_store(target).load().size).toBe(0)
	})

	it('holds nothing in the store that counts every file afresh', () => {
		metrics_line_cache.no_store.save(new Map([['key', 1]]))

		expect(metrics_line_cache.no_store.load().size).toBe(0)
	})
})

// joshuafolkken/kit#8205: a change to how a line is counted opens an empty record.
describe('metrics_line_cache.cache_path', () => {
	it('moves when the eslint configuration that counts the lines changes', () => {
		const root = make_directory('josh-line-ruler-')

		file(root, CONFIG_NAME, 'export default []\n')
		const before = metrics_line_cache.cache_path(root)

		file(root, CONFIG_NAME, "export default [{ rules: { 'max-lines': 'off' } }]\n")

		expect(metrics_line_cache.cache_path(root)).not.toBe(before)
		expect(metrics_line_cache.cache_path(root)).toBe(metrics_line_cache.cache_path(root))
	})
})
