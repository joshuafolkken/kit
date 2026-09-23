#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { observation_ledger_home } from './observation-ledger-home'
import { observations_flush } from './observations-flush'

const FAILURE_EXIT_CODE = 1

function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

// **From a lane, the flush acts on the primary checkout** (joshuafolkken/kit#2419). That is where the
// ledger lives (`observation-ledger-home.ts`), and a lane's own checkout is never the one a flush may
// switch — so the process moves there first, and every refusal after it is about that checkout, which
// the prefix names so a "run `pnpm josh ms` first" is read as advice for the primary checkout.
function enter_ledger_home(): string {
	if (!observation_ledger_home.is_lane()) return ''

	const root = observation_ledger_home.ledger_root()

	process.chdir(root)

	return `The observation ledger lives in the primary checkout, so this flush acts on ${root}: `
}

// The refusals are the command's whole safety story, so they are printed as the message rather than
// as a stack: "this checkout is on a feature branch" and "the tree holds somebody else's work" are
// both things the person fixes in one step, and a trace hides the sentence that says which.
async function main(): Promise<void> {
	const prefix = enter_ledger_home()

	try {
		console.info(`${prefix}${await observations_flush.flush(new Date())}`)
	} catch (error) {
		console.error(`${prefix}${message_of(error)}`)
		process.exit(FAILURE_EXIT_CODE)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { main }
