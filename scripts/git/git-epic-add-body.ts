import { git_epic_chains, type Chains, type InsertPosition } from './git-epic-chains'
import { git_epic_decision } from './git-epic-decision'
import { git_epic_parse, UNORDERED_DEPENDENCIES } from './git-epic-parse'
import {
	format_dependency_link,
	format_issue_references,
	to_issue_reference,
} from './git-epic-reference'
import { git_epic_sections, type BodyLines, type SectionRange } from './git-epic-sections'

// Rewriting an epic body so its task list and its dependency declaration both name a newly inserted
// child, and refusing to hand back a body that would not.
//
// The declaration lives in three places at once — the task list the auto-close reads, the arrow
// declaration `epic:next` parses, and the native `blocked-by` relations — and editing the body by
// hand is what leaves them disagreeing, which stops an unattended run outright. So the rewritten
// body is parsed back before it is returned, and a round trip that does not reproduce the intended
// links is reported instead of written (joshuafolkken/kit#890).

interface RewriteInput {
	body: string
	// The children being placed, in the order the caller named them: the additions and the children
	// the epic already tracks, together in one list. **A position places both kinds the same way** —
	// the task-list row and the declaration are one statement, so an addition whose row was appended
	// while the chain named a position left the two disagreeing (joshuafolkken/kit#1704). Which of
	// them already has a row is read off the body rather than passed in, since the two are placed
	// identically and only the removal of an existing row differs.
	placed: ReadonlyArray<number>
	// Where `--before` / `--after` puts them. `undefined` is an insertion that declared no order, and
	// then the rows are appended — with no order declared, where a row sits says nothing.
	position?: InsertPosition | undefined
	chains_after: Chains
	// The decision record to append to the epic's `## Decisions` section, or `undefined` for an
	// insertion that records none. It is folded in **before** the declaration work below, so the stray
	// declaration and round-trip guards see the record too: a record carrying a bare `#A -> #B` line
	// would otherwise be written and then read back by `epic:next` as part of the order
	// (joshuafolkken/kit#1350).
	decision?: string | undefined
	// Whether an empty `chains_after` means "write that there is no order" rather than "leave the
	// declaration alone" (joshuafolkken/kit#1712).
	//
	// The two callers mean opposite things by it. An insertion given no position computes no chains
	// because none were ever declared, so the body is left exactly as it stood. A removal that took out
	// the last declared link computed the empty declaration deliberately, and leaving the body alone
	// would keep the chain it was asked to delete — while emptying the section would leave no
	// machine-readable declaration at all, which `epic:check` refuses and `epic:next` reads as an
	// error. So that caller writes the unordered sentence instead.
	does_clear_declaration?: boolean | undefined
}

type RewriteOutcome = { body: string } | { error: string }

const { find_indices, is_in_range, to_body_lines } = git_epic_sections

function to_task_row(issue_number: number): string {
	return `- [ ] ${to_issue_reference(issue_number)}`
}

function to_task_rows(placed: ReadonlyArray<number>): Array<string> {
	return placed.map((issue_number) => to_task_row(issue_number))
}

// New rows go directly after the last existing one, so they land inside the `Progress` list rather
// than at the bottom of the body. The list is located by its rows, not by its heading: an epic
// promoted from an existing issue keeps whatever headings that issue had. This is the path an
// insertion that declared no order takes, and the only one it can take: with no position named there
// is nothing for a row to be relative to.
function append_task_rows(input: BodyLines, placed: ReadonlyArray<number>): Array<string> {
	const rows = find_indices(input, (line) => git_epic_parse.is_task_list_line(line))
	const last = rows.at(-1)
	if (last === undefined) return [...input.lines]

	return [
		...input.lines.slice(0, last + 1),
		...to_task_rows(placed),
		...input.lines.slice(last + 1),
	]
}

// The issue a task-list row names, read through the parser rather than a second pattern of its own —
// a row this recognizes is exactly a row `epic:next` and the auto-close read.
function to_row_number(line: string): number | undefined {
	const [issue_number] = git_epic_parse.parse_task_list_issue_numbers(line)

	return issue_number
}

function is_placed_row(line: string, placed: ReadonlySet<number>): boolean {
	const issue_number = to_row_number(line)

	return issue_number !== undefined && placed.has(issue_number)
}

// The rows of the placed children, put beside the row the position names. **The list order is part
// of what a position declares**: `epic:next` presents an epic's children in task-list order
// (joshuafolkken/kit#1583), so rewriting only the declaration would leave the two disagreeing
// (joshuafolkken/kit#1701).
//
// **Both kinds of placement go through here.** A child the epic already tracks has its row lifted
// out first; an addition has none to lift, so the same insertion serves both and they land in the
// order the caller named rather than in the order they were classified (joshuafolkken/kit#1704).
//
// The target's row is located after the removal rather than before it, so the index needs no
// adjusting for the rows that came out above it. Both lookups go through `find_indices`, which skips
// fenced lines — a `- [ ] #N` inside a code block is an example, not a row.
function insert_task_rows(
	input: BodyLines,
	placed: ReadonlyArray<number>,
	position: InsertPosition,
): Array<string> {
	const moved = new Set(placed)
	const dropped = new Set(find_indices(input, (line) => is_placed_row(line, moved)))
	const kept = input.lines.filter((_line, index) => !dropped.has(index))
	const [at] = find_indices(to_body_lines(kept), (line) => to_row_number(line) === position.target)
	if (at === undefined) return [...input.lines]
	const insert_at = position.kind === 'before' ? at : at + 1

	return [...kept.slice(0, insert_at), ...to_task_rows(placed), ...kept.slice(insert_at)]
}

// The task list with the placed children in it: at the position where one was named, appended where
// none was. An insertion that named no position appends, which is every insertion made before
// joshuafolkken/kit#1701 and every unordered one since.
function to_placed_lines(input: RewriteInput): Array<string> {
	const lines = to_body_lines(input.body)
	const { position } = input
	if (position === undefined) return append_task_rows(lines, input.placed)

	return insert_task_rows(lines, input.placed, position)
}

// Where the `Dependencies` section runs: the lines after its heading, up to the next heading. The
// replacement is scoped to it rather than to the whole body, because a declaration-shaped line can
// legitimately appear elsewhere — a rationale paragraph quoting `#890 -> #891` is prose, and
// rewriting it would destroy the sentence while the round-trip guard saw an identical link set.
const DEPENDENCIES_HEADING = /^#{1,6}[ \t]+Dependencies\b/u

function find_dependencies_range(input: BodyLines): SectionRange | undefined {
	return git_epic_sections.find_section_range(input, DEPENDENCIES_HEADING)
}

function splice_declaration(
	lines: ReadonlyArray<string>,
	input: { first: number; dropped: ReadonlySet<number>; rendered: ReadonlyArray<string> },
): Array<string> {
	return lines.flatMap((line, index) => {
		if (index === input.first) return [...input.rendered]
		if (input.dropped.has(index)) return []

		return [line]
	})
}

// The declaration is replaced in place: the first declaration line inside the section becomes the
// whole new declaration, and any further ones there are dropped. Replacing rather than appending is
// what keeps a superseded chain from being read back as a second, contradictory declaration.
function replace_declaration(
	lines: ReadonlyArray<string>,
	rendered: ReadonlyArray<string>,
): Array<string> | undefined {
	const input = to_body_lines(lines)
	const range = find_dependencies_range(input)
	if (range === undefined) return undefined

	const found = find_indices(input, (line) => git_epic_parse.is_declaration_line(line))
	const declarations = found.filter((index) => is_in_range(index, range))
	const [first] = declarations

	return first === undefined
		? [...lines.slice(0, range.end), ...rendered, ...lines.slice(range.end)]
		: splice_declaration(lines, { first, dropped: new Set(declarations.slice(1)), rendered })
}

// The declaration a line names, **re-rendered from the issue numbers it parsed to rather than echoed
// back**. The message has to name what it found, or the answer "move this line" is unactionable — and
// the body it comes from is not this process's: it is fetched from GitHub, and since
// joshuafolkken/kit#1350 it also carries a record file the caller supplied. Echoing a line of either
// into stderr puts content this code never read in the console, which is what SonarCloud's
// `tssecurity:S8689` reports for this path. Rendering from the parsed numbers keeps the useful half —
// the chain, exactly as the parser read it — while what reaches the console is built from integers.
//
// The unordered sentence parses to no chain, and its own constant stands in for it: that branch has no
// numbers to render, and the sentence is a literal this module already shares with the parser.
function to_safe_declaration(line: string): string {
	const [rendered] = git_epic_chains.render_chains(git_epic_parse.parse_dependency_chains(line))

	return rendered ?? UNORDERED_DEPENDENCIES
}

// A declaration-shaped line outside the section is read by `epic:next` as part of the declaration,
// while the rewrite deliberately will not touch it — so no insertion on this epic can ever produce a
// consistent body. Named here so the answer is "move this line", not "the order differs".
function find_stray_declaration(lines: ReadonlyArray<string>): string | undefined {
	const input = to_body_lines(lines)
	const range = find_dependencies_range(input)
	if (range === undefined) return undefined
	const stray = find_indices(input, (line) => git_epic_parse.is_declaration_line(line)).find(
		(index) => !is_in_range(index, range),
	)

	return stray === undefined ? undefined : to_safe_declaration(lines[stray] ?? '')
}

type BodyOutcome = { body: string } | { error: string }

// The task rows and the decision record, in that order. **The record goes in before the declaration
// work**: it is the one part of the new body that a caller wrote by hand, so the stray-declaration and
// round-trip guards below have to see it — a record appended afterwards would be written unchecked and
// read back by `epic:next` as part of the order (joshuafolkken/kit#1350).
function to_written_lines(input: RewriteInput): Array<string> {
	const with_rows = to_placed_lines(input)
	const { decision } = input
	if (decision === undefined) return with_rows

	return git_epic_decision.append_decision(with_rows.join('\n'), decision).split('\n')
}

// Whether the body already declares exactly the order the caller computed, chain structure included:
// the comparison is the rendered declaration rather than the link set, since two disjoint chains and
// one branching chain produce the same links.
function is_declaration_unchanged(
	lines: ReadonlyArray<string>,
	rendered: ReadonlyArray<string>,
): boolean {
	const declared = git_epic_parse.parse_dependency_chains(lines.join('\n'))

	return git_epic_chains.render_chains(declared).join('\n') === rendered.join('\n')
}

// The declaration work, once the task rows and any record are in.
//
// **An unchanged declaration is left as text rather than re-rendered** (joshuafolkken/kit#1253). The
// rewrite moves every chain line to the first one's index, so re-rendering a declaration nothing
// changed detaches the rationale lines a chain is documented by and files them under whichever chain
// ends up above them — a rewrite of somebody else's prose in exchange for a body that would have been
// byte-identical. An insertion given no position computes exactly the declaration it read, so this is
// the path it takes.
function to_declared_body(
	with_rows: ReadonlyArray<string>,
	rendered: ReadonlyArray<string>,
): BodyOutcome {
	const stray = find_stray_declaration(with_rows)

	if (stray !== undefined) {
		return {
			error: `The body declares \`${stray}\` outside the \`Dependencies\` section, which no insertion can keep consistent; move it into that section or reword it first.`,
		}
	}

	if (is_declaration_unchanged(with_rows, rendered)) return { body: with_rows.join('\n') }

	const replaced = replace_declaration(with_rows, rendered)

	return replaced === undefined
		? { error: 'Could not locate the `Dependencies` section to rewrite; nothing was written.' }
		: { body: replaced.join('\n') }
}

// The declaration to write. An empty computed order means "nothing was ever declared" to an
// insertion and "the last link was just deleted" to a removal, and only the second has anything to
// say — the unordered sentence, since an emptied section carries no machine-readable declaration at
// all (joshuafolkken/kit#1712).
function to_rendered_declaration(input: RewriteInput): Array<string> {
	const rendered = git_epic_chains.render_chains(input.chains_after)
	if (rendered.length > 0) return rendered

	return input.does_clear_declaration === true ? [UNORDERED_DEPENDENCIES] : []
}

function build_body(input: RewriteInput): BodyOutcome {
	const with_rows = to_written_lines(input)
	const rendered = to_rendered_declaration(input)

	if (rendered.length === 0) return { body: with_rows.join('\n') }

	return to_declared_body(with_rows, rendered)
}

function to_link_keys(chains: Chains): Array<string> {
	return git_epic_chains
		.links_of(chains)
		.map((link) => format_dependency_link(link))
		.toSorted((left, right) => left.localeCompare(right))
}

// Whether the written body would declare exactly the order the caller computed. Compared as sorted
// key lists rather than by reading the text back by eye — the round trip is the only evidence that
// the rewrite and the parser agree.
function has_intended_links(body: string, chains_after: Chains): boolean {
	const written = to_link_keys(git_epic_parse.parse_dependency_chains(body))
	const intended = to_link_keys(chains_after)

	return (
		written.length === intended.length && written.every((key, index) => key === intended[index])
	)
}

function missing_rows(body: string, expected: ReadonlyArray<number>): Array<number> {
	const tracked = git_epic_parse.parse_task_list_issue_numbers(body)

	return expected.filter((issue_number) => !tracked.includes(issue_number))
}

// The three things `epic:check` and `epic:next` read, verified against the body that would be
// written. Every failure here means the rewrite could not express the insertion, which is reported
// rather than written — a body that half-expresses it is exactly the state that stops a run.
function to_placement_start(position: InsertPosition, target: number, count: number): number {
	return position.kind === 'before' ? target - count : target + 1
}

// Whether the rewritten task list puts the placed rows where the position asked. The link round trip
// above says nothing about it — a body whose rows never moved declares exactly the same order and
// passes every other check here, while `epic:next` goes on presenting the order it was told to
// replace (joshuafolkken/kit#1701).
//
// **It covers an addition's row as well as a moved one**, since a position now places both: the row
// an addition gains is the half of the statement the declaration cannot verify for itself, and it
// was the half left unchecked (joshuafolkken/kit#1704).
function has_intended_rows(body: string, input: RewriteInput): boolean {
	const { position, placed } = input
	if (position === undefined || placed.length === 0) return true
	const tracked = git_epic_parse.parse_task_list_issue_numbers(body)
	const target = tracked.indexOf(position.target)
	if (target === -1) return false
	const start = to_placement_start(position, target, placed.length)

	return placed.every((child, offset) => tracked[start + offset] === child)
}

function find_rewrite_error(body: string, input: RewriteInput): string | undefined {
	const missing = missing_rows(body, input.placed)

	if (missing.length > 0) {
		return `The rewritten body would not track ${format_issue_references(missing)} as a task-list row.`
	}

	if (!git_epic_parse.has_machine_readable_declaration(body)) {
		return 'The rewritten body would carry no unambiguous machine-readable `Dependencies` declaration.'
	}

	if (!has_intended_links(body, input.chains_after)) {
		return 'The rewritten body would declare a different dependency order than the one computed; nothing was written.'
	}

	if (!has_intended_rows(body, input)) {
		return 'The rewritten body would not put the placed task-list rows where the position asked; nothing was written.'
	}

	return undefined
}

function rewrite_body(input: RewriteInput): RewriteOutcome {
	const built = build_body(input)
	if ('error' in built) return built
	const error = find_rewrite_error(built.body, input)

	return error === undefined ? built : { error }
}

const git_epic_add_body = {
	rewrite_body,
}

export { git_epic_add_body }
export type { RewriteInput, RewriteOutcome }
