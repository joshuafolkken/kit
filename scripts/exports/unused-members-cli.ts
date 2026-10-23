#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { project_checks } from '#scripts/gate/project-checks'
import { unused_members_check } from './unused-members-check'

// The `josh exports:unused` entry point: the whole-program scan the gate runs. `josh lint:related`
// imports the check itself, narrowed to the changed files.

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await unused_members_check.run_unused_members(
		project_checks.project_root(process.cwd()),
	)
}
