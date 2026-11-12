import { acceptance_map } from '#scripts/review/acceptance-map'
import { issue_body_keys } from './issue-body-keys'
import { issue_sample_gate } from './issue-sample-gate'
import { measure_declaration } from './measure-declaration'
import { size_estimate } from './size-estimate'

// joshuafolkken/kit#4901: a follow-up that measures a pull request's effect reads records that only
// the merges after it write. Filed without its start condition, the backlog offers it at once and the
// lane finds no sample (#4897). It is refused until it declares the condition (`measurement.md`).
//
// A measurement follow-up is a body carrying a measure declaration, or one changing no file whose criterion
// reads the period after a cited change: its wording says "after #N" whichever record it reads
// (#5103), or it names a reader of the post-merge records. A record read that cites nothing (a CI
// investigation) waits on no merge, so it files as before. A bare "after" character ends many words
// that are no period ("last", "around", "from now on"), so it counts only right after the citation,
// a possessive particle or "merge"; one opening a word ("see below", "cleanup", "successor") is no
// period either.

const AFTER_CITED_CHANGE: ReadonlyArray<RegExp> = [
	/#[1-9]\d*(?:\s*|[^#\n]{0,16}?(?:の|マージ(?:した|直)?))後(?![述始片続])/u,
	/#[1-9]\d*[^#\n]{0,16}?(?:以降|以後)/u,
]
const RECORD_READERS: ReadonlyArray<string> = ['lane:stats', 'actions/runs', 'ship --log']
// joshuafolkken/kit#5886: `lane:breakdown` prints the ledger of lanes already run, so a criterion read
// through it (the command, then the particle "by") waits on later lanes whether or not it cites the
// change and whatever the body's estimate (#5860); one naming the command as its object, or one whose
// closing note names a test that verifies it inside the lane (a change to the output, #5216), reads none.
const LEDGER_READ = /lane:breakdown(?:[^`\n]*`)?\s*(?:の(?:出力|結果|表))?で(?![きすは])/u
const CLOSING_NOTE = /（[^（）]*）\s*$/u
const TEST_VERIFIED = 'テスト'
const CITATION_PATTERN = /#[1-9]\d*/u
const BACKGROUND_HEADING = issue_body_keys.heading('background')
const MISSING = `measurement follow-up without its start condition: declare \`${issue_sample_gate.DECLARATION}\`, or \`${issue_sample_gate.CLOSING_FORMAT}\` before that pull request exists, under ${BACKGROUND_HEADING} — prompts/collaboration-workflow/measurement.md → "効果を測る後続 Issue"`
// joshuafolkken/kit#5144: one waiting K merges reads one value against a bound, which `backlog:drive`
// does without a lane once it is declared; the declaration is the default, a stated reason the exception.
const UNDECLARED = `measurement follow-up without a measure declaration: declare \`${measure_declaration.DECLARATION}\` (any \`lane:stats\` cell: \`pnpm josh lane:value cell\`), or \`${measure_declaration.ABSENT}\` when no one command prints the value, under ${BACKGROUND_HEADING} — prompts/collaboration-workflow/measurement.md → "効果を測る後続 Issue"\n${measure_declaration.EXAMPLE}`

function measures_a_change(criterion: string): boolean {
	if (AFTER_CITED_CHANGE.some((pattern) => pattern.test(criterion))) return true

	return (
		CITATION_PATTERN.test(criterion) && RECORD_READERS.some((reader) => criterion.includes(reader))
	)
}

function reads_the_ledger(criterion: string): boolean {
	const note = CLOSING_NOTE.exec(criterion)?.[0] ?? ''

	return LEDGER_READ.test(criterion) && !note.includes(TEST_VERIFIED)
}

function is_measurement(body: string): boolean {
	if (measure_declaration.parse(body) !== undefined) return true
	const criteria = acceptance_map.criteria_of(body)
	if (criteria.some((criterion) => reads_the_ledger(criterion.text))) return true
	if (size_estimate.declared_files(body) !== 0) return false

	return criteria.some((criterion) => measures_a_change(criterion.text))
}

// The refusal for a measurement follow-up whose start condition does not parse — missing, or
// malformed beside `issue_sample_gate.problems`' format refusal — or whose condition parses with no
// measure declaration nor a reason for none; `undefined` for any other filing.
function problem(body: string): string | undefined {
	if (issue_sample_gate.cited_number(body) !== undefined) {
		return measure_declaration.is_stated(body) ? undefined : UNDECLARED
	}

	return is_measurement(body) ? MISSING : undefined
}

const issue_sample_required = { problem }

export { issue_sample_required }
