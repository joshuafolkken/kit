import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ts_entry_loader } from './ts-entry-loader'

// joshuafolkken/kit#6401. The dist launcher leaves `execArgv` without a loader, so a detached `.ts`
// entry has to be handed one explicitly.
const PLAIN_NODE = ['--disable-warning=ExperimentalWarning']
const WITH_TSX = ['--import', 'tsx']

describe('ts_entry_loader.loader_argv', () => {
	it('adds the tsx loader when the parent carries none', () => {
		const argv = ts_entry_loader.loader_argv(PLAIN_NODE)

		expect(argv).toStrictEqual([
			...PLAIN_NODE,
			ts_entry_loader.IMPORT_FLAG,
			ts_entry_loader.loader_url(),
		])
	})

	it('keeps the parent flags unchanged when a tsx loader is already there', () => {
		expect(ts_entry_loader.loader_argv(WITH_TSX)).toStrictEqual(WITH_TSX)
	})

	it('keeps the parent flags unchanged when the loader is a resolved tsx path', () => {
		const resolved = ['--import', 'file:///repo/node_modules/tsx/dist/loader.mjs']

		expect(ts_entry_loader.loader_argv(resolved)).toStrictEqual(resolved)
	})

	it('adds the loader when a flag only mentions tsx in an unrelated path', () => {
		const unrelated = ['--env-file-if-exists=/home/me/tsx-demo/.env']

		expect(ts_entry_loader.loader_argv(unrelated)).toHaveLength(unrelated.length + WITH_TSX.length)
	})
})

describe('ts_entry_loader.loader_url', () => {
	it('points at the tsx loader file kit depends on', () => {
		const url = ts_entry_loader.loader_url()

		expect(url).toMatch(/^file:.*\/tsx\//u)
		expect(existsSync(fileURLToPath(url))).toBe(true)
	})
})
