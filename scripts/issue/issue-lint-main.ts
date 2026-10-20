#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_lint_cli } from './issue-lint-cli'

// The `josh issue:lint` entry, kept apart from `issue-lint-cli.ts` because other modules import that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const PATH_ARGUMENT_INDEX = 2

	process.exitCode = await issue_lint_cli.run(process.argv[PATH_ARGUMENT_INDEX])
}
