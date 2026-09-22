import { readFileSync } from 'node:fs'
import { z } from 'zod'

// The session state a cut carries across the process boundary (joshuafolkken/kit#2354). `RunCut`'s six
// scalar fields say *which* tree a fresh process resumes into — the branch, the issue, that a declared
// cut put it here. This says *what the run was told to do* there, which nothing else recovers: the
// user's instruction is not on GitHub, and what was done — or deliberately left alone — is not written
// on the diff. Without it a resumed session sees a working tree it did not build, is handed no
// instruction, and is put under the refactoring limits `CLAUDE.md` sets, so the shortest path out is to
// restructure or delete code it does not understand.
//
// **This is not the conversation the cut exists to drop.** joshuafolkken/kit#1839 measured 176K of a
// lane's 204K output as accumulated thinking, and the cut's whole point is to shed it. The instruction
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
}

const handoff_schema = z.object({
	instruction: z.string(),
	completed: z.array(z.string()),
	remaining: z.array(z.string()),
	untouched: z.array(z.string()),
})

// The label each list is printed under when the handoff is shown to the resumed session, kept beside
// the field so a rename cannot drift them apart.
const COMPLETED_LABEL = 'Completed'
const REMAINING_LABEL = 'Remaining'
const UNTOUCHED_LABEL = 'Deliberately untouched'
const INSTRUCTION_LABEL = 'Instruction (verbatim)'
const EMPTY_LIST_NOTE = '(none)'

function parse_handoff(raw: string): Handoff | undefined {
	try {
		const parsed = handoff_schema.safeParse(JSON.parse(raw))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
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
// field the resume checks so a session is never silently continued without the instruction it needs
// (joshuafolkken/kit#2354).
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
// bound — the cut is only worth its resume while the record stays small (joshuafolkken/kit#2354).
function load_handoff(handoff_path: string | undefined, max_bytes: number): HandoffLoad {
	if (handoff_path === undefined) return { kind: 'ok', handoff: undefined }

	const handoff = read_handoff_file(handoff_path)

	if (handoff === undefined) {
		return { kind: 'bad', note: `--handoff ${handoff_path} is not a readable handoff file` }
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

// The block the resume prints to standard error so the fresh process continues on the original
// instruction rather than the tree alone.
function describe_handoff(handoff: Handoff): string {
	return [
		`${INSTRUCTION_LABEL}:\n${handoff.instruction}`,
		describe_list(COMPLETED_LABEL, handoff.completed),
		describe_list(REMAINING_LABEL, handoff.remaining),
		describe_list(UNTOUCHED_LABEL, handoff.untouched),
	].join('\n\n')
}

const run_cut_handoff = {
	describe_handoff,
	handoff_schema,
	is_complete_handoff,
	load_handoff,
	parse_handoff,
	read_handoff_file,
}

export type { Handoff, HandoffLoad }
export { run_cut_handoff }
