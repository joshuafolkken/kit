import { git_grep_hits } from '#scripts/git/git-grep-hits'
import { backlog_overlap } from './backlog-overlap'

// The body files a plan edits by naming what they define. A plan replaces the body's paths, which
// mostly cite evidence (joshuafolkken/kit#4937), but "extend `ThemeDefinition`" edits the file that
// defines it — joshuafolkken/kit#8676's plan named only the type, its body named the file, and it
// launched beside joshuafolkken/kit#8673, which planned that file (joshuafolkken/kit#8685).
//
// Only the body's files are searched, so a name never points at a file the issue did not mention, and
// the search is the `git grep` `plan:consumers` reads a name with. A search that fails keeps none —
// `lane:plan` still yields at the first edit.

const CODE_SPAN = /`([^`\s]+)`/gu
const CALL_SUFFIX = /\(\)$/u
// A compound name — snake_case, camelCase or PascalCase — not a plain word a body file may happen to
// declare as a local.
const IDENTIFIER = /^[A-Za-z_]\w*$/u
const COMPOUND = /[A-Z_]/u
const DEFINITION_KEYWORDS = '(interface|type|function|class|const|let|enum)'
// `-E` overrides the `-F` `git_grep_hits.search` sends first: git takes the last pattern-type flag.
const DEFINITION_FLAGS = ['-E', '-w']

function identifiers_of(plan: string): ReadonlyArray<string> {
	const spans = [...plan.matchAll(CODE_SPAN)].map((match) =>
		(match[1] ?? '').replace(CALL_SUFFIX, ''),
	)
	const names = spans.filter((span) => IDENTIFIER.test(span) && COMPOUND.test(span))

	return [...new Set(names)]
}

// A bare file name matches the file in any directory, as `with_resolved_names` reads it.
function pathspec_of(claim: string): string {
	return claim.includes('/') ? claim : `:(glob)**/${claim}`
}

async function defining_paths(
	plan: string,
	body: string,
	directory: string,
): Promise<ReadonlyArray<string>> {
	const names = identifiers_of(plan)
	const claims = [...backlog_overlap.declared_paths(body)]

	if (names.length === 0 || claims.length === 0) return []
	const pattern = `${DEFINITION_KEYWORDS}[[:space:]]+(${names.join('|')})`
	const result = await git_grep_hits.search(
		pattern,
		DEFINITION_FLAGS,
		claims.map((claim) => pathspec_of(claim)),
		directory,
	)

	return [...new Set(result.hits.map((hit) => hit.path))]
}

// `plan` followed by each body file that defines a name the plan carries, as code spans.
async function with_definitions(
	plan: string,
	body: string | undefined,
	directory: string,
): Promise<string> {
	const defining = await defining_paths(plan, body ?? '', directory)

	return [plan, ...defining.map((path) => `\`${path}\``)].join('\n')
}

const plan_definitions = { defining_paths, with_definitions }

export { plan_definitions }
