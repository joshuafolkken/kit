#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { changed_file_scope, type ChangedFileScope } from './changed-file-scope'
import { lint_parallel } from './lint-parallel'
import { lint_related_scope } from './lint-related-scope'
import { review_stamps } from './review/review-stamps'
import { scoped_green } from './scoped-green'

// `josh lint:related` — the lint check an implementation loop runs between edits
// (joshuafolkken/kit#1298). The narrowing itself is `lint-related-scope.ts` over the shared
// decision in `changed-file-scope.ts`; this is the process around it — how the run reaches the same
// two child processes `josh lint` runs.

// Flags are named rather than forwarded. `josh test:related` forwards them because it has one
// child; this has two, and prettier and eslint take different ones — `--fix` means something to
// eslint and nothing to `prettier --check`. Sending a flag to both would fail the run over the
// argument list, and dropping it silently would run a check the caller did not ask for, so the run
// says which arguments it ignored.
function report_ignored_flags(command_arguments: ReadonlyArray<string>): void {
	const flags = changed_file_scope.flags_of(command_arguments)

	if (flags.length === 0) return

	process.stdout.write(
		`${lint_related_scope.COMMAND_LABEL}: ignored — prettier and eslint take different flags: ${flags.join(' ')}\n`,
	)
}

// A fallback to the whole project is a superset of the changed files, so it vouches for them too —
// which is why the record below is written from either arm rather than only from the narrow one.
async function lint_exit_code(scope: ChangedFileScope): Promise<number> {
	if (scope.mode === 'all') return await lint_parallel.run_lint_parallel_checks()

	return await lint_parallel.run_lint_checks(
		lint_related_scope.prettier_arguments(scope.files),
		lint_related_scope.eslint_arguments(scope.files),
	)
}

// The narrowing line is printed before either child starts, so a scoped run is never read as a
// whole one, and a fallback says which of the two it was rather than looking like a narrow run
// that found nothing.
//
// **A green run leaves a record of the tree it was green on** (joshuafolkken/kit#1511), so
// `josh review:brief` can tell a tree this check has read from one it has not. What the record means,
// and the three states in which it is withheld, are `scoped-green.ts`.
async function run_related_lint(command_arguments: ReadonlyArray<string>): Promise<number> {
	const root = await changed_file_scope.repository_root_or_cwd()
	const scope = await changed_file_scope.resolve_command_scope({
		command_arguments,
		root,
		inputs: lint_related_scope.scope_inputs(existsSync),
	})

	changed_file_scope.report_unusable_arguments(
		command_arguments,
		scope,
		lint_related_scope.COMMAND_LABEL,
	)
	report_ignored_flags(command_arguments)
	process.stdout.write(`${lint_related_scope.describe_scope(scope, root)}\n`)

	const before = await scoped_green.read_before(command_arguments)
	const exit_code = await lint_exit_code(scope)

	await scoped_green.record_if_green(review_stamps.lint_related_stamp, { before, exit_code })

	return exit_code
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_related_lint(process.argv.slice(changed_file_scope.ARGV_START))
}

const lint_related = { report_ignored_flags, run_related_lint }

export { lint_related }
