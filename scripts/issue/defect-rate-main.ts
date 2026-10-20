#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { defect_rate_cli } from './defect-rate-cli'

// The `josh defect:rate` entry, kept apart from `defect-rate-cli.ts` because other modules import
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await defect_rate_cli.run(process.argv.slice(ARGV_OFFSET))
}
