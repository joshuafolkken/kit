#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { error_text } from '#scripts/lib/error-message'
import { git_gh_checks_failed } from './git-gh-checks-failed'

// The `josh checks:failed [<PR|sha>]` entry, kept apart from `git-gh-checks-failed.ts` so a bundle
// importing that module does not fire this main guard (joshuafolkken/kit#4186).

const ARGV_OFFSET = 2

async function main(argv: ReadonlyArray<string>): Promise<void> {
	const [target] = argv

	try {
		console.info(await git_gh_checks_failed.report(target))
	} catch (error) {
		console.error(error_text.message_of(error))
		process.exitCode = 1
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { main }
