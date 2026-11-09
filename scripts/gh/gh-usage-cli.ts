#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { run_carry } from '#scripts/run/carry/run-carry'
import { gh_usage_log } from './gh-usage-log'
import { gh_usage_tally } from './gh-usage-tally'
import { git_gh_transport } from './git-gh-transport'

// `josh gh:usage [--since <instant>]` — the GitHub usage log's lines tallied per command
// (joshuafolkken/kit#6753), read from the one file `gh-usage-log.ts` writes.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const USAGE = 'Usage: josh gh:usage [--since <instant>]'

interface UsageContext {
	repository_directory: () => Promise<string | undefined>
	transport: () => Promise<string>
}

const DEFAULT_CONTEXT: UsageContext = {
	repository_directory: run_carry.repository_directory,
	transport: git_gh_transport.label,
}

// An unknown flag, a stray positional or an instant `Date.parse` cannot read is not valid.
function since_of(argv: ReadonlyArray<string>): { is_valid: boolean; since_ms?: number } {
	try {
		const { values } = parseArgs({ args: [...argv], options: { since: { type: 'string' } } })

		if (values.since === undefined) return { is_valid: true }
		const since_ms = Date.parse(values.since)

		return { is_valid: !Number.isNaN(since_ms), since_ms }
	} catch {
		return { is_valid: false }
	}
}

async function run(
	argv: ReadonlyArray<string>,
	context: UsageContext = DEFAULT_CONTEXT,
): Promise<number> {
	const { is_valid, since_ms } = since_of(argv)
	const repository = await context.repository_directory()

	if (!is_valid || repository === undefined) {
		console.error(is_valid ? 'gh:usage — not in a git repository' : USAGE)

		return FAILURE_EXIT_CODE
	}

	const lines = gh_usage_log.read_lines(gh_usage_log.target_of(repository))
	const tally = gh_usage_tally.tally(lines, since_ms)

	process.stdout.write(`${gh_usage_tally.render(tally, await context.transport())}\n`)

	return SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const gh_usage_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { UsageContext }
export { gh_usage_cli }
