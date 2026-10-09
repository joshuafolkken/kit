#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { error_text } from '#scripts/lib/error-message'
import { observations_flush } from './observations-flush'

const FAILURE_EXIT_CODE = 1

// The refusals are the command's whole safety story, so they are printed as the message rather than
// as a stack: "this checkout is on a feature branch" and "the tree holds somebody else's work" are
// both things the person fixes in one step, and a trace hides the sentence that says which.
//
// **It acts on the checkout it runs in**. A lane's ledger lines merge with
// the lane's own pull request, so a lane has nothing to flush and is refused like any feature branch.
async function main(): Promise<void> {
	try {
		console.info(await observations_flush.flush(new Date()))
	} catch (error) {
		console.error(error_text.message_of(error))
		process.exit(FAILURE_EXIT_CODE)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { main }
