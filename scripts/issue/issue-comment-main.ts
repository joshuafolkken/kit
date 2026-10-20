#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_comment_cli } from './issue-comment-cli'

// The `josh issue:comment` entry, kept apart from `issue-comment-cli.ts` because other modules import
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await issue_comment_cli.run(process.argv.slice(ARGV_OFFSET))
}
