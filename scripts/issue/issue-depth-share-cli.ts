#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { MAX_SCANNED } from '#scripts/git/git-gh-issue-list'
import { cutoff_cause, cutoff_of, type ScanCutoff } from '#scripts/git/listing-cutoff'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { open_issue_schema, type OpenIssueData } from '#scripts/git/schemas'
import { path_decision } from '#scripts/josh/path-decision'
import { issue_depth_share, type DepthShare } from './issue-depth-share'

// **`josh depth:share` — the depth-0 share of the open backlog, read rather than hand-counted**
// (joshuafolkken/kit#1729). The denominator, and why it is what it is, are stated once in
// `.claude/skills/workflow-commands/observation-filing.md` → "The depth-0 share"; `issue-depth-share.ts`
// implements it. This file fetches the listing and prints what that module computed.
//
// **Two readings of the same backlog must produce the same number**, which is the requirement the
// hand counts failed. So nothing here is sampled or judged, and the two ways a listing can stop
// short of the whole backlog are reported rather than presented as the whole — through
// `cutoff_of`, the repository's one answer to "did I see everything", because `is_capped` alone is
// blind to a listing that filled the caller's own limit.
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh depth:share [--json]'
const JSON_KEY = 'share'
// Not `path_decision.KNOWN_FLAGS`: that set carries `--staged`, which means nothing to a listing.
const KNOWN_FLAGS: ReadonlyArray<string> = [path_decision.JSON_FLAG]
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const UNKNOWN_ANSWER = 'unknown'
// **Not a share of zero.** A listing that could not be read says nothing about the backlog's
// composition, and printing `0/0 = 0%` for it would be a measurement invented out of a failed fetch.
const UNKNOWN_REASON = 'the open-issue listing could not be read — report unknown, never a share'
// Kept apart from the one above because the two send a reader to different places: that one is an
// access or connectivity problem, this one means the listing's fields changed under us.
const SHAPE_REASON =
	'the open-issue listing did not match the issue schema — its fields may have changed'
// The whole open backlog, so the share is over everything rather than a sample. At this limit the
// listing's own `is_capped` cannot fire — the paging selects exactly `MAX_SCANNED` rows and stops —
// which is why the cutoff is asked of `cutoff_of` rather than read off that flag.
const LISTING_LIMIT = MAX_SCANNED
// Worded after the paging rather than after the caller's limit, because at `MAX_SCANNED` the two are
// the same number: raising this command's limit would move nothing, since the paging stops at
// `MAX_PAGES` regardless. A message naming a knob the reader cannot turn is worse than none.
const ROW_LIMIT_CAUSE = `stopped at the ${String(LISTING_LIMIT)}-issue scan ceiling, which the paging fixes`
const PARTIAL_NOTE = 'this share covers a partial read'

type Reading =
	| { kind: 'read'; rows: ReadonlyArray<OpenIssueData>; cutoff: ScanCutoff }
	| { kind: 'unreadable' }
	| { kind: 'unexpected_shape' }

async function read_open(): Promise<Reading> {
	const { json, is_capped } = await git_gh_command.issue_list_recent(LISTING_LIMIT)

	if (json === undefined) return { kind: 'unreadable' }

	const read = read_json_listing(json, open_issue_schema)

	if (read.kind !== 'read') return { kind: read.kind }

	return {
		kind: 'read',
		rows: read.rows,
		cutoff: cutoff_of(read.rows.length, LISTING_LIMIT, is_capped),
	}
}

function breakdown_line(share: DepthShare, cutoff: ScanCutoff): string {
	const breakdown = issue_depth_share.format_breakdown(share)
	const cause = cutoff_cause(cutoff, ROW_LIMIT_CAUSE)

	return cause === undefined ? breakdown : `${breakdown} — ${PARTIAL_NOTE}: ${cause}`
}

// The headline goes in beside the figures so that one key is present in both shapes this command can
// emit: `unknown` when the listing could not be read, the ratio when it could. Without it a consumer
// would have to tell the two apart by sniffing for a key that only one of them carries.
function print_share(share: DepthShare, cutoff: ScanCutoff, is_json: boolean): void {
	if (is_json) {
		console.info(
			JSON.stringify({ [JSON_KEY]: issue_depth_share.format_headline(share), ...share, cutoff }),
		)

		return
	}

	console.info(issue_depth_share.format_headline(share))
	console.error(breakdown_line(share, cutoff))
}

function print_unknown(kind: 'unreadable' | 'unexpected_shape', is_json: boolean): void {
	const reason = kind === 'unreadable' ? UNKNOWN_REASON : SHAPE_REASON

	path_decision.print_decision(JSON_KEY, UNKNOWN_ANSWER, reason, is_json)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (path_decision.has_unknown_flag(argv, KNOWN_FLAGS)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reading = await read_open()
	const is_json = argv.includes(path_decision.JSON_FLAG)

	if (reading.kind === 'read') {
		print_share(issue_depth_share.summarize(reading.rows), reading.cutoff, is_json)
	} else {
		print_unknown(reading.kind, is_json)
	}

	return SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_depth_share_cli = {
	main,
	run,
	JSON_KEY,
	LISTING_LIMIT,
	PARTIAL_NOTE,
	SHAPE_REASON,
	UNKNOWN_ANSWER,
	UNKNOWN_REASON,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { Reading }
export { issue_depth_share_cli }
