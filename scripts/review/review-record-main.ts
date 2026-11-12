#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { review_record_cli } from './review-record-cli'
import { review_record_slot } from './review-record-slot'

// The `josh review:record` entry, kept apart from `review-record-cli.ts` because `run-ship-review.ts`
// imports that one: a bundle is one file, so a main guard there would fire for every command that
// carries it (joshuafolkken/kit#4186). `--from-slot` expands first, in `review-record-slot.ts`, for
// the same import.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await review_record_slot.run(
		process.argv.slice(ARGV_OFFSET),
		review_record_cli.run,
	)
}
