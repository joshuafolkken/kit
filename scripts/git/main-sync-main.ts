#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { main_sync } from './main-sync'

// The `josh main:sync` entry, kept apart from `main-sync.ts` because `observations-flush.ts` imports
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await main_sync.run(process.argv.slice(ARGV_OFFSET))
}
