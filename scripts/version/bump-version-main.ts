#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_bump_version } from './bump-version'

// The `josh bump` entry, kept apart from `bump-version.ts` because `release-publish.ts` imports that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = run_bump_version(process.argv.slice(ARGV_OFFSET))
}
