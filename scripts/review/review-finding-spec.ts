import { review_finding_kind } from './review-finding-kind'
import { review_finding_ledger, type Finding } from './review-finding-ledger'
import { review_finding_text } from './review-finding-text'

// The grammar of one `josh review:record` positional — `[<disposition> ][kind=<kind> ]<spec>[ — <reason>]`
// — parsed into the finding its ledger line is written from. A value outside a vocabulary answers
// `undefined`, which the writer refuses with the accepted values.

interface Positional {
	finding: Finding
	description: string
}

// A finding spec is `<category>:<severity>:<file>`; the file field keeps any `:line` a citation
// carries, so only the first two colons separate fields.
function to_finding(category: string, severity: string, file: string): Finding | undefined {
	if (
		!review_finding_ledger.is_category(category) ||
		!review_finding_ledger.is_severity(severity)
	) {
		return undefined
	}

	return review_finding_ledger.is_valid_file(file) ? { category, severity, file } : undefined
}

function parse_finding(spec: string): Finding | undefined {
	const first = spec.indexOf(':')
	const second = spec.indexOf(':', first + 1)

	if (first === -1 || second === -1) return undefined

	return to_finding(spec.slice(0, first), spec.slice(first + 1, second), spec.slice(second + 1))
}

function marked_finding(finding: Finding, disposition?: string, kind?: string): Finding {
	return {
		...finding,
		...(disposition !== undefined && { disposition }),
		...(kind !== undefined && { kind }),
	}
}

// The disposition and the kind both ride into the ledger line.
function parse_positional(positional: string): Positional | undefined {
	const { spec: marked, description } = review_finding_text.split_description(positional)
	const { disposition, spec: rest } = review_finding_ledger.split_disposition(marked)
	const { kind, spec } = review_finding_kind.split_kind(rest) ?? { kind: undefined, spec: '' }
	const finding = parse_finding(spec)

	if (finding === undefined) return undefined

	return { finding: marked_finding(finding, disposition, kind), description }
}

const review_finding_spec = { parse_finding, parse_positional }

export type { Positional }
export { review_finding_spec }
