#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { stash_pop_cli } from './stash-pop-cli'

// The `josh stash:pop` entry, kept apart from `stash-pop-cli.ts` because `latest-if-required-cli.ts`
// imports that one: a bundle is one file, so a main guard there would fire for every command that
// carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await stash_pop_cli.run(process.argv.slice(ARGV_OFFSET))
}
