import { issue_cite } from './issue-cite'

// Candidate origins for a defect: the merged pull requests that last changed what its issue names.
// Each backticked path or identifier is looked up in the first-parent merge history — a path by
// pathspec, anything else by `-S` — and the merges are folded per pull request, newest first. The
// command only proposes; the filer decides which line to write.

const FIELD = '\u{1F}'
const RECORD = '\u{1E}'
const LOG_FORMAT = `--format=%cI${FIELD}%s${FIELD}%b${RECORD}`
const MERGE_RECORD = new RegExp(
	String.raw`^(?<merged_at>[^${FIELD}]*)${FIELD}Merge pull request #(?<pr>\d+) from [^${FIELD}]*${FIELD}(?<title>[^\n]*)`,
	'u',
)
const LOG_LIMIT = '--max-count=5'
const MAX_CANDIDATES = 5
const DATE_LENGTH = 'YYYY-MM-DD'.length
const ORIGIN_HINT = '`- 原因: #<PR>`'
const NO_CANDIDATES = '(no merged pull request changed what the issue names)'

interface Merge {
	pr: number
	merged_at: string
	title: string
}

interface Candidate extends Merge {
	targets: ReadonlyArray<string>
}

interface TargetMerges {
	target: string
	merges: ReadonlyArray<Merge>
}

const BASE_ARGUMENTS = ['log', '--first-parent', '--merges', '--diff-merges=first-parent', '-s']

// A merge after the issue was filed cannot have introduced what it reports, so `before` bounds the log.
function base_arguments(before: string | undefined): Array<string> {
	const bound = before === undefined ? [] : [`--before=${before}`]

	return [...BASE_ARGUMENTS, ...bound, LOG_LIMIT, LOG_FORMAT]
}

function path_arguments(target: string, before?: string): Array<string> {
	return [...base_arguments(before), '--', `:(glob)**/${target}`]
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

function fold(found: ReadonlyArray<TargetMerges>): Map<number, Candidate> {
	const by_pr = new Map<number, Candidate>()

	for (const { target, merges } of found) {
		for (const merge of merges) {
			const targets = by_pr.get(merge.pr)?.targets ?? []

			by_pr.set(merge.pr, { ...merge, targets: [...targets, target] })
		}
	}

	return by_pr
}

// The pull requests behind every target's merges, newest merge first, at most five.
function rank(found: ReadonlyArray<TargetMerges>): ReadonlyArray<Candidate> {
	return [...fold(found).values()]
		.toSorted((left, right) => right.merged_at.localeCompare(left.merged_at))
		.slice(0, MAX_CANDIDATES)
}

function format_candidate(candidate: Candidate): string {
	const date = candidate.merged_at.slice(0, DATE_LENGTH)
	const changed = candidate.targets.join(', ')

	return `${issue_cite.plain(candidate.pr)}  ${date}  ${candidate.title}\n  changed: ${changed}`
}

function format(issue_number: string, candidates: ReadonlyArray<Candidate>): string {
	const header = `origin candidates for ${issue_cite.plain(issue_number)} (newest first; declare one as ${ORIGIN_HINT}):`
	const lines =
		candidates.length === 0
			? [NO_CANDIDATES]
			: candidates.map((candidate) => format_candidate(candidate))

	return [header, ...lines].join('\n')
}

const defect_origin = { format, parse_merges, path_arguments, pickaxe_arguments, rank }

export type { Candidate, Merge, TargetMerges }
export { defect_origin }
