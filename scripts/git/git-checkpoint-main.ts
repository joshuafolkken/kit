#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_checkpoint } from './git-checkpoint'

// The `josh git:checkpoint` entry, kept apart from `git-checkpoint.ts` so a test imports the logic
// without the main guard (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await git_checkpoint.run(process.argv.slice(ARGV_OFFSET))
}
