import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_declared_size } from '#scripts/issue/issue-declared-size'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import {
	lane_ledger,
	type LedgerEntry,
	type SplitFiledEntry,
	type SplitNoticeEntry,
} from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { error_text } from '#scripts/lib/error-message'
import { split_assess, type DeclaredSize } from './split-assess'
import { split_measure } from './split-measure'
import { split_verified_single } from './split-verified-single'

// A split child answers a notice, or a fresh measurement falls under its bar. The child is recorded
// as the filing lands (joshuafolkken/kit#6212); one verified deliverable with nothing left to split
// answers it too (`split-verified-single.ts`). An unanswered notice is a warning the later steps print,
// never a stop: size alone does not re-split a started Issue (joshuafolkken/kit#6602).

const NOTICE_SECTION = `split-assessment.md → "${split_assess.NOTICE_SECTION}"`

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

function warning_text(notice: SplitNoticeEntry): string {
	const counted = `${String(notice.files)} file(s), ${String(notice.lines)} line(s), tests excluded`
	const action = `go on; file a split child with \`pnpm josh issue:file --route split --found-during ${String(notice.issue)}\` only for an independent added requirement or scope growth this Issue cannot verify`

	return `size warning: ${session_cite.issue(notice.issue)} got the split notice (${counted}) — not a stop. ${action} — ${NOTICE_SECTION}`
}

// The warning for a noticed Issue without a split child, else `undefined`; no GitHub read is needed.
async function warning(
	issue: number,
	entries: ReadonlyArray<LedgerEntry>,
): Promise<string | undefined> {
	const notice = notices(entries).findLast((entry) => entry.issue === issue)

	if (notice === undefined || split_issues(entries).has(issue)) return undefined

	return warning_text(notice)
}

// The Issue's declared size, or none when its body cannot be read — the bar is then the guide.
async function declared_of(issue: number): Promise<DeclaredSize | undefined> {
	try {
		return await issue_declared_size.read(String(issue))
	} catch {
		return undefined
	}
}

// Whether the branch still passes the notice bar; a failed measurement keeps the notice.
async function is_still_over(issue: number): Promise<boolean> {
	try {
		const measurement = await split_measure.read_branch()

		return split_assess.notice(measurement, await declared_of(issue)) !== undefined
	} catch {
		return true
	}
}

// The warning against this repository's lane ledger; outside a repository there is none to read. A
// notice still over its bar stands unless the work is one verified deliverable (joshuafolkken/kit#6572).
async function ledger_warning(issue: number): Promise<string | undefined> {
	const ledger = await lane_ledger.target()
	const note =
		ledger === undefined ? undefined : await warning(issue, lane_ledger.read_entries(ledger))

	if (note === undefined || !(await is_still_over(issue))) return undefined

	return (await split_verified_single.verified(issue)) ? undefined : note
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

	try {
		await lane_ledger_write.record_split_filed({ issue: Number(found_during), child })
	} catch (error) {
		throw new Error(
			`Created ${child}, but split-child evidence could not be recorded. Do not create another child. Recover with \`pnpm josh split:recover ${found_during} ${child}\`.`,
			{ cause: error },
		)
	}
}

interface Fold {
	origin: string
	target: string
}

// joshuafolkken/kit#6630: the split part folded into existing Issue `target`
// (`josh issue:fold-existing --apply <target> --found-during <origin>`) answers the notice as its child.
async function record_fold({ origin, target }: Fold): Promise<void> {
	try {
		await lane_ledger_write.record_split_filed({
			issue: Number(origin),
			child: issue_cite.plain_for('program', target),
		})
	} catch (error) {
		throw new Error(
			`Folded into ${session_cite.issue(target)}, but split-child evidence for ${session_cite.issue(origin)} could not be recorded: ${error_text.message_of(error)}`,
			{ cause: error },
		)
	}
}

const split_resolution = {
	ledger_warning,
	notices,
	record_child,
	record_fold,
	split_issues,
	warning,
}

export { split_resolution }
