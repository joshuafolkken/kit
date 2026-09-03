#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { changed_paths } from './git/changed-paths'
import { git_command } from './git/git-command'
import { related_scope, type RelatedScope } from './test-related-scope'
import { test_unit_guard } from './test-unit-guard'

// `josh test:related` — the unit check an implementation loop runs between edits
// (joshuafolkken/kit#1257). The narrowing itself is `test-related-scope.ts`; this is the process
// around it: where the changed files come from, and how the run reaches vitest through the same
// guard `josh test:unit` goes through.

// `process.argv` is [runner, script, ...arguments].
const ARGV_START = 2
const FLAG_PREFIX = '-'

function is_flag(argument: string): boolean {
	return argument.startsWith(FLAG_PREFIX)
}

// The same reading `josh review:level`, `josh eval:scope` and `josh review:brief` decide from — the
// branch diff plus the untracked files — so what this narrows by is what those commands call the
// change, rather than a fourth definition of it.
//
// **Paths are joined onto the repository root, never onto `process.cwd()`.** Both halves of that
// reading print repository-root-relative paths — the untracked half only because
// `git_command.untracked_names` asks it to — so a command typed in a subdirectory would otherwise
// resolve every one of them to a file that does not exist, and the presence filter would drop the
// whole set: a fall back to the full suite that looks exactly like a change with nothing to narrow
// by.
//
// A failure answers `undefined` rather than an empty list: the two are opposite inputs to
// `resolve_scope`, and only one of them means "could not tell".
async function read_changed_files(root: string): Promise<ReadonlyArray<string> | undefined> {
	try {
		const relative_paths = await changed_paths.read_changed_paths(false)

		return relative_paths.map((relative) => path.join(root, relative))
	} catch {
		return undefined
	}
}

// The root is resolved once and used for both the paths and the line that prints them: relativizing
// the printed list against `process.cwd()` instead would name a file in this repository as
// `../scripts/thing.ts` for anyone running from a subdirectory. Where git cannot answer, `cwd` is
// the honest fallback — the reading below will fail too, and the run falls back to the whole suite.
async function repository_root_or_cwd(): Promise<string> {
	try {
		return await git_command.repository_root()
	} catch {
		return process.cwd()
	}
}

// Explicit file arguments win over the git reading, which is what makes the narrowing testable by
// hand and usable from a hook that already knows which file it just wrote.
async function resolve_scope(
	explicit_files: ReadonlyArray<string>,
	root: string,
): Promise<RelatedScope> {
	if (explicit_files.length === 0) {
		return related_scope.resolve_scope(await read_changed_files(root), existsSync)
	}

	return related_scope.resolve_scope(
		explicit_files.map((file) => path.resolve(file)),
		existsSync,
	)
}

// A file the caller named by hand and this could not use is a mistake worth saying out loud. The
// git-derived set falls back silently on purpose — a change with no source file in it is ordinary —
// but a typed path that resolves to nothing would otherwise be answered with "no changed file is
// one a test can import", which describes a set the caller never handed over.
function report_unusable_arguments(
	explicit_files: ReadonlyArray<string>,
	scope: RelatedScope,
): void {
	const narrowed = new Set(scope.files)
	const unusable = explicit_files.filter((file) => !narrowed.has(path.resolve(file)))

	if (unusable.length === 0) return

	process.stdout.write(
		`${related_scope.COMMAND_LABEL}: ignored — not a file a test can be related to: ${unusable.join(' ')}\n`,
	)
}

async function run_related_tests(command_arguments: ReadonlyArray<string>): Promise<number> {
	const root = await repository_root_or_cwd()
	const explicit_files = command_arguments.filter((argument) => !is_flag(argument))
	const scope = await resolve_scope(explicit_files, root)

	report_unusable_arguments(explicit_files, scope)

	return await test_unit_guard.run_guarded_vitest(
		process.cwd(),
		related_scope.vitest_arguments(
			scope,
			command_arguments.filter((argument) => is_flag(argument)),
		),
		related_scope.COMMAND_NAME,
		related_scope.describe_scope(scope, root),
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_related_tests(process.argv.slice(ARGV_START))
}

const test_related = {
	is_flag,
	report_unusable_arguments,
	repository_root_or_cwd,
	read_changed_files,
	resolve_scope,
	run_related_tests,
}

export { test_related }
