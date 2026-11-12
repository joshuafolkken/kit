#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { upstream_interrupt_cli } from './upstream-interrupt-cli'

// The `josh upstream:interrupt` entry, kept apart from `upstream-interrupt-cli.ts` so the module stays
// importable without a main guard that a bundle would fire (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await upstream_interrupt_cli.run(process.argv.slice(ARGV_OFFSET))
}
