import { git_epic_chains, type Chains } from './git-epic-chains'
import { DECLARED_CHAIN_LINE, git_epic_parse, UNORDERED_DEPENDENCIES } from './git-epic-parse'
import {
	format_dependency_link,
	format_issue_references,
	to_issue_reference,
} from './git-epic-reference'

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
	additions: ReadonlyArray<number>
	chains_after: Chains
}

type RewriteOutcome = { body: string } | { error: string }

interface BodyLines {
	lines: ReadonlyArray<string>
	// `false` for a fence line and everything between a pair of them. A declaration inside a fenced
	// block is an illustration, and rewriting one would edit a quoted template.
	mask: ReadonlyArray<boolean>
}

function to_body_lines(body: string): BodyLines {
	return { lines: body.split('\n'), mask: git_epic_parse.fence_mask(body) }
}

function is_readable(input: BodyLines, index: number): boolean {
	return input.mask[index] === true
}

function find_indices(input: BodyLines, is_wanted: (line: string) => boolean): Array<number> {
	return input.lines
		.map((line, index) => (is_readable(input, index) && is_wanted(line) ? index : -1))
		.filter((index) => index !== -1)
}

function is_declaration_line(line: string): boolean {
	const trimmed = line.trim()

	return DECLARED_CHAIN_LINE.test(trimmed) || trimmed === UNORDERED_DEPENDENCIES
}

function to_task_row(issue_number: number): string {
	return `- [ ] ${to_issue_reference(issue_number)}`
}

// New rows go directly after the last existing one, so they land inside the `Progress` list rather
// than at the bottom of the body. The list is located by its rows, not by its heading: an epic
// promoted from an existing issue keeps whatever headings that issue had.
function insert_task_rows(input: BodyLines, additions: ReadonlyArray<number>): Array<string> {
	const rows = find_indices(input, (line) => git_epic_parse.is_task_list_line(line))
	const last = rows.at(-1)
	if (last === undefined) return [...input.lines]
	const rendered = additions.map((issue_number) => to_task_row(issue_number))

	return [...input.lines.slice(0, last + 1), ...rendered, ...input.lines.slice(last + 1)]
}

// Where the `Dependencies` section runs: the lines after its heading, up to the next heading. The
// replacement is scoped to it rather than to the whole body, because a declaration-shaped line can
// legitimately appear elsewhere — a rationale paragraph quoting `#890 -> #891` is prose, and
// rewriting it would destroy the sentence while the round-trip guard saw an identical link set.
const DEPENDENCIES_HEADING = /^#{1,6}[ \t]+Dependencies\b/u
const ANY_HEADING = /^#{1,6}[ \t]/u

interface SectionRange {
	start: number
	end: number
}

function find_dependencies_range(input: BodyLines): SectionRange | undefined {
	const [heading] = find_indices(input, (line) => DEPENDENCIES_HEADING.test(line.trim()))
	if (heading === undefined) return undefined

	const start = heading + 1
	const next = input.lines
		.slice(start)
		.findIndex(
			(line, offset) => is_readable(input, start + offset) && ANY_HEADING.test(line.trim()),
		)

	return { start, end: next === -1 ? input.lines.length : start + next }
}

function is_in_range(index: number, range: SectionRange): boolean {
	return index >= range.start && index < range.end
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
	const input = { lines, mask: git_epic_parse.fence_mask(lines.join('\n')) }
	const range = find_dependencies_range(input)
	if (range === undefined) return undefined

	const found = find_indices(input, (line) => is_declaration_line(line))
	const declarations = found.filter((index) => is_in_range(index, range))
	const [first] = declarations

	return first === undefined
		? [...lines.slice(0, range.end), ...rendered, ...lines.slice(range.end)]
		: splice_declaration(lines, { first, dropped: new Set(declarations.slice(1)), rendered })
}

// A declaration-shaped line outside the section is read by `epic:next` as part of the declaration,
// while the rewrite deliberately will not touch it — so no insertion on this epic can ever produce a
// consistent body. Named here so the answer is "move this line", not "the order differs".
function find_stray_declaration(lines: ReadonlyArray<string>): string | undefined {
	const input = { lines, mask: git_epic_parse.fence_mask(lines.join('\n')) }
	const range = find_dependencies_range(input)
	if (range === undefined) return undefined
	const stray = find_indices(input, (line) => is_declaration_line(line)).find(
		(index) => !is_in_range(index, range),
	)

	return stray === undefined ? undefined : (lines[stray] ?? '').trim()
}

type BodyOutcome = { body: string } | { error: string }

function build_body(input: RewriteInput): BodyOutcome {
	const with_rows = insert_task_rows(to_body_lines(input.body), input.additions)
	const rendered = git_epic_chains.render_chains(input.chains_after)
	if (rendered.length === 0) return { body: with_rows.join('\n') }

	const stray = find_stray_declaration(with_rows)

	if (stray !== undefined) {
		return {
			error: `The body declares \`${stray}\` outside the \`Dependencies\` section, which no insertion can keep consistent; move it into that section or reword it first.`,
		}
	}

	const replaced = replace_declaration(with_rows, rendered)

	return replaced === undefined
		? { error: 'Could not locate the `Dependencies` section to rewrite; nothing was written.' }
		: { body: replaced.join('\n') }
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
function find_rewrite_error(body: string, input: RewriteInput): string | undefined {
	const missing = missing_rows(body, input.additions)

	if (missing.length > 0) {
		return `The rewritten body would not track ${format_issue_references(missing)} as a task-list row.`
	}

	if (!git_epic_parse.has_machine_readable_declaration(body)) {
		return 'The rewritten body would carry no unambiguous machine-readable `Dependencies` declaration.'
	}

	if (!has_intended_links(body, input.chains_after)) {
		return 'The rewritten body would declare a different dependency order than the one computed; nothing was written.'
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
	is_declaration_line,
	insert_task_rows,
	rewrite_body,
}

export { git_epic_add_body }
export type { RewriteInput, RewriteOutcome }
