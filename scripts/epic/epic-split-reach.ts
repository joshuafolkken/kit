import { existsSync } from 'node:fs'
import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { session_cite } from '#scripts/issue/session-cite'

// A split whose child cannot merge alone because the new `scripts/` module it creates is imported
// only from a sibling child. `scripts/build/pack-boundary.test.ts` refuses a shipped scripts module
// no consumer entry reaches, so such a child stops mid-lane: joshuafolkken/kit#5708 created
// `run-board-throughput.ts`, its only caller was joshuafolkken/kit#5710's renderer, and the lane
// waited on a decision to fold the two (joshuafolkken/kit#5754).
//
// Read from the bodies before the epic is written, so the split itself is refused. A module counts
// as reached within its own child when that child also declares an existing scripts file — a
// candidate importer the same change set can wire it from.

const SCRIPTS_DIRECTORY = 'scripts/'
const TYPESCRIPT = '.ts'
const TEST_SUFFIX = '.test.ts'
const SEPARATOR = '/'

interface SplitChild {
	number: number
	body?: string | undefined
}

interface StrandedModule {
	child: number
	module: string
	importers: ReadonlyArray<number>
}

type PathPresence = (path: string) => boolean

function is_scripts_module(path: string): boolean {
	return (
		path.startsWith(SCRIPTS_DIRECTORY) && path.endsWith(TYPESCRIPT) && !path.endsWith(TEST_SUFFIX)
	)
}

function base_name(path: string): string {
	return path.slice(path.lastIndexOf(SEPARATOR) + 1)
}

function names_module(paths: ReadonlySet<string>, module: string): boolean {
	return [...paths].some((path) => base_name(path) === base_name(module))
}

function stranded_of(
	child: SplitChild,
	declared: ReadonlyMap<number, ReadonlySet<string>>,
	is_present: PathPresence,
): Array<StrandedModule> {
	const own = [...(declared.get(child.number) ?? [])].filter((path) => is_scripts_module(path))
	if (own.some((path) => is_present(path))) return []

	return own.map((module) => ({
		child: child.number,
		module,
		importers: [...declared]
			.filter(([number, paths]) => number !== child.number && names_module(paths, module))
			.map(([number]) => number),
	}))
}

// Each new scripts module a child creates with no importer of its own and a sibling naming it.
function stranded_modules(
	children: ReadonlyArray<SplitChild>,
	is_present: PathPresence,
): Array<StrandedModule> {
	const declared = backlog_overlap.declared_of(children)

	return children
		.flatMap((child) => stranded_of(child, declared, is_present))
		.filter((stranded) => stranded.importers.length > 0)
}

function format_stranded(stranded: StrandedModule): string {
	const importers = stranded.importers.map((number) => session_cite.issue(number)).join(', ')

	return `  - ${session_cite.issue(stranded.child)} creates \`${stranded.module}\`, named only by ${importers}`
}

function format_refusal(stranded: ReadonlyArray<StrandedModule>): string {
	return [
		'✖ This split has a child that cannot merge alone — the new scripts module it creates is imported only from a sibling, and `scripts/build/pack-boundary.test.ts` refuses an unreachable module:',
		...stranded.map((entry) => format_stranded(entry)),
		'Fold the importing child into the creating one as one Issue, or declare the importer in the creating child; nothing was written.',
	].join('\n')
}

// The refusal for `children`, or `undefined` when every child can merge alone.
async function refusal_of(children: ReadonlyArray<number>): Promise<string | undefined> {
	const bodies = await Promise.all(
		children.map(async (number) => ({
			number,
			body: await git_gh_command.issue_get_body(String(number)),
		})),
	)
	const stranded = stranded_modules(bodies, existsSync)

	return stranded.length === 0 ? undefined : format_refusal(stranded)
}

const epic_split_reach = { format_refusal, refusal_of, stranded_modules }

export { epic_split_reach }
export type { SplitChild, StrandedModule }
