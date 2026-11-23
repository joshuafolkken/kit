import { issue_body_keys } from './issue-body-keys'
import { issue_cite } from './issue-cite'

// Candidate origins for a defect: the merged pull requests that last changed what its issue names,
// and for a path the one that first added it. Each backticked path or identifier is looked up in the
// first-parent merge history — a path by pathspec, anything else by `-S` — and the merges are folded
// per pull request, the one touching most targets first, then newest. The command only proposes;
// the filer decides which line to write.

const FIELD = '\u{1F}'
const RECORD = '\u{1E}'
const LOG_FORMAT = `--format=%cI${FIELD}%s${FIELD}%b${RECORD}`
const MERGE_RECORD = new RegExp(
	String.raw`^(?<merged_at>[^${FIELD}]*)${FIELD}Merge pull request #(?<pr>\d+) from [^${FIELD}]*${FIELD}(?<title>[^\n]*)`,
	'u',
)
const LOG_LIMIT = '--max-count=5'
const ADDED_ONLY = '--diff-filter=A'
const MAX_CANDIDATES = 5
const DATE_LENGTH = 'YYYY-MM-DD'.length
const ORIGIN_HINT = `\`${issue_body_keys.prefix('origin')} #<PR>\``
const NO_CANDIDATES = '(no merged pull request changed what the issue names)'

interface Merge {
	pr: number
	merged_at: string
	title: string
}

// `introduced` names the targets this pull request first added.
interface Candidate extends Merge {
	targets: ReadonlyArray<string>
	introduced: ReadonlyArray<string>
}

// `introduced` is the merge that first added a path target, when one did.
interface TargetMerges {
	target: string
	merges: ReadonlyArray<Merge>
	introduced?: Merge | undefined
}

interface Hit {
	target: string
	merge: Merge
	is_introduced: boolean
}

const BASE_ARGUMENTS = ['log', '--first-parent', '--merges', '--diff-merges=first-parent', '-s']

// A merge after the issue was filed cannot have introduced what it reports, so `before` bounds the log.
function bounded_arguments(before: string | undefined): Array<string> {
	const bound = before === undefined ? [] : [`--before=${before}`]

	return [...BASE_ARGUMENTS, ...bound]
}

function base_arguments(before: string | undefined): Array<string> {
	return [...bounded_arguments(before), LOG_LIMIT, LOG_FORMAT]
}

function pathspec(target: string): Array<string> {
	return ['--', `:(glob)**/${target}`]
}

function path_arguments(target: string, before?: string): Array<string> {
	return [...base_arguments(before), ...pathspec(target)]
}

// Every merge that added a file the path matches, newest first and unlimited, so the last is the first.
function introduced_arguments(target: string, before?: string): Array<string> {
	return [...bounded_arguments(before), ADDED_ONLY, LOG_FORMAT, ...pathspec(target)]
}

function pickaxe_arguments(target: string, before?: string): Array<string> {
	return [...base_arguments(before), `-S${target}`]
}

// The merge's date, its pull request read off the subject, and the title — the body's first line.
function parse_record(record: string): Merge | undefined {
	const groups = MERGE_RECORD.exec(record.trim())?.groups

	if (groups === undefined) return undefined

	return {
		pr: Number(groups['pr']),
		merged_at: String(groups['merged_at']),
		title: String(groups['title']),
	}
}

function parse_merges(output: string): ReadonlyArray<Merge> {
	return output
		.split(RECORD)
		.map((record) => parse_record(record))
		.filter((merge) => merge !== undefined)
}

// One hit per pull request and target: a changing merge that also added the target counts once, marked.
function hits_of({ target, merges, introduced }: TargetMerges): ReadonlyArray<Hit> {
	const changed = merges
		.filter((merge) => merge.pr !== introduced?.pr)
		.map((merge) => ({ target, merge, is_introduced: false }))

	return introduced === undefined
		? changed
		: [...changed, { target, merge: introduced, is_introduced: true }]
}

const NO_HITS: Pick<Candidate, 'introduced' | 'targets'> = { targets: [], introduced: [] }

function add_hit(by_pr: Map<number, Candidate>, { target, merge, is_introduced }: Hit): void {
	const { targets, introduced } = by_pr.get(merge.pr) ?? NO_HITS

	by_pr.set(merge.pr, {
		...merge,
		targets: [...targets, target],
		introduced: is_introduced ? [...introduced, target] : introduced,
	})
}

function fold(found: ReadonlyArray<TargetMerges>): Map<number, Candidate> {
	const by_pr = new Map<number, Candidate>()
	const hits = found.flatMap((target_merges) => hits_of(target_merges))

	for (const hit of hits) add_hit(by_pr, hit)

	return by_pr
}

function by_reach(left: Candidate, right: Candidate): number {
	const reach = right.targets.length - left.targets.length

	return reach === 0 ? right.merged_at.localeCompare(left.merged_at) : reach
}

// The pull requests behind every target's merges, the one touching most targets first, then newest;
// at most five, plus any pull request that first added a target, which the cap never drops.
function rank(found: ReadonlyArray<TargetMerges>): ReadonlyArray<Candidate> {
	return [...fold(found).values()]
		.toSorted((left, right) => by_reach(left, right))
		.filter((candidate, index) => index < MAX_CANDIDATES || candidate.introduced.length > 0)
}

function format_candidate(candidate: Candidate): string {
	const date = candidate.merged_at.slice(0, DATE_LENGTH)
	const changed = candidate.targets.join(', ')
	const introduced =
		candidate.introduced.length === 0 ? '' : `\n  introduced: ${candidate.introduced.join(', ')}`

	return `${issue_cite.plain_for('linked', candidate.pr)}  ${date}  ${candidate.title}\n  changed: ${changed}${introduced}`
}

// `subject` names what the candidates are for: a cited issue, or the body being filed.
function format(subject: string, candidates: ReadonlyArray<Candidate>): string {
	const header = `origin candidates for ${subject} (most targets first, then newest; declare one as ${ORIGIN_HINT}):`
	const lines =
		candidates.length === 0
			? [NO_CANDIDATES]
			: candidates.map((candidate) => format_candidate(candidate))

	return [header, ...lines].join('\n')
}

const defect_origin = {
	format,
	introduced_arguments,
	parse_merges,
	path_arguments,
	pickaxe_arguments,
	rank,
}

export type { Candidate, Merge, TargetMerges }
export { defect_origin }
