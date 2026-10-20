#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cost_cli } from './cost-cli'

// The `josh cost` entry, kept apart from `cost-cli.ts` because `implementation-cut.ts` imports that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = cost_cli.run(process.argv.slice(ARGV_OFFSET))
}
