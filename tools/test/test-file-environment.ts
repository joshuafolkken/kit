import path from 'node:path'
import { expect } from 'vitest'
import { TEST_FILE_KEY } from './unit-guard-environment'

// Runs in every worker, once per test file and before the file is imported, so every `gh` or `git`
// the file spawns — at import, in a hook or in a test — inherits the file's path, and the network
// guard's record names the file that made the call (joshuafolkken/kit#7638). Vitest re-runs setup
// files per file even where `isolate: false` reuses the worker, so the value never outlives its file.
//
// Relative to the checkout, so the name reads the way vitest's own `FAIL` lines do and a rerun can
// take it as it stands.
function name_test_file(test_path: string | undefined): void {
	if (test_path === undefined) Reflect.deleteProperty(process.env, TEST_FILE_KEY)
	else process.env[TEST_FILE_KEY] = path.relative(process.cwd(), test_path)
}

name_test_file(expect.getState().testPath)

const test_file_environment = { name_test_file }

export { test_file_environment }
