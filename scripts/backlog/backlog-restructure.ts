import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { SoloSelection } from '#scripts/epic/epic-solo'
import { session_cite } from '#scripts/issue/session-cite'

// Which candidates may not run side by side because both restructure the same file.
// The condition is deliberately narrow: plain overlap is not serialized,
// because every resume record of the 2026-10-05 backlog run was resolved mechanically by merging
// main. What git cannot resolve on its own is a rename or modify/delete conflict — two lanes that
// each move, split, rename or delete the same file — so only a path both bodies name on a line with
// such a verb holds the second one back. `remove` is left out: issue bodies use it for lines and
// options far more often than for files.
const RESTRUCTURE_WORDS: ReadonlySet<string> = new Set([
	'move',
	'moved',
	'moves',
	'moving',
	'rename',
	'renamed',
	'renames',
	'renaming',
	'split',
	'splits',
	'splitting',
	'delete',
	'deleted',
	'deletes',
	'deleting',
])
const RESTRUCTURE_PHRASES: ReadonlyArray<string> = ['移動', '分割', '削除', 'リネーム', '改名']
const WORD = /[a-z]+/giu
const CODE_SPAN = /`([^`\s]+)`/gu
const LINE_SUFFIX = /:\d+(?::\d+)?$/u
const FILE_EXTENSION = /\.[a-z]\w*$/iu

// The restructured paths each issue declares, by issue number.
type Declared = ReadonlyMap<number, ReadonlySet<string>>

interface DeclaringIssue {
	number: number
	body?: string | undefined
}

function is_path(token: string): boolean {
	return token.includes('/') || FILE_EXTENSION.test(token)
}

function paths_on(line: string): Array<string> {
	return [...line.matchAll(CODE_SPAN)]
		.map((match) => (match[1] ?? '').replace(LINE_SUFFIX, ''))
		.filter((token) => is_path(token))
}

function is_restructuring(line: string): boolean {
	const words = line.match(WORD) ?? []

	if (words.some((word) => RESTRUCTURE_WORDS.has(word.toLowerCase()))) return true

	return RESTRUCTURE_PHRASES.some((phrase) => line.includes(phrase))
}

// The backticked paths on the lines of `body` that carry a restructuring verb.
function restructured_paths(body: string): ReadonlySet<string> {
	const lines = body.split('\n').filter((line) => is_restructuring(line))

	return new Set(lines.flatMap((line) => paths_on(line)))
}

function declared_of(issues: ReadonlyArray<DeclaringIssue>): Declared {
	return new Map(issues.map((issue) => [issue.number, restructured_paths(issue.body ?? '')]))
}

interface SeparateContext {
	read: BusyRead
	repo: string
}

// The path each running lane restructures, mapped to the issue that holds it.
function running_claims(declared: Declared, read: BusyRead): Map<string, number> {
	const holders = read.kind === 'busy' ? read.issues.map((issue) => issue.number) : []
	const pairs = holders.flatMap((number) =>
		[...(declared.get(number) ?? [])].map((path): [string, number] => [path, number]),
	)

	return new Map(pairs)
}

function paths_of(child: EpicChild, declared: Declared, repo: string): ReadonlySet<string> {
	if (child.repo !== repo) return new Set()

	return declared.get(child.number) ?? new Set()
}

function clash_note(child: EpicChild, path: string, holder: number): string {
	const waiting = session_cite.issue(child.number, undefined, child.repo)

	return `${waiting} waits: it and ${session_cite.issue(holder, undefined, child.repo)} both restructure \`${path}\`.`
}

interface Walk {
	claims: Map<string, number>
	offered: Array<EpicChild>
	withheld: Array<EpicChild>
	notes: Array<string>
}

function visit(walk: Walk, child: EpicChild, paths: ReadonlySet<string>): void {
	const clash = [...paths].find((path) => walk.claims.has(path))

	if (clash === undefined) {
		walk.offered.push(child)
		for (const path of paths) walk.claims.set(path, child.number)

		return
	}

	walk.withheld.push(child)
	walk.notes.push(clash_note(child, clash, walk.claims.get(clash) ?? child.number))
}

function merged_notice(
	notice: string | undefined,
	notes: ReadonlyArray<string>,
): string | undefined {
	const parts = notice === undefined ? notes : [notice, ...notes]

	return parts.length === 0 ? undefined : parts.join('\n')
}

// `selection` with every offered candidate that restructures a path a running lane or an earlier
// candidate already restructures moved to `withheld`, in offer order.
function separate(
	selection: SoloSelection,
	declared: Declared,
	context: SeparateContext,
): SoloSelection {
	const walk: Walk = {
		claims: running_claims(declared, context.read),
		offered: [],
		withheld: [],
		notes: [],
	}

	for (const child of selection.offered) visit(walk, child, paths_of(child, declared, context.repo))

	const notice = merged_notice(selection.notice, walk.notes)
	const withheld = [...walk.withheld, ...selection.withheld]

	return { offered: walk.offered, withheld, ...(notice !== undefined && { notice }) }
}

const backlog_restructure = { declared_of, restructured_paths, separate }

export { backlog_restructure }
export type { Declared }
