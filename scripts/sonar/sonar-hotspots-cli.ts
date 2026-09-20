#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { git_command } from '#scripts/git/git-command'
import { managed_config_scope } from '#scripts/sync/managed-config-scope'
import { z } from 'zod'
import {
	sonar_hotspots,
	type ClassifiedHotspot,
	type HotspotDisposition,
	type HotspotFetch,
} from './sonar-hotspots'

// `josh sonar:hotspots <PR>` — fetch the SonarCloud hotspots on a pull request and print the Step B
// disposition of each (joshuafolkken/kit#2182).
//
// The decision itself lives in `sonar-hotspots.ts`; this file is the I/O around it: read the project
// key from `sonar-project.properties`, fetch the public search API, and answer the upstream-synced
// axis with `sync:scope`'s own detection — `managed_config_scope.has_managed_path`, so no
// distribution path list is copied here. A read that fails is printed as `unreadable`, told apart
// from a success that found no hotspots.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh sonar:hotspots <PR>'
const SONAR_HOST = 'https://sonarcloud.io'
const HOTSPOTS_PATH = '/api/hotspots/search'
const PROPERTIES_FILE = 'sonar-project.properties'
const PROJECT_KEY_PREFIX = 'sonar.projectKey='
const FETCH_TIMEOUT_MS = 10_000
const FAILURE_EXIT_CODE = 1
const UNKNOWN_LINE = '?'

// `looseObject` so a field SonarCloud adds later does not fail the parse; only the fields the
// disposition reads are declared. `ruleKey` keeps the API's own spelling.
const hotspot_schema = z.looseObject({
	key: z.string(),
	status: z.string(),
	component: z.string(),
	line: z.number().optional(),
	ruleKey: z.string(),
	resolution: z.string().optional(),
})
const response_schema = z.looseObject({ hotspots: z.array(hotspot_schema).optional() })

function read_project_key(root: string): string | undefined {
	const file = path.join(root, PROPERTIES_FILE)
	if (!existsSync(file)) return undefined

	const line = readFileSync(file, 'utf8')
		.split('\n')
		.find((entry) => entry.startsWith(PROJECT_KEY_PREFIX))

	return line?.slice(PROJECT_KEY_PREFIX.length).trim()
}

function hotspots_url(project_key: string, pull_request: string): string {
	const query = new URLSearchParams({ projectKey: project_key, pullRequest: pull_request })

	return `${SONAR_HOST}${HOTSPOTS_PATH}?${query.toString()}`
}

async function fetch_hotspots(url: string): Promise<HotspotFetch> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
		if (!response.ok) return { error: `HTTP ${String(response.status)}` }

		const parsed = response_schema.parse(await response.json())

		return { hotspots: parsed.hotspots ?? [] }
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) }
	}
}

function is_managed(component: string): boolean {
	return managed_config_scope.has_managed_path([sonar_hotspots.component_path(component)])
}

function format_hotspot(entry: ClassifiedHotspot): string {
	const { hotspot, branch } = entry
	const line = hotspot.line === undefined ? UNKNOWN_LINE : String(hotspot.line)

	return `${hotspot.status}\t${hotspot.component}:${line}\t${hotspot.ruleKey}\t→ ${branch}`
}

function print_disposition(disposition: HotspotDisposition): void {
	if ('unreadable' in disposition) {
		console.info(`${sonar_hotspots.UNREADABLE}: ${disposition.unreadable}`)

		return
	}

	if (disposition.classified.length === 0) {
		console.info('no hotspots on this pull request')

		return
	}

	for (const entry of disposition.classified) console.info(format_hotspot(entry))
}

async function fetch_and_print(project_key: string, pull_request: string): Promise<void> {
	const fetched = await fetch_hotspots(hotspots_url(project_key, pull_request))

	print_disposition(sonar_hotspots.classify_fetch(fetched, is_managed))
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [pull_request] = argv

	if (pull_request === undefined || pull_request.startsWith('-')) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const project_key = read_project_key(await git_command.repository_root())

	if (project_key === undefined) {
		console.error(`no ${PROJECT_KEY_PREFIX} found in ${PROPERTIES_FILE}`)

		return FAILURE_EXIT_CODE
	}

	await fetch_and_print(project_key, pull_request)

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const sonar_hotspots_cli = {
	fetch_hotspots,
	format_hotspot,
	hotspots_url,
	is_managed,
	main,
	print_disposition,
	read_project_key,
	run,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { sonar_hotspots_cli }
