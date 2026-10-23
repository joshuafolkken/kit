import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { issue_read } from '#scripts/issue/issue-read'
import { session_cite } from '#scripts/issue/session-cite'
import {
	lane_ledger,
	type LedgerEntry,
	type SplitFiledEntry,
	type SplitNoticeEntry,
} from '#scripts/lane/lane-ledger'
import { split_assess } from './split-assess'

// **What answers a split notice** (joshuafolkken/kit#4695). Of the lanes the notice reached, none split
// and none recorded why it stayed one Issue (joshuafolkken/kit#4676): the notice asked, and nothing
// checked. The pre-gate `josh run:cut` now does. A noticed Issue passes once it has either answer:
//
// - **a split child** — a `josh issue:file --route split` filed from its lane, recorded in the lane
//   ledger as the filing lands;
// - **a reason** — a trusted Issue comment carrying the filing's own reason line
//   (`split_assess.REASON_PREFIX`), so one declaration reads the same at filing and before the gate.

const { REASON_PREFIX } = split_assess
const NOTICE_SECTION = `split-assessment.md → "${split_assess.NOTICE_SECTION}"`
const UNREAD_NOTE = 'Its comments could not be read, so no recorded reason was found. '

function is_notice(entry: LedgerEntry): entry is SplitNoticeEntry {
	return entry.kind === lane_ledger.KIND.SPLIT_NOTICE
}

function is_split_child(entry: LedgerEntry): entry is SplitFiledEntry {
	return entry.kind === lane_ledger.KIND.SPLIT_FILED
}

// The ledger's split notices, oldest first — `josh lane:stats` counts the lanes they reached.
function notices(entries: ReadonlyArray<LedgerEntry>): ReadonlyArray<SplitNoticeEntry> {
	return entries.filter((entry) => is_notice(entry))
}

// The Issues whose lane filed a split child.
function split_issues(entries: ReadonlyArray<LedgerEntry>): ReadonlySet<number> {
	return new Set(entries.filter((entry) => is_split_child(entry)).map((entry) => entry.issue))
}

function is_reason_line(line: string): boolean {
	const text = line.trim()

	return text.startsWith(REASON_PREFIX) && text !== REASON_PREFIX
}

function has_reason(bodies: ReadonlyArray<string>): boolean {
	return bodies.some((body) => body.split('\n').some((line) => is_reason_line(line)))
}

// The trusted comments' bodies, or `undefined` when the listing could not be read.
async function trusted_comments(issue: number): Promise<ReadonlyArray<string> | undefined> {
	const json = await git_gh_issue_read.issue_list_comments(String(issue))
	const comments = await issue_read.parse_comments(json)

	return comments === undefined ? undefined : issue_read.trusted_bodies(comments)
}

function refusal_text(notice: SplitNoticeEntry, bodies: ReadonlyArray<string> | undefined): string {
	const counted = `${String(notice.files)} file(s), ${String(notice.lines)} line(s), tests excluded`
	const unread = bodies === undefined ? UNREAD_NOTE : ''
	const answers = `post an Issue comment with the line \`${REASON_PREFIX} <理由>\`, or file the rest with \`pnpm josh issue:file --route split\``

	return `${session_cite.issue(notice.issue)} got the split notice (${counted}) and has neither a recorded reason nor a split child. ${unread}Either ${answers}, then run \`pnpm josh run:cut ${String(notice.issue)}\` again — ${NOTICE_SECTION}`
}

// The refusal for a noticed Issue that has no answer yet, else `undefined`. The ledger is read first,
// so an Issue the notice never reached costs no GitHub read.
async function refusal(
	issue: number,
	entries: ReadonlyArray<LedgerEntry>,
): Promise<string | undefined> {
	const notice = notices(entries).findLast((entry) => entry.issue === issue)

	if (notice === undefined || split_issues(entries).has(issue)) return undefined
	const bodies = await trusted_comments(issue)

	return bodies !== undefined && has_reason(bodies) ? undefined : refusal_text(notice, bodies)
}

// The refusal against this repository's lane ledger; outside a repository there is none to read.
async function ledger_refusal(issue: number): Promise<string | undefined> {
	const ledger = await lane_ledger.target()

	return ledger === undefined ? undefined : await refusal(issue, lane_ledger.read_entries(ledger))
}

interface Filing {
	route: string | undefined
	found_during: string | undefined
	child: string
}

// What `josh issue:file` just filed: a split child is recorded against the lane it was found in. Any
// other route, and a filing found in no lane, record nothing.
async function record_child({ route, found_during, child }: Filing): Promise<void> {
	if (route !== SPLIT_ROUTE_LABEL || found_during === undefined) return
	await lane_ledger.record_split_filed({ issue: Number(found_during), child })
}

const split_resolution = { ledger_refusal, notices, record_child, refusal, split_issues }

export { split_resolution }
