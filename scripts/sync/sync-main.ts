#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { main } from './sync'

// The `josh sync` entry, kept apart from `sync.ts` because `init.ts` imports that one: a bundle is one
// file, so a main guard there would fire for every command that carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	main(process.argv.slice(ARGV_OFFSET))
}
