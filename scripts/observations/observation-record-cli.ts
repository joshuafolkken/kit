#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cli_flags } from '#scripts/lib/cli-flags'
import { observation_ledger_home } from './observation-ledger-home'
import {
	observation_record,
	REFUSED_VERDICT,
	type ObservationEntry,
	type RecordResult,
} from './observation-record'

// `josh observation:record <key> <depth> <where> <what>` — count the key's earlier sightings, append
// this one, and answer what the run does next. Exactly one token on stdout:
// `file` on the second sighting, which the promotion rule files; `ledger` on any other, which the line
// alone records. The earlier sightings and the file written go to stderr, so the Issue a `file` answer
// opens can quote the first sighting's date from them.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const ENTRY_FIELDS = 4
const USAGE = 'Usage: josh observation:record <key> <depth> <where> <what> [--checkout <path>]'
const OPTIONS = { checkout: { type: 'string' } } as const

interface RecordArguments {
	entry: ObservationEntry
	checkout: string
}

function entry_of(fields: ReadonlyArray<string>): ObservationEntry {
	const [slug = '', depth = '', where = '', what = ''] = fields

	return { slug, depth, where, what }
}

function parse_arguments(argv: ReadonlyArray<string>): RecordArguments | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed?.positionals.length !== ENTRY_FIELDS) return undefined

	const { checkout } = parsed.values

	return {
		entry: entry_of(parsed.positionals),
		checkout: checkout ?? observation_ledger_home.ledger_root(),
	}
}

function report(result: RecordResult): number {
	if (result.verdict === REFUSED_VERDICT) {
		console.error(`Refused: ${result.reason}\n${USAGE}`)

		return FAILURE_EXIT_CODE
	}

	const sighting = `${String(result.earlier.length)} earlier sighting(s); appended to ${result.target}`

	console.error([sighting, ...result.earlier].join('\n'))
	console.info(result.verdict)

	return 0
}

async function run(argv: ReadonlyArray<string>, now: Date): Promise<number> {
	const parsed = parse_arguments(argv)

	if (parsed === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return report(await observation_record.record({ ...parsed, now }))
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv, new Date())
}

const observation_record_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { observation_record_cli }
