#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_rework_candidates_cli } from './issue-rework-candidates-cli'

// The `josh issue:rework-candidates` entry, kept apart from `issue-rework-candidates-cli.ts` so a
// bundle carrying that module never fires this guard (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await issue_rework_candidates_cli.run(process.argv.slice(ARGV_OFFSET))
}
