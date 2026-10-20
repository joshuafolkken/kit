#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { review_brief_cli } from './review-brief-cli'

// The `josh review:brief` entry, kept apart from `review-brief-cli.ts` because `run-review-cli.ts`
// imports that one: a bundle is one file, so a main guard there would fire for every command that
// carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await review_brief_cli.run(process.argv.slice(ARGV_OFFSET))
}
