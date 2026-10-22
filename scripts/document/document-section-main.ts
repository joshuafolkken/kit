#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { document_section_cli } from './document-section-cli'

// The `josh doc:section` entry, kept apart from `document-section-cli.ts` because other modules import
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = document_section_cli.run(process.argv.slice(ARGV_OFFSET))
}
