#!/usr/bin/env tsx
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CATALOG_FILE, generate_catalog } from './generate-catalog'

// The catalog-only entry `main:merge` runs on a conflicted catalog, kept apart from
// `generate-catalog.ts` because `command-derive.ts` imports that one: a bundle is one file, so a main
// guard there would fire for every command that carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync(CATALOG_FILE, generate_catalog())
}
