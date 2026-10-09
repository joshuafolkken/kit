import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { PAGE_CEILING_CAUSE } from '#scripts/git/listing-cutoff'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { EPIC_LABEL, has_any_label } from './issue-labels'
import type { ScoutIssue } from './issue-scout'

// The closed half of `issue:scout`'s duplicate scan, held apart from the CLI
// so the command that reports the scan and the one that files after it (`issue:file`) read one
// listing rather than two.

// How far back the closed half of the scan reaches. One page: the duplicate
// this half exists to catch closed hours ago, not months, and the listing is ordered by update so
// the newest hundred already covers a run's own day several times over.
//
// **It is a window, not a cut, which is why reaching it is not warned about.** Every other listing in
// this command reports its `limit` as a gap, because there the caller wanted the whole backlog and
// got part of it; here the hundredth-most-recently-updated closed issue is where the question itself
// stops. A warning printed on every invocation in any repository with a hundred closed issues would
// carry no signal and would train a reader past the gap lines beside it that do. **The page ceiling
// is still reported**, and `ClosedScan` below says why the two are not the same event.
const CLOSED_LIMIT = 100

// Read through `has_any_label` rather than compared directly, for the casing reason
// `issue-labels.ts` records: GitHub keeps the spelling a label was created with.
const EPIC_LABELS: ReadonlySet<string> = new Set([EPIC_LABEL])

// The listing's own label shape, not a second spelling of it: a copy here would be the drift the
// shared schema module exists to prevent.
const closed_labels_schema = z.array(issue_label_schema).optional()

const closed_row_schema = z.object({
	number: z.number(),
	title: z.string().nullable(),
	labels: closed_labels_schema,
})

type ClosedRow = z.infer<typeof closed_row_schema>

// `rows` is `undefined` — never `[]` — when the listing failed: "nothing closed recently" is the
// answer that sends a run straight on to file the duplicate, which is the failure this half was
// added to prevent.
function to_closed_row(row: ClosedRow): ScoutIssue {
	return {
		number: row.number,
		title: row.title ?? '',
		is_closed: true,
		// A closed epic is still a container, and `epic_bundle_cli`'s marking cannot reach it: that one
		// is built from the *open* epic listing. Reported as a duplicate it reads as "this work is
		// already done" against an epic that never had an implementation of its own.
		is_epic: has_any_label(row.labels, EPIC_LABELS),
	}
}

function to_closed_rows(json: string): Array<ScoutIssue> | undefined {
	const rows = parse_json_array_or_undefined(json, closed_row_schema)

	return rows?.map((row) => to_closed_row(row))
}

// The rows, and whether the **page ceiling** stopped the paging short of the window. That is a
// different thing from the `limit` above, which is the window itself: pull requests are filtered out
// client-side, so a repository whose recent closures are mostly merged pull requests can select
// fewer than `CLOSED_LIMIT` issue rows while the listing still has more to give. The scan then covers
// less than it was asked for, which `git-gh-issue.ts`'s disposition table records as a warning.
interface ClosedScan {
	rows: Array<ScoutIssue> | undefined
	is_capped: boolean
}

async function read_recently_closed(): Promise<ClosedScan> {
	const { json, is_capped } = await git_gh_command.issue_list_recently_closed(CLOSED_LIMIT)

	return { rows: json === undefined ? undefined : to_closed_rows(json), is_capped }
}

// The open half already ran, so both of these are gaps in the answer rather than failures of it —
// the same disposition every other truncated listing in this command takes.
const CLOSED_UNREADABLE_LINE =
	'⚠ The recently closed issues could not be read, so the scan below covers open issues only — work that finished hours ago will not appear in it.'
const CLOSED_CEILING_LINE = `⚠ The recently closed listing ${PAGE_CEILING_CAUSE}, so a duplicate that closed inside the window may not be below.`

function warn_about_closed(scan: ClosedScan): void {
	if (scan.rows === undefined) {
		console.error(CLOSED_UNREADABLE_LINE)

		return
	}

	if (scan.is_capped) console.error(CLOSED_CEILING_LINE)
}

const issue_scout_closed = {
	CLOSED_CEILING_LINE,
	CLOSED_UNREADABLE_LINE,
	read_recently_closed,
	warn_about_closed,
}

export type { ClosedScan }
export { issue_scout_closed }
