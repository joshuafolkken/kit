import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cost_tokens } from '#scripts/cost/cost-tokens'
import { investigation_reads } from '#scripts/delegation/investigation-reads'
import { time_format } from './time-format'
import { time_spans, type Span } from './time-spans'

// What the instruction text a run loads costs it in wall clock (joshuafolkken/kit#1477).
//
// **The Issue this answers asked to measure before cutting anything**, because the 22 frozen
// reduction proposals of joshuafolkken/kit#1469 all rested on an estimate: nobody could say how much
// of a run's time the loaded rules and procedures actually account for, so nobody could say whether
// removing them was worth the work. joshuafolkken/kit#1567 answered the credit half — the resident
// preamble is about 15% of billed input and the conversation is the other 85% — and this answers the
// wall-clock half, which is the one the reduction was ever argued from.
//
// **`cost-resident.ts` deliberately stops where this starts.** It sizes what is resident before any
// work happens — `CLAUDE.md`, the hooks, the skills *index* — and says in so many words that a
// skill's **body** is read only on invocation and is therefore not resident. That body is most of
// what a workflow run carries: `workflow-commands/SKILL.md` alone is larger than `CLAUDE.md`. So the
// quantity here is the resident preamble **plus** every instruction document the run went on to
// read, which is the whole of what a cut could return.
//
// **The number is an upper bound, and that is the point rather than a limitation.** Two of its
// three steps round in the same direction:
//
//   - A document is charged to the requests that actually followed it, counted from the assistant
//     turns the transcript records rather than assumed. **The first reading is why that is measured
//     and not assumed**: charging every document to every request after the first put one `epicrun`
//     parent's instruction text at 80.7% of its billed input, which is not a ceiling anyone can
//     decide from — a run reads its procedure partway through, and `epicrun.md` is a third of that
//     session's instruction weight on its own. Where a transcript carries no message ids to count
//     turns by, it still falls back to every request after the first, which is that same ceiling.
//   - The share of billed input is carried across to model wait unchanged, which assumes wait grows
//     with the prompt in proportion. It does not: output tokens dominate latency and a cached prefix
//     is re-read far more cheaply than it is first written, so the true share is smaller.
//
// An upper bound is what a *decision* needs. Cutting is worth doing only if the ceiling is worth
// having, so a small ceiling settles joshuafolkken/kit#1525 without anyone having to agree about the
// attribution model — and a large one would be the signal to measure the relationship properly
// rather than to start deleting.
//
// **A document that is resident *and* read is counted twice, which is correct rather than a leak.**
// `CLAUDE.md` is already inside the measured baseline, and opening it puts a second copy into the
// context as a tool result — so the run really is carrying it twice, and charging it once would
// under-report the thing this module exists to size.
//
// **Which files count is not decided here.** `investigation-reads.ts` already owns the definition of
// an instruction document — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `prompts/**`, `.claude/skills/**`,
// anchored at the repository root — because the investigation guard has to make the same judgement.
// A second copy of that list is how the two would come to disagree about what a rule is.

const NO_TOKENS = 0
const NO_SHARE = 0
const NO_TURNS = 0
const FIRST_REQUEST = 1
// Wide enough for the longest instruction path this repository has — `padEnd` does not truncate, so a
// narrower column silently pushes the token figures out of line for exactly the long skill paths this
// block exists to surface.
const LABEL_WIDTH = 54
const TOKEN_WIDTH = 9

const HEADING = 'Instruction text carried (upper bound on what cutting all of it could return):'
const NO_BILLING =
	'  share not measurable: this transcript recorded no billed input to take a share of'
// **The model wait here is this session's own, which is not the figure the category table above
// prints.** That one covers the family — the session plus the units it delegated — and this one
// cannot, because the numerator is one transcript's context and a unit carries its own.
const SESSION_SCOPE =
	'  scope: this session alone — the model wait above excludes the delegated units the Model row counts'

// One document the run read, sized from disk. `path` is relative to the repository root, which is
// what a reader deciding whether to cut it needs to see.
interface InstructionFile {
	path: string
	tokens: number
	// How many of the run's requests carried this document — the assistant turns that followed the
	// read, scaled onto the request count. This is what makes the figure a reading of the run rather
	// than of the documents: a procedure opened at the halfway mark rides half the requests.
	requests_after: number
}

// One document the moment it first entered the context. A re-read adds nothing, so the earliest
// instant is the one that counts.
interface Loaded {
	path: string
	ended_ms: number
}

interface InstructionLoad {
	files: Array<InstructionFile>
	// The documents read during the run, summed. Zero for a run that read none — a session that never
	// entered a workflow legitimately loads no procedure at all.
	read_tokens: number
	// The first request's whole billed input: the preamble that existed before any work happened.
	// Measured rather than estimated, which is why it is passed in rather than sized here.
	resident_tokens: number
	request_count: number
	// The preamble on every request, plus each document on the requests that followed the read. The
	// upper bound the header describes, reported as measured rather than clamped.
	carried_input_tokens: number
	billed_input_tokens: number
	// The carried total capped at what was actually billed, which is what the share and the attributed
	// wall clock are taken over. The two differ only for a **compacted** session: `resident_tokens` is
	// fixed at the first request's baseline, and compaction bills later requests below it, so the
	// carried total can exceed the billed one. A bound larger than the total it bounds is not a bound.
	charged_input_tokens: number
	token_share: number
	model_wait_ms: number
	attributed_ms: number
}

// A record rather than five parameters, both because the limit is four and because every caller has
// to assemble these from two different readers — the spans from this module's own side, the token
// figures from `cost-transcript.ts`.
interface InstructionsInput {
	spans: ReadonlyArray<Span>
	resident_tokens: number
	billed_input_tokens: number
	request_count: number
	model_wait_ms: number
}

// A call that read content, filtered to the documents that are instructions. Anything else a run
// reads is its subject, not its rules, and charging the subject here would make every run look
// rule-heavy in proportion to how much code it opened.
function instruction_targets(span: Span): Array<Loaded> {
	if (!investigation_reads.is_content_read(span.label)) return []

	return span.targets
		.filter((target) => investigation_reads.is_instruction_document(target))
		.map((target) => ({ path: investigation_reads.resolved(target), ended_ms: span.ended_ms }))
}

// **Deduplicated to the earliest read, because a document read twice is carried once.** The context
// holds one copy of the text however many times the run opened it, so counting both reads would price
// a re-read as new weight — and the copy has been riding every request since the *first* of them.
function first_loads(spans: ReadonlyArray<Span>): Array<Loaded> {
	const earliest = new Map<string, number>()
	const loads = spans.flatMap((span) => instruction_targets(span))

	for (const load of loads) {
		earliest.set(load.path, Math.min(earliest.get(load.path) ?? load.ended_ms, load.ended_ms))
	}

	return [...earliest].map(([file_path, ended_ms]) => ({ path: file_path, ended_ms }))
}

function read_paths(spans: ReadonlyArray<Span>): Array<string> {
	return first_loads(spans).map((load) => load.path)
}

function is_turn_opener(span: Span): boolean {
	return span.category === time_spans.MODEL_CATEGORY && span.message_id !== time_spans.NO_MESSAGE_ID
}

// **One instant per assistant turn, not per model span.** Claude Code writes one transcript line per
// content block and repeats the message id across them, so counting spans would count a long turn as
// many — the same distinction `time-round-trips.ts` draws for the round-trip block.
function turn_instants(spans: ReadonlyArray<Span>): Array<number> {
	const first = new Map<string, number>()
	const openers = spans.filter((span) => is_turn_opener(span))

	for (const span of openers) {
		if (!first.has(span.message_id)) first.set(span.message_id, span.ended_ms)
	}

	return [...first].map(([, ended_ms]) => ended_ms).toSorted((left, right) => left - right)
}

// **The fallback is the old ceiling, and it is named rather than silent.** A transcript written
// before message ids were recorded yields no turns to count, and charging the document to every
// request after the first is then the honest upper bound rather than a measurement.
function requests_after(
	instants: ReadonlyArray<number>,
	at_ms: number,
	request_count: number,
): number {
	if (instants.length === NO_TURNS) return Math.max(request_count - FIRST_REQUEST, NO_TURNS)

	const after = instants.filter((instant) => instant > at_ms).length

	return Math.round((after / instants.length) * request_count)
}

// An unreadable file is worth zero rather than throwing: a transcript outlives the tree it was
// written against, so a document deleted or renamed since the run is an ordinary answer here.
function file_tokens(absolute: string): number {
	try {
		return cost_tokens.estimate(readFileSync(absolute, 'utf8'))
	} catch {
		return NO_TOKENS
	}
}

function to_file(
	load: Loaded,
	input: InstructionsInput,
	instants: ReadonlyArray<number>,
): InstructionFile {
	return {
		path: path.relative(process.cwd(), load.path),
		tokens: file_tokens(load.path),
		requests_after: requests_after(instants, load.ended_ms, input.request_count),
	}
}

function to_files(
	input: InstructionsInput,
	instants: ReadonlyArray<number>,
): Array<InstructionFile> {
	return first_loads(input.spans)
		.map((load) => to_file(load, input, instants))
		.filter((file) => file.tokens > NO_TOKENS)
}

function sum_tokens(files: ReadonlyArray<InstructionFile>): number {
	return files.reduce((total, file) => total + file.tokens, NO_TOKENS)
}

// The preamble rides every request by definition — it is the first request's own billed input. Each
// document rides the requests that followed the read, which is the measurement above.
function carried_of(input: InstructionsInput, files: ReadonlyArray<InstructionFile>): number {
	const documents = files.reduce(
		(total, file) => total + file.tokens * file.requests_after,
		NO_TOKENS,
	)

	return input.resident_tokens * input.request_count + documents
}

// A transcript with no billed input is one the usage lines could not be read from. Zero is the honest
// share there — dividing would report `NaN`, and any other number would be invented.
function share_of(charged: number, billed: number): number {
	return billed === NO_TOKENS ? NO_SHARE : charged / billed
}

function build(input: InstructionsInput): InstructionLoad {
	const files = to_files(input, turn_instants(input.spans))
	const carried_input_tokens = carried_of(input, files)
	const charged = Math.min(carried_input_tokens, input.billed_input_tokens)
	const token_share = share_of(charged, input.billed_input_tokens)

	return {
		files,
		read_tokens: sum_tokens(files),
		resident_tokens: input.resident_tokens,
		request_count: input.request_count,
		carried_input_tokens,
		billed_input_tokens: input.billed_input_tokens,
		charged_input_tokens: charged,
		token_share,
		model_wait_ms: input.model_wait_ms,
		attributed_ms: token_share * input.model_wait_ms,
	}
}

function format_tokens(tokens: number): string {
	return tokens.toLocaleString('en-US').padStart(TOKEN_WIDTH)
}

function format_file(file: InstructionFile): string {
	const carried = `× ${String(file.requests_after)} requests`

	return `  ${file.path.padEnd(LABEL_WIDTH)}${format_tokens(file.tokens)}  ${carried}`
}

function label_of(text: string): string {
	return `  ${text.padEnd(LABEL_WIDTH)}`
}

// The share is taken over `charged_input_tokens` rather than the carried total, so the percentage and
// the attributed wall clock below it cannot disagree about which of the two they were clamped from.
function carried_line(load: InstructionLoad): string {
	const label = label_of(`carried input over ${String(load.request_count)} requests`)
	const share = time_format.format_share(load.charged_input_tokens, load.billed_input_tokens)

	return `${label}${format_tokens(load.carried_input_tokens)}  ${share} of billed input`
}

function attributed_line(load: InstructionLoad): string {
	const attributed = time_format.format_seconds(load.attributed_ms).padStart(TOKEN_WIDTH)
	const whole = time_format.format_seconds(load.model_wait_ms)

	return `${label_of("model wait attributed (this session's)")}${attributed}  of ${whole}`
}

// What the run read, which is sized from disk and does not depend on the usage lines parsing. It is
// printed even when the share cannot be taken: "these documents, this many tokens, share not
// measurable" is a more useful answer than silence about what was read.
function sizes_lines(load: InstructionLoad): Array<string> {
	return [
		...load.files.map((file) => format_file(file)),
		`${label_of('resident preamble (measured baseline)')}${format_tokens(load.resident_tokens)}`,
		`${label_of('instruction documents read')}${format_tokens(load.read_tokens)}`,
	]
}

function body_lines(load: InstructionLoad): Array<string> {
	if (load.billed_input_tokens === NO_TOKENS) return [...sizes_lines(load), NO_BILLING]

	return [...sizes_lines(load), carried_line(load), attributed_line(load), SESSION_SCOPE]
}

function format_instructions(load: InstructionLoad): string {
	return [HEADING, ...body_lines(load)].join('\n')
}

const time_instructions = {
	HEADING,
	NO_BILLING,
	NO_TOKENS,
	SESSION_SCOPE,
	build,
	format_instructions,
	read_paths,
}

export type { InstructionFile, InstructionLoad, InstructionsInput }
export { time_instructions }
