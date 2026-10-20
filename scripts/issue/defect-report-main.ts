#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { defect_report_cli } from './defect-report-cli'

// The `josh defect:report` entry, kept apart from `defect-report-cli.ts` so a bundle carrying that
// module never fires this guard (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await defect_report_cli.run(process.argv.slice(ARGV_OFFSET))
}
