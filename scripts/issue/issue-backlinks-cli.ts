#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { parse_json_object_safe } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { issue_backlinks, type UpstreamEntry } from './issue-backlinks'

// `josh issue:backlinks <N>` — read origin issue N, then the upstream issues it lists, and print one
// of `ok` / `missing-origin` / `missing-upstream` / `wrong-heading`, exiting non-zero on anything but
// `ok` so it works as a gate (joshuafolkken/kit#2123).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const REF_PATTERN = /^([\w.-]+\/[\w.-]+)#(\d+)$/u
const BODY_FIELD = 'body'
const USAGE = 'Usage: josh issue:backlinks <issue-number>'
const READ_FAILURE = '✖ could not read an issue body — a rate limit, expired auth, or a bad number'
const body_schema = z.object({ body: z.string().nullish() })

function parse_body(raw_json: string | undefined): string | undefined {
	if (raw_json === undefined) return undefined
	const parsed = parse_json_object_safe(raw_json, body_schema)

	return parsed === undefined ? undefined : (parsed.body ?? '')
}

async function read_body(issue_number: string, repo?: string): Promise<string | undefined> {
	return parse_body(await git_gh_command.issue_view_json(issue_number, BODY_FIELD, repo))
}

async function read_upstream(reference: string): Promise<UpstreamEntry | undefined> {
	const match = REF_PATTERN.exec(reference)
	if (match === null) return undefined

	const [, repo, number] = match
	const body = await read_body(number ?? '', repo)

	return body === undefined ? undefined : { ref: reference, body }
}

async function read_upstreams(
	references: ReadonlyArray<string>,
): Promise<ReadonlyArray<UpstreamEntry> | undefined> {
	const entries = await Promise.all(
		references.map(async (reference) => await read_upstream(reference)),
	)

	return entries.every((entry) => entry !== undefined) ? entries : undefined
}

async function classify(issue_number: string): Promise<string | undefined> {
	const origin_body = await read_body(issue_number)
	if (origin_body === undefined) return undefined

	if (!issue_backlinks.needs_upstreams(origin_body)) {
		return issue_backlinks.classify_backlinks(origin_body, [])
	}

	const upstreams = await read_upstreams(issue_backlinks.upstream_refs(origin_body))
	if (upstreams === undefined) return undefined

	return issue_backlinks.classify_backlinks(origin_body, upstreams)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [issue_number] = argv

	if (issue_number === undefined || !ISSUE_NUMBER_PATTERN.test(issue_number)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const verdict = await classify(issue_number)

	if (verdict === undefined) {
		console.error(READ_FAILURE)

		return FAILURE_EXIT_CODE
	}

	console.info(verdict)

	return verdict === 'ok' ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_backlinks_cli = { run, USAGE }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_backlinks_cli }
