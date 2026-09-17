#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { observations_flush } from './observations-flush'

const FAILURE_EXIT_CODE = 1

// The refusals are the command's whole safety story, so they are printed as the message rather than
// as a stack: "this checkout is on a feature branch" and "the tree holds somebody else's work" are
// both things the person fixes in one step, and a trace hides the sentence that says which.
async function main(): Promise<void> {
	try {
		console.info(await observations_flush.flush(new Date()))
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(FAILURE_EXIT_CODE)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { main }
