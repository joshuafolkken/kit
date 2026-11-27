#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { producer_brief } from './producer-brief'

// The `josh producer:brief` entry, kept apart from `producer-brief.ts` so a test imports the logic
// without the main guard (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = producer_brief.run(process.argv.slice(ARGV_OFFSET))
}
