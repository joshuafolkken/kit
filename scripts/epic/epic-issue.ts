import { parse_json_object_safe } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// The shapes `gh issue view --json …` answers with, and the argument every epic command takes.
//
// Single-sourced because three commands read the same JSON and take the same argument. Each had its
// own copy of the schema, the `blockedBy` unwrapping and the number parser, which is three places to
// fix the next time `gh` changes shape — and the one place a divergence would not be noticed
// (joshuafolkken/kit#862).

const label_schema = z.object({ name: z.string() })
const blocker_schema = z.object({ number: z.number() })
// `gh` answers a GraphQL connection — `{ nodes, totalCount }` — not a bare array. Measured against a
// real issue rather than assumed (joshuafolkken/kit#860).
const blocked_by_schema = z.object({ nodes: z.array(blocker_schema).default([]) }).optional()

const CLOSED = 'CLOSED'
const UNKNOWN_STATE = 'UNKNOWN'

// Every field any epic command reads. Only `number` is required: a child reported with a field
// missing is still a child, and dropping it would hide it from the view a decision is made from.
// `body` is nullable because `gh` answers JSON null for an issue with none.
const epic_issue_schema = z.object({
	number: z.number(),
	title: z.string().default(''),
	body: z
		.string()
		.nullable()
		.default('')
		.transform((value) => value ?? ''),
	state: z.string().default(UNKNOWN_STATE),
	labels: z.array(label_schema).default([]),
	blockedBy: blocked_by_schema,
})

type EpicIssue = z.infer<typeof epic_issue_schema>

// A shape surprise reads as an unreadable issue rather than throwing: `gh`'s JSON is somebody else's
// contract, and these commands are what a run consults before it starts.
function parse_epic_issue(raw: string | undefined): EpicIssue | undefined {
	if (raw === undefined) return undefined

	try {
		return parse_json_object_safe(raw, epic_issue_schema)
	} catch {
		return undefined
	}
}

// The blockers an issue declares, unwrapped from the connection.
function blockers_of(issue: EpicIssue): Array<number> {
	return (issue.blockedBy?.nodes ?? []).map((blocker) => blocker.number)
}

function label_names(issue: EpicIssue): Array<string> {
	return issue.labels.map((label) => label.name)
}

// `OPEN` or `CLOSED`, whatever casing `gh` used.
function normalize_state(state: string): 'OPEN' | 'CLOSED' {
	return state.toUpperCase() === CLOSED ? CLOSED : 'OPEN'
}

// `#123` and `123` are both accepted: the number is copied out of an issue reference as often as it
// is typed. `owner/repo#123` is refused rather than read as `123`, which would answer about *this*
// repository's issue of that number — a different issue entirely.
function parse_epic_number(raw = ''): number | undefined {
	if (raw.includes('/')) return undefined
	const parsed = Number(raw.replace('#', ''))

	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

// An epic reference: `858`, `#858`, or `owner/repo#858` for an epic in another repository.
//
// A cross-repository epic must be qualified. A bare `#858` resolves to *this* repository's issue 858
// — a different issue entirely — so reading it as the other repository's would silently point at the
// wrong thing (joshuafolkken/kit#864).
interface EpicReference {
	repo?: string
	number: number
}

const QUALIFIED_REFERENCE = /^([\w.-]+\/[\w.-]+)#(\d+)$/u
const QUALIFIED_REPO_GROUP = 1
const QUALIFIED_NUMBER_GROUP = 2

function to_qualified_reference(match: RegExpExecArray): EpicReference | undefined {
	const repo = match[QUALIFIED_REPO_GROUP]
	if (repo === undefined) return undefined
	const number = Number(match[QUALIFIED_NUMBER_GROUP])

	return Number.isSafeInteger(number) && number > 0 ? { repo, number } : undefined
}

function parse_epic_reference(raw = ''): EpicReference | undefined {
	const match = QUALIFIED_REFERENCE.exec(raw.trim())
	if (match !== null) return to_qualified_reference(match)
	const number = parse_epic_number(raw)

	return number === undefined ? undefined : { number }
}

const epic_issue = {
	CLOSED,
	UNKNOWN_STATE,
	parse_epic_issue,
	blockers_of,
	label_names,
	normalize_state,
	parse_epic_number,
	parse_epic_reference,
}

export type { EpicIssue, EpicReference }
export { epic_issue }
