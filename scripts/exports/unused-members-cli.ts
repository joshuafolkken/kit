#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { project_checks } from '#scripts/gate/project-checks'
import { unused_members_check } from './unused-members-check'

// The `josh exports:unused` entry point: the whole-program scan the gate runs, with no arguments.
// `josh lint:related` spawns it with the changed files (`spawn_unused_members`), narrowing the scan;
// that child's `argv[1]` is the bundle, or the source when `dist` is stale.
if (
	process.argv[1] === fileURLToPath(import.meta.url) ||
	unused_members_check.is_bundle_entry(process.argv[1])
) {
	const FILE_ARGUMENTS = 2
	const files = process.argv.slice(FILE_ARGUMENTS)

	process.exitCode = await unused_members_check.run_unused_members(
		project_checks.project_root(process.cwd()),
		files.length === 0 ? undefined : files,
	)
}
