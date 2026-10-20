#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { test_red } from './test-red'

// The `josh test:red` entry, kept apart from `test-red.ts` because `test-red-commit.ts` imports that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await test_red.main(process.argv.slice(ARGV_OFFSET))
}
