#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { document_byte_check } from '#scripts/document/document-byte-check'
import { scoped_green } from '#scripts/gate/scoped-green'
import { changed_file_scope, type ChangedFileScope } from '#scripts/git/changed-file-scope'
import { ESLINT_RELATED_CACHE_FILE } from '#scripts/josh/josh-command-types'
import { review_stamps } from '#scripts/review/review-stamps'
import { lint_parallel } from './lint-parallel'
import { lint_related_scope } from './lint-related-scope'

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
		ESLINT_RELATED_CACHE_FILE,
	)
}

// The byte check over the same scope the lint just ran: the resolved file list when narrowed, and
// the whole budget when lint fell back to the whole tree — so the byte check is a superset in the
// fallback exactly as lint is, never an empty list that would pass silently (joshuafolkken/kit#2176).
function byte_check_exit_code(scope: ChangedFileScope, root: string): number {
	if (scope.mode === 'all') return document_byte_check.check_all(root)

	return document_byte_check.check_files(root, scope.files)
}

// The lint result folded together with the fast byte-ceiling check (joshuafolkken/kit#2176): the
// same check the gate's `document-byte-budget.test.ts` runs, brought forward to this between-edits
// path so a mandated documentation update over its ceiling surfaces in seconds. It reads no change
// of its own — it takes the files this run already resolved, so the git contract is the lint
// command's alone. A lint failure is reported as-is; only a green lint runs the byte check, so the
// two never race to the exit code, and a green tree here is green on both — which is what the record
// below then vouches for.
async function scoped_exit_code(scope: ChangedFileScope, root: string): Promise<number> {
	const lint_exit = await lint_exit_code(scope)
	if (lint_exit !== 0) return lint_exit

	return byte_check_exit_code(scope, root)
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
	const exit_code = await scoped_exit_code(scope, root)

	await scoped_green.record_if_green(review_stamps.lint_related_stamp, { before, exit_code })

	return exit_code
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_related_lint(process.argv.slice(changed_file_scope.ARGV_START))
}

const lint_related = { report_ignored_flags, run_related_lint }

export { lint_related }
