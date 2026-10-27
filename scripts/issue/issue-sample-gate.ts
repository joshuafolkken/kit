import { issue_cite } from './issue-cite'
import { markdown_section } from './markdown-section'

// joshuafolkken/kit#4414: a follow-up measurement waits on samples, not on the calendar — a busy day
// collects enough merges before a dated start time, a quiet one not even after it. The body names the
// pull request whose effect it measures and how many merges the lane ledger must record after that
// pull request merged; the pickup holds the issue until then. The pull request's own merge is not a
// sample: `run:merge` records it, keyed by the issue it closes, after GitHub stamps `merged_at`.
//
// The readers that hold an issue back are synchronous and see only the body, so the one network fact
// the wait needs — when the pull request merged — is read ahead by `prime`, once per pull request per
// process, wherever bodies first arrive. A body nobody primed reads as waiting: offering it early is
// the defect this guards, and the next primed read releases it.
//
// joshuafolkken/kit#5220: the reads `prime` makes — the pull request and the lane ledger — live in
// `issue-sample-prime.ts`, which hands this module the ledger's merges. The readers that only judge a
// body import this module alone, so a change to the ledger's reading never reaches their suites.
//
// joshuafolkken/kit#5051: a lane files its measurement follow-up before its own pull request exists —
// `josh ship` wants the deferral row first. So the condition may cite the issue instead (`CLOSING_FORMAT`),
// and `prime` resolves the merged pull request that closes it; until one exists the body waits as
// unmerged.

const BACKGROUND_HEADING = '## 背景'
const PREFIX = '- 実施可能条件:'
const CONDITION_PATTERN =
	/^#(?<cited>[1-9]\d*) (?<closing>を閉じる PR )?のマージ後 (?<count>[1-9]\d*) マージ$/u
const VALUE_FORMAT = '#<PR> のマージ後 <K> マージ'
const CLOSING_FORMAT = '#<issue> を閉じる PR のマージ後 <K> マージ'
const DECLARATION = `${PREFIX} ${VALUE_FORMAT}`
// The refusal ends in a line ready to paste (joshuafolkken/kit#5225).
const EXAMPLE = `${PREFIX} #5198 のマージ後 30 マージ`
const MALFORMED = `\`${PREFIX}\` must read \`${VALUE_FORMAT}\` or \`${CLOSING_FORMAT}\` with K at least 1\n${EXAMPLE}`

// `pull` cites the pull request itself, `issue` the issue whose closing pull request it waits on.
type Via = 'pull' | 'issue'

interface Condition {
	cited: number
	via: Via
	count: number
}

type SampleWait =
	| { kind: 'unread'; cited: number; via: Via }
	| { kind: 'unmerged'; cited: number; via: Via }
	| { kind: 'short'; cited: number; via: Via; counted: number; needed: number }

// One pull request as read: `merged_at` absent is one found unmerged, read again as it may merge since.
// `closes` is the issue its body closes, whose ledger merge is the pull request's own.
interface PullRead {
	merged_at: string | undefined
	closes: number | undefined
}

// One merge the lane ledger recorded, keyed by the issue its pull request closed.
interface MergeSample {
	at: string
	issue: number
}

// The ledger's merges as they read now; none until a prime has handed them over.
interface LedgerState {
	merges: () => ReadonlyArray<MergeSample>
}

// A cited number with no entry was never read. Keyed by `key_of`, as one number may be cited both ways.

const pull_by_key = new Map<string, PullRead>()

function no_merges(): ReadonlyArray<MergeSample> {
	return []
}

const ledger: LedgerState = { merges: no_merges }

function declared_value(body: string): string | undefined {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')
	const line = markdown_section
		.unfenced_lines(background)
		.map((text) => text.trim())
		.find((text) => text.startsWith(PREFIX))

	return line?.slice(PREFIX.length).trim()
}

function via_of(groups: Partial<Record<string, string>>): Via {
	return groups['closing'] === undefined ? 'pull' : 'issue'
}

// The declared condition, or `undefined` when there is none or it does not parse — a malformed one is
// refused by `issue:lint`, and holding a hand-edited one forever would lose the issue silently.
function condition_of(body = ''): Condition | undefined {
	const groups = CONDITION_PATTERN.exec(declared_value(body) ?? '')?.groups

	if (groups === undefined) return undefined

	return { cited: Number(groups['cited']), via: via_of(groups), count: Number(groups['count']) }
}

// The number the declared condition cites, or `undefined` when there is none or it does not parse.
function cited_number(body: string): number | undefined {
	return condition_of(body)?.cited
}

// The number cited by the given form only — the issue form cites an issue by design.
function cited_via(body: string, via: Via): number | undefined {
	const condition = condition_of(body)

	return condition?.via === via ? condition.cited : undefined
}

function key_of({ cited, via }: Pick<Condition, 'cited' | 'via'>): string {
	return `${via}:${String(cited)}`
}

function problems(body: string): ReadonlyArray<string> {
	const value = declared_value(body)

	return value === undefined || CONDITION_PATTERN.test(value) ? [] : [MALFORMED]
}

// Keeps what a prime read for the condition; `undefined` — a failed read — leaves it unread.
function record(condition: Condition, pull: PullRead | undefined): void {
	const key = key_of(condition)

	if (pull === undefined) pull_by_key.delete(key)
	else pull_by_key.set(key, pull)
}

function use_merges(merges: () => ReadonlyArray<MergeSample>): void {
	ledger.merges = merges
}

function is_merge_known(condition: Condition): boolean {
	return pull_by_key.get(key_of(condition))?.merged_at !== undefined
}

// The conditions the bodies declare whose pull request has not been read merged, one per key.
function unread_of(bodies: ReadonlyArray<string | undefined>): Array<Condition> {
	const unread = bodies
		.map((body) => condition_of(body))
		.filter(
			(condition): condition is Condition => condition !== undefined && !is_merge_known(condition),
		)

	return [...new Map(unread.map((condition) => [key_of(condition), condition])).values()]
}

function merges_after({ merged_at, closes }: PullRead & { merged_at: string }): number {
	const since = Date.parse(merged_at)

	return ledger.merges().filter((merge) => merge.issue !== closes && Date.parse(merge.at) > since)
		.length
}

// What the body still waits on, or `undefined` when it declares nothing or has its samples.
function wait_of(body?: string): SampleWait | undefined {
	const condition = condition_of(body)

	if (condition === undefined) return undefined

	const { cited, via, count } = condition
	const pull = pull_by_key.get(key_of(condition))

	if (pull === undefined) return { kind: 'unread', cited, via }

	const { merged_at, closes } = pull

	if (merged_at === undefined) return { kind: 'unmerged', cited, via }

	const counted = merges_after({ merged_at, closes })

	return counted >= count ? undefined : { kind: 'short', cited, via, counted, needed: count }
}

function subject_of({ cited, via }: SampleWait): string {
	const plain = issue_cite.plain(cited)

	return via === 'pull' ? plain : `the pull request closing ${plain}`
}

// Why the body waits, for a reader that cites the issue itself.
function reason_of(wait: SampleWait): string {
	const subject = subject_of(wait)

	if (wait.kind === 'unread') return `until the merge of ${subject} is read`
	if (wait.kind === 'unmerged') return `until ${subject} merges`

	return `${String(wait.counted)}/${String(wait.needed)} merges after ${subject}`
}

function reset(): void {
	pull_by_key.clear()
	ledger.merges = no_merges
}

const issue_sample_gate = {
	DECLARATION,
	CLOSING_FORMAT,
	cited_number,
	cited_via,
	problems,
	reason_of,
	record,
	reset,
	unread_of,
	use_merges,
	wait_of,
}

export type { Condition, MergeSample, PullRead, SampleWait }
export { issue_sample_gate }
