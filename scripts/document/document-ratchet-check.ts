import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { project_checks } from '#scripts/gate/project-checks'
import { command_reference_line_budget } from './command-reference-line-budget'
import { issue_citation_budget } from './issue-citation-budget'

// The two document ratchets the gate's tests hold — the command reference's long-line ceiling
// (`command-reference.test.ts`) and each agent-read document's issue-citation count
// (`issue-citation-budget.test.ts`) — made reachable on the fast between-edits path beside
// `document-byte-check.ts`, so a documentation edit that breaks either surfaces in seconds rather
// than in a minutes-long `check:related` (joshuafolkken/kit#4986). The ceilings, the counting and the
// messages are the budget modules' alone; this adds none of its own.
//
// It reads no change of its own: `lint:related` hands in the files it already resolved. The citation
// check holds the documents the budget records; a document with no entry, and the whole-list checks
// (a stale or a zero entry), stay with the gate's test, which knows the agent-read set.
//
// Both ratchets are kit's: the budget records kit's paths, and a consumer's own file at one of them
// holds its own count, so a consumer root is checked by neither.

const LABEL = 'document ratchet'

function read_text(absolute_path: string): string | undefined {
	return existsSync(absolute_path) ? readFileSync(absolute_path, 'utf8') : undefined
}

// The long-line failure across the whole command reference, which the ceiling holds together.
function long_line_message(root: string): string | undefined {
	const texts = command_reference_line_budget.COMMAND_REFERENCE_DOCS.map((relative_path) =>
		read_text(path.join(root, relative_path)),
	).filter((text): text is string => text !== undefined)

	return command_reference_line_budget.long_line_violation(
		command_reference_line_budget.long_line_count(texts),
	)
}

function touches_command_reference(root: string, absolute_files: ReadonlyArray<string>): boolean {
	const references = new Set(command_reference_line_budget.COMMAND_REFERENCE_DOCS)

	return absolute_files.some((absolute_path) => references.has(path.relative(root, absolute_path)))
}

// The citation failure for one file the budget records, or undefined when it holds its count, has no
// entry, or is gone from the tree.
function citation_message(root: string, absolute_path: string): string | undefined {
	const relative_path = path.relative(root, absolute_path)
	const recorded = issue_citation_budget.recorded_citations_for(relative_path)
	const text = read_text(absolute_path)
	if (recorded === 0 || text === undefined) return undefined

	const current = issue_citation_budget.count_citations(text)

	return issue_citation_budget.citation_violation(relative_path, current, recorded)
}

function citation_messages(
	root: string,
	absolute_files: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return absolute_files
		.map((absolute_path) => citation_message(root, absolute_path))
		.filter((message): message is string => message !== undefined)
}

// Prints one labelled line per failure and answers non-zero, or stays silent and answers zero.
function report(messages: ReadonlyArray<string | undefined>): number {
	const lines = messages
		.filter((message): message is string => message !== undefined)
		.map((message) => `${LABEL}: ${message}`)
	if (lines.length === 0) return 0

	process.stdout.write(`${lines.join('\n')}\n`)

	return 1
}

// The check over a resolved change: the long-line ceiling when it touches a command reference page,
// and the citation count of every changed file the budget records. An unrelated change reads nothing.
function check_files(root: string, absolute_files: ReadonlyArray<string>): number {
	if (!project_checks.is_kit_repository(root)) return 0
	const long_line = touches_command_reference(root, absolute_files)
		? long_line_message(root)
		: undefined

	return report([long_line, ...citation_messages(root, absolute_files)])
}

// The whole-tree fallback: the long-line ceiling and every recorded document, a superset of any change.
function check_all(root: string): number {
	if (!project_checks.is_kit_repository(root)) return 0
	const absolute_files = issue_citation_budget.ISSUE_CITATION_BUDGET.map((entry) =>
		path.join(root, entry.path),
	)

	return report([long_line_message(root), ...citation_messages(root, absolute_files)])
}

const document_ratchet_check = { check_all, check_files }

export { document_ratchet_check }
