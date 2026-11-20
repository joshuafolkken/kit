import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ts_entry_loader } from '#scripts/run/ts-entry-loader'
import { describe, expect, it } from 'vitest'
import { run_board_worker_entry } from './run-board-worker-entry'

// joshuafolkken/kit#8344: a board built into `dist/` starts its worker's bundle under plain node; a
// board run from source starts the source worker with the TypeScript loader.

const { SOURCE_URL, WORKER_SCRIPT, launch_of } = run_board_worker_entry
const LOADER = [ts_entry_loader.IMPORT_FLAG, ts_entry_loader.loader_url()]
const PACKAGE_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BUNDLE = path.join(PACKAGE_DIRECTORY, 'dist', 'commands', 'run-board-gather-worker.js')

describe('run_board_worker_entry.launch_of from the bundle', () => {
	it('starts the dist bundle of the worker', () => {
		expect(fileURLToPath(launch_of(true, []).url)).toBe(BUNDLE)
	})

	it('adds no TypeScript loader', () => {
		expect(launch_of(true, []).exec_argv).toStrictEqual([])
	})
})

describe('run_board_worker_entry.launch_of from source', () => {
	it('starts the source worker', () => {
		expect(fileURLToPath(launch_of(false, []).url)).toBe(
			path.join(PACKAGE_DIRECTORY, WORKER_SCRIPT),
		)
		expect(SOURCE_URL.href).toBe(launch_of(false, []).url.href)
	})

	it('adds the loader for a parent with no loader flags', () => {
		expect(launch_of(false, []).exec_argv).toStrictEqual(LOADER)
	})

	it('keeps an existing parent loader without adding it twice', () => {
		expect(launch_of(false, LOADER).exec_argv).toStrictEqual(LOADER)
	})
})
