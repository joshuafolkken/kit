import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { markdown_section } from '#scripts/issue/markdown-section'
import { session_cite } from '#scripts/issue/session-cite'

// **A split whose kept Issue depends on what it splits off** (joshuafolkken/kit#5985) — the reverse of
// `epic-split-reach.ts`. joshuafolkken/kit#5953 filed the `run:entry` relay off as an independent
// split, while the criteria it kept still needed the relay: review round 1 blocked, and the file came
// back. Before a `josh issue:file --route split --found-during <N>` lands, the
// kept Issue's expected result and criteria are read for the module names of the files the child
// declares; a hit refuses the independent split and points at `run:split --prerequisite`.

const KEPT_HEADINGS = ['## 期待結果', '## 受け入れ条件']
const CODE_SPAN = /`([^`]+)`/gu
const NAME = /[\w-]+/gu
const SEPARATOR = '/'
const EXTENSION = /\.[^.]*$/u

interface SplitFiling {
	route: string | undefined
	found_during: string | undefined
}

interface Reference {
	path: string
	module: string
}

// `run_entry_cli` and `run-entry-cli` name the same module.
function normalized(name: string): string {
	return name.replaceAll('_', '-')
}

function module_of(path: string): string {
	return normalized(path.slice(path.lastIndexOf(SEPARATOR) + 1).replace(EXTENSION, ''))
}

// The names the kept Issue's expected result and criteria write in code spans.
function kept_names(body: string): ReadonlySet<string> {
	const text = KEPT_HEADINGS.flatMap((heading) => markdown_section.section_lines(body, heading))
	const spans = [...text.join('\n').matchAll(CODE_SPAN)].map((match) => match[1] ?? '')

	return new Set(spans.flatMap((span) => (span.match(NAME) ?? []).map((name) => normalized(name))))
}

// Each file `child_body` declares whose module name the kept Issue's criteria name.
function references(kept_body: string, child_body: string): Array<Reference> {
	const names = kept_names(kept_body)
	const files = [...backlog_overlap.declared_paths(child_body)].filter(
		(path) => !path.endsWith(SEPARATOR),
	)

	return files
		.map((path) => ({ path, module: module_of(path) }))
		.filter((reference) => names.has(reference.module))
}

function format_refusal(kept: string, found: ReadonlyArray<Reference>): string {
	const named = found.map(({ path, module }) => `\`${module}\` (\`${path}\`)`).join(', ')

	return [
		`✖ ${session_cite.issue(kept)}'s expected result or acceptance criteria name what this split takes off: ${named}. The kept Issue depends on the split-off part, so it cannot merge first.`,
		`File the part as a prerequisite instead (\`--route tier-a\`), then run \`pnpm josh run:split ${kept} --prerequisite <P>\` — \`prerequisite.md\`; nothing was filed.`,
	].join('\n')
}

// The kept Issue of a split child found during a plain issue number of this repository.
function kept_issue({ route, found_during }: SplitFiling): string | undefined {
	if (route !== SPLIT_ROUTE_LABEL || found_during === undefined) return undefined

	return issue_number_shape.is_issue_number(found_during) ? found_during : undefined
}

// The refusal for a split child filed from `found_during`, or `undefined` when it may split off
// independently. An unreadable kept body refuses nothing: the check is advice on the split's direction,
// not a gate on reaching GitHub.
async function refusal_of(filing: SplitFiling, child_body: string): Promise<string | undefined> {
	const found_during = kept_issue(filing)
	if (found_during === undefined) return undefined
	const kept_body = await git_gh_command.issue_get_body(found_during)
	const found = kept_body === undefined ? [] : references(kept_body, child_body)

	return found.length === 0 ? undefined : format_refusal(found_during, found)
}

// `false` once the refusal is printed, the way the filing's other holds answer.
async function is_direction_clear(filing: SplitFiling, child_body: string): Promise<boolean> {
	const refusal = await refusal_of(filing, child_body)

	if (refusal !== undefined) console.error(refusal)

	return refusal === undefined
}

const split_direction = { is_direction_clear, references, refusal_of }

export { split_direction }
export type { Reference, SplitFiling }
