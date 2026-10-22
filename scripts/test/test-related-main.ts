#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { test_related } from './test-related'

// The `josh test:related` entry, kept apart from `test-related.ts` because `check-inputs.ts` imports
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await test_related.run_related_tests(
		process.argv.slice(changed_file_scope.ARGV_START),
	)
}
