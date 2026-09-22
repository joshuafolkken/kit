#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import {
	package_scout,
	type PackageMetrics,
	type RegistryFacts,
	type SearchCandidate,
} from './package-scout'
import { package_scout_format } from './package-scout-format'

// `josh pkg:scout <keywords> [--size <n>]` — before the Package-First tier decision, rank the
// candidate packages by measured metrics so "clearly best (Tier A)" and "genuine toss-up (Tier B)"
// are read off the output rather than judged (joshuafolkken/kit#2216).
//
// The registry answers in three reads: one search for the candidates, then per candidate a downloads
// point and the latest version metadata (bundled types, license, unpacked size). A per-candidate read
// that fails leaves that metric blank rather than dropping the row — the ranking still stands on the
// search score, which is the one signal every candidate carries.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const DEFAULT_SIZE = 10
const FETCH_TIMEOUT_MS = 10_000
const REGISTRY = 'https://registry.npmjs.org'
const DOWNLOADS_API = 'https://api.npmjs.org/downloads/point/last-week'
const USAGE = 'Usage: josh pkg:scout <keywords> [--size <n>]'
const SEARCH_FAILED_MESSAGE =
	'Could not read the npm registry search, so no candidates can be ranked — check the network and try again.'

const search_object_schema = z.object({
	package: z.object({ name: z.string(), version: z.string(), date: z.string().optional() }),
	score: z.object({ final: z.number() }),
})
const search_response_schema = z.object({ objects: z.array(search_object_schema) })
const downloads_schema = z.object({ downloads: z.number() })
// The published `license` is a string on current packages and a `{ type }` object on old ones; both
// are read, anything else is left blank. `looseObject` so the fields not read here never fail parsing.
const license_schema = z.union([z.string(), z.object({ type: z.string() })]).optional()
const latest_schema = z.looseObject({
	types: z.string().optional(),
	typings: z.string().optional(),
	license: license_schema,
	dist: z.looseObject({ unpackedSize: z.number().optional() }).optional(),
})

type SearchObject = z.infer<typeof search_object_schema>
type Latest = z.infer<typeof latest_schema>

async function fetch_json<T>(url: string, schema: z.ZodType<T>): Promise<T | undefined> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
		if (!response.ok) return undefined

		return schema.parse(await response.json())
	} catch {
		return undefined
	}
}

function to_candidate(object: SearchObject): SearchCandidate {
	return {
		name: object.package.name,
		version: object.package.version,
		score: object.score.final,
		last_publish: object.package.date,
	}
}

function license_of(license: Latest['license']): string | undefined {
	if (typeof license === 'string') return license

	return license?.type
}

const NO_FACTS: RegistryFacts = {
	has_bundled_types: false,
	license: undefined,
	install_size_bytes: undefined,
}

function facts_of(latest: Latest | undefined): RegistryFacts {
	if (latest === undefined) return NO_FACTS

	return {
		has_bundled_types: latest.types !== undefined || latest.typings !== undefined,
		license: license_of(latest.license),
		install_size_bytes: latest.dist?.unpackedSize,
	}
}

// One candidate's two per-package reads, run together: the version metadata for the facts and the
// downloads point. Neither depends on the other, so they go out in one round trip.
async function gather(candidate: SearchCandidate): Promise<PackageMetrics> {
	const [latest, downloads] = await Promise.all([
		fetch_json(`${REGISTRY}/${candidate.name}/latest`, latest_schema),
		fetch_json(`${DOWNLOADS_API}/${candidate.name}`, downloads_schema),
	])

	return package_scout.to_metrics(candidate, facts_of(latest), downloads?.downloads)
}

async function search(keywords: string, size: number): Promise<Array<SearchCandidate> | undefined> {
	const url = `${REGISTRY}/-/v1/search?text=${encodeURIComponent(keywords)}&size=${String(size)}`
	const response = await fetch_json(url, search_response_schema)

	return response?.objects.map((object) => to_candidate(object))
}

interface ScoutArguments {
	keywords: string
	size: number
}

function parse_size(raw: string | undefined): number {
	const parsed = Number(raw)

	return raw === undefined || !Number.isSafeInteger(parsed) || parsed <= 0 ? DEFAULT_SIZE : parsed
}

function parse_arguments(argv: ReadonlyArray<string>): ScoutArguments | undefined {
	const { values, positionals } = parseArgs({
		args: [...argv],
		options: { size: { type: 'string' } },
		allowPositionals: true,
	})
	const keywords = positionals.join(' ').trim()

	if (keywords === '') return undefined

	return { keywords, size: parse_size(values.size) }
}

// An unknown flag makes `parseArgs` throw. Caught so the answer is the usage line rather than a stack
// trace, on a command whose output a workflow reads.
function read_arguments(argv: ReadonlyArray<string>): ScoutArguments | undefined {
	try {
		return parse_arguments(argv)
	} catch {
		return undefined
	}
}

async function report(args: ScoutArguments): Promise<number> {
	const candidates = await search(args.keywords, args.size)

	if (candidates === undefined) {
		console.error(SEARCH_FAILED_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	const metrics = await Promise.all(candidates.map(async (candidate) => await gather(candidate)))

	console.info(`Candidates for "${args.keywords}" (ranked by npm score):`)
	console.info(package_scout_format.format_table(package_scout.build_table(metrics)))

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const args = read_arguments(argv)

	if (args === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await report(args)
}

// `process.exitCode` rather than `process.exit()`: the answer goes to standard output and a write to
// a pipe is asynchronous on macOS, so exiting can tear the process down before it drains.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const package_scout_cli = {
	USAGE,
	SEARCH_FAILED_MESSAGE,
	DEFAULT_SIZE,
	read_arguments,
	facts_of,
	license_of,
	to_candidate,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { package_scout_cli }
