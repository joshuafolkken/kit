#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { defect_origin_cli } from './defect-origin-cli'

// The `josh defect:origin` entry, kept apart from `defect-origin-cli.ts` so a bundle carrying that
// module never fires this guard (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await defect_origin_cli.run(process.argv.slice(ARGV_OFFSET))
}
