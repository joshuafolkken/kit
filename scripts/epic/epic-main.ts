#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { error_text } from '#scripts/lib/error-message'
import { epic_command } from './epic'

// The `josh epic` entry, kept apart from `epic.ts` because `run:split` imports that one: a bundle is
// one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186). `process.exitCode` rather than `process.exit()`, so the report on standard
// output drains first.
//
// A `gh` failure carries its stderr as the message, which is the useful part; printing it alone
// keeps a routine "not authenticated" or "label not found" from arriving as a stack trace.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2
	const FAILURE_EXIT_CODE = 1

	try {
		process.exitCode = await epic_command.run(process.argv.slice(ARGV_OFFSET))
	} catch (error) {
		console.error(`✖ ${error_text.message_of(error)}`)
		process.exitCode = FAILURE_EXIT_CODE
	}
}
