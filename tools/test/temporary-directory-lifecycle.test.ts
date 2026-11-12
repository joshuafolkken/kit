import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, expect, it } from 'vitest'
import { temporary_directory } from './temporary-directory'

const state = { previous: '', suite_root: '' }

// Registered first so Vitest's stack order checks the helper's completed teardown.
afterEach(() => {
	expect(existsSync(state.previous)).toBe(false)
	expect(existsSync(state.suite_root)).toBe(true)
})

afterAll(() => {
	expect(existsSync(state.suite_root)).toBe(false)
})

const create_test = temporary_directory()
const create_suite = temporary_directory('suite')
const suite_root = create_suite('temporary-directory-suite-')

state.suite_root = suite_root

it('cleans a test root through the real Vitest hook', () => {
	state.previous = create_test(path.join(suite_root, 'test-'))
	writeFileSync(path.join(state.previous, 'file'), 'content')

	expect(existsSync(state.previous)).toBe(true)
})

it('keeps the suite root across tests after removing the previous test root', () => {
	expect(existsSync(state.previous)).toBe(false)
	expect(existsSync(suite_root)).toBe(true)
	state.previous = create_test(path.join(suite_root, 'next-'))
})
