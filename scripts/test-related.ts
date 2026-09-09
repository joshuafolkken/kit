#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { changed_file_scope } from './changed-file-scope'
import type { GateTree } from './gate-tree'
import { review_stamps } from './review/review-stamps'
import { scoped_green } from './scoped-green'
import { related_scope } from './test-related-scope'
import { test_unit_guard } from './test-unit-guard'

// `josh test:related` — the unit check an implementation loop runs between edits
// (joshuafolkken/kit#1257). The narrowing itself is `test-related-scope.ts` over the shared
// decision in `changed-file-scope.ts`; this is the process around it — how the run reaches vitest
// through the same guard `josh test:unit` goes through.
//
// **A green run leaves a record of the tree it was green on** (joshuafolkken/kit#1511), so
// `josh review:brief` can tell a tree this check has read from one it has not. What the record means,
// and the three states in which it is withheld, are `scoped-green.ts`.

// **A skipped vitest exits 0, and a zero from a run that started nothing must vouch for no tree.**
// `test_unit_guard.report_no_run` returns 0 on its skip branch — vitest not installed — so in a
// project with no unit suite the record would say the tests were green over a run in which none
// executed, and `josh review:brief` would stop refusing on the strength of it. **The guard's own
// decision is asked again rather than re-derived here**, so the two can never disagree; it is asked
// only when a record is otherwise due, since the question costs a project-wide glob.
function conclusive_tree(before: GateTree | undefined): GateTree | undefined {
	if (before === undefined) return undefined

	const action = test_unit_guard.resolve_guard_action(
		test_unit_guard.is_vitest_installed(process.cwd()),
		test_unit_guard.has_unit_tests(process.cwd()),
	)

	return action === 'run' ? before : undefined
}

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

	const before = await scoped_green.read_before(command_arguments)
	const exit_code = await test_unit_guard.run_guarded_vitest(
		process.cwd(),
		related_scope.vitest_arguments(scope, changed_file_scope.flags_of(command_arguments)),
		related_scope.COMMAND_NAME,
		related_scope.describe_scope(scope, root),
	)

	await scoped_green.record_if_green(review_stamps.test_related_stamp, {
		before: conclusive_tree(before),
		exit_code,
	})

	return exit_code
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_related_tests(process.argv.slice(changed_file_scope.ARGV_START))
}

const test_related = { run_related_tests }

export { test_related }
