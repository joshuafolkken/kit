import { epic_graph, type EpicChild } from './epic-graph'

// Reading an epic's children against each other.
//
// `epic:check` verifies one epic's *format*; nothing verified that the children agree. A hand audit
// of joshuafolkken/kit#858 found two contradictions that would have stalled the implementation, and
// `epic:check` reported all four of its requirements as passing throughout (joshuafolkken/kit#870).
//
// The graph's own properties — a cycle, and a body that declares one order while the relations
// record another — are already detected by `epic:next` for its own purposes. This module is a
// consumer of that, not a second implementation. What is new here is reading *inside* the children.

// An issue reference anywhere in prose. Deliberately broader than the task-list pattern the epic
// format uses: the point is to notice a child talking about another child at all.
//
// The lookbehind is load-bearing in both directions. `joshuafolkken/app-kit#12` names *another*
// repository's issue 12, and reading its tail as a local `#12` produced warnings about issues that
// were fine. But the bodies here write local references the same way — `joshuafolkken/kit#863` — so
// the current repository's own prefix is stripped before matching, or the check would ignore almost
// every reference it exists to read. Both halves were found by running this against a real epic.
const REFERENCE_PATTERN = /(?<![\w/-])#(\d+)\b/gu
// Where a child states what it must deliver. Both spellings, because the bodies are written in
// whichever language the session was in.
const ACCEPTANCE_HEADINGS: ReadonlyArray<string> = ['## 受け入れ条件', '## Acceptance criteria']
const HEADING_PREFIX = '## '

type FindingLevel = 'error' | 'warning'

interface AuditFinding {
	level: FindingLevel
	check: string
	message: string
}

// The issue numbers a piece of prose refers to. `repo` is the `owner/name` these issues live in;
// references qualified with it are local and are normalized to the bare form first.
function parse_references(text: string, repo = ''): Array<number> {
	const local = repo === '' ? text : text.replaceAll(`${repo}#`, '#')
	const numbers = Array.from(local.matchAll(REFERENCE_PATTERN), (match) => Number(match[1])).filter(
		(value) => Number.isSafeInteger(value),
	)

	return [...new Set(numbers)]
}

function is_acceptance_heading(line: string): boolean {
	return ACCEPTANCE_HEADINGS.includes(line.trim())
}

function is_heading(line: string): boolean {
	return line.trimStart().startsWith(HEADING_PREFIX)
}

// The lines under the acceptance-criteria heading, up to the next `##`. Shaped like the other
// section readers in this repository, for the same reason: a regex spanning the block backtracks.
function section_lines(lines: ReadonlyArray<string>): Array<string> {
	const start = lines.findIndex((line) => is_acceptance_heading(line))
	if (start === -1) return []
	const rest = lines.slice(start + 1)
	const end = rest.findIndex((line) => is_heading(line))

	return end === -1 ? rest : rest.slice(0, end)
}

// The acceptance-criteria section of a child's body, or an empty string.
function acceptance_section(body: string | undefined): string {
	if (body === undefined) return ''

	return section_lines(body.split('\n')).join('\n')
}

// Everything `node` depends on, directly or through a chain. Walked iteratively so a graph that
// still contains a cycle terminates — `epic:next` rejects one first, but an auditor must not hang on
// the input it exists to examine.
function collect_blockers(
	index: ReadonlyMap<number, EpicChild>,
	node: number,
): ReadonlySet<number> {
	const seen = new Set<number>()
	const pending = [...epic_graph.blockers_of(index, node)]

	while (pending.length > 0) {
		const current = pending.pop() ?? node

		if (!seen.has(current)) {
			seen.add(current)
			pending.push(...epic_graph.blockers_of(index, current))
		}
	}

	return seen
}

function depends_on(index: ReadonlyMap<number, EpicChild>, node: number, target: number): boolean {
	return collect_blockers(index, node).has(target)
}

const epic_audit_logic = {
	REFERENCE_PATTERN,
	ACCEPTANCE_HEADINGS,
	parse_references,
	acceptance_section,
	collect_blockers,
	depends_on,
}

export type { AuditFinding, FindingLevel }
export { epic_audit_logic }
