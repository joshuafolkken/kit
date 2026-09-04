#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { changed_file_scope } from './changed-file-scope'
import { related_scope } from './test-related-scope'
import { test_unit_guard } from './test-unit-guard'

// `josh test:related` — the unit check an implementation loop runs between edits
// (joshuafolkken/kit#1257). The narrowing itself is `test-related-scope.ts` over the shared
// decision in `changed-file-scope.ts`; this is the process around it — how the run reaches vitest
// through the same guard `josh test:unit` goes through.

async function run_related_tests(command_arguments: ReadonlyArray<string>): Promise<number> {
	const root = await changed_file_scope.repository_root_or_cwd()
	const scope = await changed_file_scope.resolve_command_scope({
		command_arguments,
		root,
		inputs: related_scope.scope_inputs(existsSync),
	})

	changed_file_scope.report_unusable_arguments(
		command_arguments,
		scope,
		related_scope.COMMAND_LABEL,
	)

	return await test_unit_guard.run_guarded_vitest(
		process.cwd(),
		related_scope.vitest_arguments(scope, changed_file_scope.flags_of(command_arguments)),
		related_scope.COMMAND_NAME,
		related_scope.describe_scope(scope, root),
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_related_tests(process.argv.slice(changed_file_scope.ARGV_START))
}

const test_related = { run_related_tests }

export { test_related }
