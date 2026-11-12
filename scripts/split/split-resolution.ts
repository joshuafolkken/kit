import { issue_cite } from '#scripts/issue/issue-cite'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import {
	lane_ledger,
	type LedgerEntry,
	type SplitFiledEntry,
	type SplitNoticeEntry,
} from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { error_text } from '#scripts/lib/error-message'
import { split_assess } from './split-assess'

// A split child answers a notice; the child is recorded as the filing lands (joshuafolkken/kit#6212).
// A started lane is never split (joshuafolkken/kit#7183): its own `--route split --found-during` is
// refused, and an overrun is recorded at its merge as a pre-split miss (`lane-size-record.ts`).

const NOTICE_SECTION = `split-assessment.md → "${split_assess.NOTICE_SECTION}"`

interface SplitArguments {
	route: string | undefined
	found_during: string | undefined
}

// Whether the filing is not a split of the dispatched lane it is filed from; a refusal is printed. An
// independent new requirement found in the lane is filed as an observation instead. An omitted
// `--found-during` is the lane's own, as `issue_file_fold.finder` reads it.
function is_split_clear({ route, found_during }: SplitArguments): boolean {
	const marked = lane_child_marker.marked_issue()
	const finder = found_during ?? marked

	if (route !== SPLIT_ROUTE_LABEL || finder === undefined || finder !== marked) return true
	console.error(
		`refused: ${session_cite.issue(finder)} is a dispatched lane, which is never split — finish it; file an independent new requirement without \`--route split\` (${NOTICE_SECTION}).`,
	)

	return false
}

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
	is_split_clear,
	notices,
	record_child,
	record_fold,
	split_issues,
}

export { split_resolution }
