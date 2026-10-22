#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { run_ship_removed_rows } from '#scripts/run/ship/run-ship-removed-rows'
import { test_related } from './test-related'

// The `josh test:related` entry, kept apart from `test-related.ts` because `check-inputs.ts` imports
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186). A green run then shows the tests the change removed, the one place a run
// meets them before `josh ship` (joshuafolkken/kit#4563).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const exit_code = await test_related.run_related_tests(
		process.argv.slice(changed_file_scope.ARGV_START),
	)

	if (exit_code === 0) await run_ship_removed_rows.surface()
	process.exitCode = exit_code
}
