import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { SoloSelection } from '#scripts/epic/epic-solo'
import { session_cite } from '#scripts/issue/session-cite'

// Which candidates may not run side by side because their bodies declare overlapping paths.
// joshuafolkken/kit#3221 held back only a path both bodies named beside a move, split, rename or
// delete verb, on the reading that a plain overlap always merged mechanically. It did not:
// joshuafolkken/kit#3582 named `scripts/lines/effective-limit.ts`, joshuafolkken/kit#3586 named
// `scripts/lines/**`, and the two lanes met a content conflict that stopped the second ship
// (joshuafolkken/kit#3617). So any overlap now holds the later one back — the same file named by
// both, or a path inside the other's directory glob. A directory one segment deep (`scripts/`) is
// too broad to count, and an issue reference (`owner/repo#N`) is not a path. A dotted token with no
// `/` is a file only when its extension is one this repository keeps at the root — otherwise
// `session_cite.issue` or `process.env` would claim a path and serialize unrelated lanes.
const CODE_SPAN = /`([^`\s]+)`/gu
const LINE_SUFFIX = /:\d+(?:[-:]\d+)?$/u
const FILE_EXTENSION = /\.[a-z]\w*$/iu
const ROOT_FILE_EXTENSION = /\.(?:[cm]?[jt]sx?|svelte|jsonc?|md|ya?ml|css|html|sh|toml|txt)$/u
const GLOB = '*'
const ISSUE_MARK = '#'
const SEPARATOR = '/'
const MIN_DIRECTORY_DEPTH = 2

// The paths each issue declares, by issue number. A directory ends in `/`; anything else is a file.
type Declared = ReadonlyMap<number, ReadonlySet<string>>

interface DeclaringIssue {
	number: number
	body?: string | undefined
}

// `scripts/lines/**` and `scripts/lines/*.ts` declare `scripts/lines/`; a path with no glob is itself.
function without_glob(path: string): string {
	const glob = path.indexOf(GLOB)

	return glob === -1 ? path : path.slice(0, path.lastIndexOf(SEPARATOR, glob) + 1)
}

function is_narrow(directory: string): boolean {
	return directory.split(SEPARATOR).filter(Boolean).length >= MIN_DIRECTORY_DEPTH
}

function is_file(path: string): boolean {
	return (path.includes(SEPARATOR) ? FILE_EXTENSION : ROOT_FILE_EXTENSION).test(path)
}

function claim_of(path: string): string | undefined {
	if (path.endsWith(SEPARATOR)) return is_narrow(path) ? path : undefined

	return is_file(path) ? path : undefined
}

// The backticked files and directories `body` declares.
function declared_paths(body: string): ReadonlySet<string> {
	const tokens = [...body.matchAll(CODE_SPAN)].map((match) => match[1] ?? '')
	const paths = tokens
		.filter((token) => !token.includes(ISSUE_MARK))
		.map((token) => claim_of(without_glob(token.replace(LINE_SUFFIX, ''))))

	return new Set(paths.filter((path) => path !== undefined))
}

function declared_of(issues: ReadonlyArray<DeclaringIssue>): Declared {
	return new Map(issues.map((issue) => [issue.number, declared_paths(issue.body ?? '')]))
}

function contains(outer: string, inner: string): boolean {
	return outer.endsWith(SEPARATOR) ? inner.startsWith(outer) : outer === inner
}

function overlaps(left: string, right: string): boolean {
	return contains(left, right) || contains(right, left)
}

interface SeparateContext {
	read: BusyRead
	repo: string
}

// The path each running lane declares, mapped to the issue that holds it.
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

interface Clash {
	path: string
	claimed: string
	holder: number
}

function clash_of(
	claims: ReadonlyMap<string, number>,
	paths: ReadonlySet<string>,
): Clash | undefined {
	const clashes = [...paths].flatMap((path) =>
		[...claims]
			.filter(([claimed]) => overlaps(claimed, path))
			.map(([claimed, holder]): Clash => ({ path, claimed, holder })),
	)

	return clashes[0]
}

function clash_note(child: EpicChild, clash: Clash): string {
	const waiting = session_cite.issue(child.number, undefined, child.repo)
	const holder = session_cite.issue(clash.holder, undefined, child.repo)

	return `${waiting} waits: its \`${clash.path}\` overlaps \`${clash.claimed}\`, which ${holder} declares.`
}

interface Walk {
	claims: Map<string, number>
	offered: Array<EpicChild>
	withheld: Array<EpicChild>
	notes: Array<string>
}

function visit(walk: Walk, child: EpicChild, paths: ReadonlySet<string>): void {
	const clash = clash_of(walk.claims, paths)

	if (clash === undefined) {
		walk.offered.push(child)
		for (const path of paths) walk.claims.set(path, child.number)

		return
	}

	walk.withheld.push(child)
	walk.notes.push(clash_note(child, clash))
}

function merged_notice(
	notice: string | undefined,
	notes: ReadonlyArray<string>,
): string | undefined {
	const parts = notice === undefined ? notes : [notice, ...notes]

	return parts.length === 0 ? undefined : parts.join('\n')
}

// `selection` with every offered candidate that declares a path overlapping one a running lane or
// an earlier candidate already declares moved to `withheld`, in offer order.
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

const backlog_overlap = { declared_of, declared_paths, separate }

export { backlog_overlap }
export type { Declared }
