import { readFileSync } from 'node:fs'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// The session state a cut carries across the process boundary. `RunCut`'s six
// scalar fields say *which* tree a fresh process resumes into — the branch, the issue, that a declared
// cut put it here. This says *what the run was told to do* there, which nothing else recovers: the
// user's instruction is not on GitHub, and what was done — or deliberately left alone — is not written
// on the diff. Without it a resumed session sees a working tree it did not build, is handed no
// instruction, and is put under the refactoring limits `CLAUDE.md` sets, so the shortest path out is to
// restructure or delete code it does not understand.
//
// **This is not the conversation the cut exists to drop.** Most of a lane's output is accumulated
// thinking, and the cut's whole point is to shed it. The instruction
// and a curated list of what is done, left, and untouched is the irreducible intent under that
// thinking — a few short lines, bounded by `MAX_HANDOFF_BYTES` in `run-cut.ts` — so carrying it keeps
// the resume on course without re-establishing the context the cut dropped.
interface Handoff {
	// The user's instruction for this run, verbatim — the constraints and the "leave this alone" nuances
	// a fresh process has no other way to learn.
	instruction: string
	// What the run has finished, what it has not, and what it chose not to touch. Each is a short list,
	// empty when there is nothing yet to say — an empty `untouched` is a legitimate "nothing was left
	// alone", not a missing field.
	completed: ReadonlyArray<string>
	remaining: ReadonlyArray<string>
	untouched: ReadonlyArray<string>
	// An attested review round's findings not yet `review:record`ed — the conversation that held them is
	// what the cut drops, so without this the resumed run reruns round 1 (joshuafolkken/kit#4868).
	findings?: ReadonlyArray<string> | undefined
}

const handoff_schema = z.object({
	instruction: z.string(),
	completed: z.array(z.string()),
	remaining: z.array(z.string()),
	untouched: z.array(z.string()),
	findings: z.array(z.string()).optional(),
})

// The label each list is printed under when the handoff is shown to the resumed session, kept beside
// the field so a rename cannot drift them apart.
const COMPLETED_LABEL = 'Completed'
const REMAINING_LABEL = 'Remaining'
const UNTOUCHED_LABEL = 'Deliberately untouched'
const INSTRUCTION_LABEL = 'Instruction (verbatim)'
const FINDINGS_LABEL =
	'Round-1 findings, attested but not recorded — do not rerun round 1: fix them, then record them with `pnpm josh review:record --issue <N>`'
const EMPTY_LIST_NOTE = '(none)'

type HandoffKey = keyof Handoff

// The placeholders each example value is drawn with; `findings`' says which round it carries. They
// parse, so a copied example is read as entries — `carried_findings` drops them, or a copied
// `findings` would pass the unrecorded-round refusal.
const PLACEHOLDER = '…'
const FINDINGS_PLACEHOLDER = 'unrecorded'
const EXAMPLE_LIST = `["${PLACEHOLDER}"]`

const EXAMPLE_VALUES: Readonly<Record<HandoffKey, string>> = {
	instruction: `"${PLACEHOLDER}"`,
	completed: EXAMPLE_LIST,
	remaining: EXAMPLE_LIST,
	untouched: EXAMPLE_LIST,
	findings: `["${FINDINGS_PLACEHOLDER}"]`,
}

// The shape a handoff file must have, keyed from `handoff_schema` so the refusal that asks for the file
// and the error that rejects it can never name a key the parser does not read — a refusal listing the
// items in prose invites Markdown, which `parse_handoff` rejects.
const HANDOFF_FORMAT = `{${handoff_schema
	.keyof()
	.options.map((key) => `"${key}":${EXAMPLE_VALUES[key]}`)
	.join(',')}}`

function parse_handoff(raw: string): Handoff | undefined {
	return json_value.parse_with(raw, handoff_schema)
}

// A path given but unreadable, or holding text that is not a well-formed handoff, is `undefined` — the
// caller refuses the cut rather than writing a record that cannot carry the instruction it was for.
function read_handoff_file(handoff_path: string): Handoff | undefined {
	try {
		return parse_handoff(readFileSync(handoff_path, 'utf8'))
	} catch {
		return undefined
	}
}

// A complete handoff carries a non-empty instruction; the lists may be empty. This is the required
// field the resume checks so a session is never silently continued without the instruction it needs.
function is_complete_handoff(handoff: Handoff | undefined): boolean {
	return handoff !== undefined && handoff.instruction.trim() !== ''
}

// The outcome of reading a `--handoff` path: `ok` with the handoff (or `undefined` when no path was
// given), or `bad` when the path was given but could not be read or was too large for the record.
type HandoffLoad = { kind: 'ok'; handoff?: Handoff | undefined } | { kind: 'bad'; note: string }

function is_within_bound(handoff: Handoff, max_bytes: number): boolean {
	return Buffer.byteLength(JSON.stringify(handoff), 'utf8') <= max_bytes
}

// A path is read into a handoff, refused when it will not parse or would push the record past its
// bound — the cut is only worth its resume while the record stays small.
function load_handoff(handoff_path: string | undefined, max_bytes: number): HandoffLoad {
	if (handoff_path === undefined) return { kind: 'ok', handoff: undefined }

	const handoff = read_handoff_file(handoff_path)

	if (handoff === undefined) {
		return {
			kind: 'bad',
			note: `--handoff ${handoff_path} is not a readable handoff file — write ${HANDOFF_FORMAT}`,
		}
	}

	if (!is_within_bound(handoff, max_bytes)) {
		return { kind: 'bad', note: `--handoff ${handoff_path} is too large to carry across the cut` }
	}

	return { kind: 'ok', handoff }
}

function describe_list(label: string, items: ReadonlyArray<string>): string {
	if (items.length === 0) return `${label}: ${EMPTY_LIST_NOTE}`

	const bullets = items.map((item) => `  - ${item}`).join('\n')

	return `${label}:\n${bullets}`
}

// The findings a handoff really carries: a blank entry or an example placeholder is no finding.
function carried_findings(handoff: Handoff | undefined): ReadonlyArray<string> {
	const findings = handoff?.findings ?? []

	return findings.filter(
		(finding) => ![PLACEHOLDER, FINDINGS_PLACEHOLDER, ''].includes(finding.trim()),
	)
}

// Carried findings are printed only when there are some — a handoff cut before any review says nothing
// about one.
function describe_findings(handoff: Handoff): ReadonlyArray<string> {
	const findings = carried_findings(handoff)

	if (findings.length === 0) return []

	return [describe_list(FINDINGS_LABEL, findings)]
}

// The block the resume prints to standard error so the fresh process continues on the original
// instruction rather than the tree alone.
function describe_handoff(handoff: Handoff): string {
	return [
		`${INSTRUCTION_LABEL}:\n${handoff.instruction}`,
		describe_list(COMPLETED_LABEL, handoff.completed),
		describe_list(REMAINING_LABEL, handoff.remaining),
		describe_list(UNTOUCHED_LABEL, handoff.untouched),
		...describe_findings(handoff),
	].join('\n\n')
}

// Where a handoff file is written: `.josh/tmp/` is ignored, so `josh git`, which stages every
// untracked non-ignored file, cannot commit the note with the code. A refusal that asked for "a file"
// and named no place got one written beside the code and committed (joshuafolkken/kit#3603).
const HANDOFF_PATH = '.josh/tmp/handoff-<N>.json'
const ISSUE_PLACEHOLDER = '<N>'

// The handoff path for one issue, relative to the checkout — the path `HANDOFF_PATH` tells the run
// to write, so the implementation-cut guard can let that one write through.
function handoff_path_of(issue: string): string {
	return HANDOFF_PATH.replace(ISSUE_PLACEHOLDER, () => issue)
}

const run_cut_handoff = {
	HANDOFF_FORMAT,
	HANDOFF_PATH,
	handoff_path_of,
	carried_findings,
	describe_handoff,
	handoff_schema,
	is_complete_handoff,
	load_handoff,
	parse_handoff,
	read_handoff_file,
}

export type { Handoff, HandoffLoad }
export { run_cut_handoff }
