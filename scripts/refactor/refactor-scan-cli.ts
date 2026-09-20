#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { refactor_scan } from './refactor-scan'

// The `josh refactor:scan` entry point. It takes no arguments: the scope is the changed files, or
// `scripts/` when nothing changed, decided the same way for every run (joshuafolkken/kit#2180).

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await refactor_scan.run_scan()
}
