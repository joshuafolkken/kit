#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { managed_config_scope } from '#scripts/sync/managed-config-scope'
import { z } from 'zod'
import {
	sonar_hotspots,
	type ClassifiedHotspot,
	type HotspotDisposition,
	type HotspotFetch,
} from './sonar-hotspots'
import { sonar_project } from './sonar-project'

// `josh sonar:hotspots <PR>` — fetch the SonarCloud hotspots on a pull request and print the Step B
// disposition of each.
//
// The decision itself lives in `sonar-hotspots.ts`; this file is the I/O around it: read the project
// key from `sonar-project.properties`, fetch the public search API, and answer the upstream-synced
// axis with `sync:scope`'s own detection — `managed_config_scope.has_managed_path`, so no
// distribution path list is copied here. A read that fails is printed as `unreadable`, told apart
// from a success that found no hotspots.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh sonar:hotspots <PR>'
const HOTSPOTS_PATH = '/api/hotspots/search'
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

function hotspots_url(project_key: string, pull_request: string): string {
	return sonar_project.api_url(HOTSPOTS_PATH, {
		projectKey: project_key,
		pullRequest: pull_request,
	})
}

async function fetch_hotspots(url: string): Promise<HotspotFetch> {
	const read = await sonar_project.fetch_json(url, response_schema)

	return 'error' in read ? read : { hotspots: read.data.hotspots ?? [] }
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
	const target = await sonar_project.resolve_target(argv, USAGE)
	if (target === undefined) return FAILURE_EXIT_CODE

	await fetch_and_print(target.project_key, target.pull_request)

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const sonar_hotspots_cli = {
	fetch_hotspots,
	format_hotspot,
	print_disposition,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { sonar_hotspots_cli }
