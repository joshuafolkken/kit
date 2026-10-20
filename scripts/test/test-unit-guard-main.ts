#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { test_unit_guard } from './test-unit-guard'

// The `josh test:unit` entry, kept apart from `test-unit-guard.ts` because the gate and the pre-push
// hook import that one: a bundle is one file, so a main guard there would fire for every command that
// carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await test_unit_guard.run_guarded_unit(
		process.cwd(),
		process.argv.slice(ARGV_OFFSET),
	)
}
