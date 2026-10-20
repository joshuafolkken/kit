#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { stash_push_cli } from './stash-push-cli'

// The `josh stash:push` entry, kept apart from `stash-push-cli.ts` because `run-pause.ts` and
// `latest-if-required-cli.ts` import that one: a bundle is one file, so a main guard there would fire
// for every command that carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await stash_push_cli.run(process.argv.slice(ARGV_OFFSET))
}
