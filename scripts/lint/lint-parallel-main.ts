#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { lint_parallel } from './lint-parallel'

// The `josh lint` entry, kept apart from `lint-parallel.ts` because `lint-related.ts` imports that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
//
// `process.exitCode` rather than `process.exit()`: both reports are buffered and written in one go,
// and `process.exit()` truncates a piped stdout at its buffer size — which is exactly how this
// command is read when `josh gate` runs it as one of four concurrent checks. Setting the code lets
// the writes drain and the process end on its own, which it can, since both children have already
// exited by here.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await lint_parallel.run_lint_command(
		process.argv.slice(changed_file_scope.ARGV_START),
	)
}
