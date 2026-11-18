import { review_finding_ledger } from './review-finding-ledger'

// **A finding's kind — what was wrong, not where** (joshuafolkken/kit#7886). The category says which
// rubric section caught a finding; the kind says what the defect was, from the classification the
// review-stop survey drew up, so a kind moved to a machine check can be counted from the ledger alone.
// It is optional: a reviewer writes `kind=<kind> ` before the spec, and a value outside the list is
// refused rather than counted as free text.
const KINDS = [
	'state-reasoning',
	'parse-boundary',
	'stale-docs',
	'untested-branch',
	'stale-comment',
	'swallowed-failure',
	'edge-input',
	'naming-callers',
	'stale-cache',
	'renamed-test',
	'i18n-key',
	'other',
] as const
const TOKEN_PREFIX = 'kind='
const TOKEN_SEPARATOR = ' '

type Kind = (typeof KINDS)[number]

interface SpecWithKind {
	kind: Kind | undefined
	spec: string
}

interface KindCount {
	kind: string
	count: number
}

interface KindReport {
	counts: ReadonlyArray<KindCount>
	with_kind: number
	total: number
}

function is_kind(value: string): value is Kind {
	return (KINDS as ReadonlyArray<string>).includes(value)
}

// A spec's leading `kind=<kind> ` split from the rest; the spec unchanged when it has none, and
// `undefined` when the token names a kind outside the list — so the writer refuses it.
function split_kind(text: string): SpecWithKind | undefined {
	if (!text.startsWith(TOKEN_PREFIX)) return { kind: undefined, spec: text }

	const end = text.indexOf(TOKEN_SEPARATOR)
	const value = text.slice(TOKEN_PREFIX.length, end === -1 ? text.length : end)

	if (end === -1 || !is_kind(value)) return undefined

	return { kind: value, spec: text.slice(end + TOKEN_SEPARATOR.length) }
}

function by_count(left: KindCount, right: KindCount): number {
	return right.count - left.count || left.kind.localeCompare(right.kind)
}

// Each kind's findings dated on or after `since` (empty: all time), most frequent first, with how many
// of all real findings carry a kind — the share that says whether the counts can be trusted yet.
function kind_report(content: string, since = ''): KindReport {
	const kinds = review_finding_ledger.dated_kinds(content, since)
	const named = kinds.filter((kind) => kind !== undefined)
	const counts = new Map<string, number>()

	for (const kind of named) counts.set(kind, (counts.get(kind) ?? 0) + 1)

	const sorted = [...counts].map(([kind, count]) => ({ kind, count })).toSorted(by_count)

	return { counts: sorted, with_kind: named.length, total: kinds.length }
}

const review_finding_kind = { kind_report, KINDS, split_kind }

export type { Kind, KindCount, KindReport }
export { review_finding_kind }
