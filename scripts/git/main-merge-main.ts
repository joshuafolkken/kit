#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { main_merge } from './main-merge'

// The `josh main:merge` entry, kept apart from `main-merge.ts` because `run-ship-sync.ts` imports
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await main_merge.run(process.argv.slice(ARGV_OFFSET))
}
