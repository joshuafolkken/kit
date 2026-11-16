import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test_file_environment } from '#tools/test/test-file-environment'
import { TEST_FILE_KEY } from '#tools/test/unit-guard-environment'
import { afterEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#7638: a shim the network guard records cannot see which test spawned it, so each
// worker names its running test file in the environment the shim inherits.

const THIS_FILE = path.relative(process.cwd(), fileURLToPath(import.meta.url))
const RELATIVE_FILE = path.join('scripts', 'example.test.ts')
const ABSOLUTE_FILE = path.join(process.cwd(), RELATIVE_FILE)

describe('test_file_environment — armed for the run this test is part of', () => {
	it('names this very test file in the worker environment', () => {
		expect(process.env[TEST_FILE_KEY]).toBe(THIS_FILE)
	})
})

describe('test_file_environment.name_test_file', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('names the file relative to the checkout, the way vitest reports it', () => {
		vi.stubEnv(TEST_FILE_KEY, '')
		test_file_environment.name_test_file(ABSOLUTE_FILE)

		expect(process.env[TEST_FILE_KEY]).toBe(RELATIVE_FILE)
	})

	// A file that is not running a test must not inherit the name of the one before it.
	it('clears the name when no test file is running', () => {
		vi.stubEnv(TEST_FILE_KEY, RELATIVE_FILE)
		test_file_environment.name_test_file(undefined)

		expect(process.env[TEST_FILE_KEY]).toBeUndefined()
	})
})
