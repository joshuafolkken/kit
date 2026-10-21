import { git_grep_hits, type Hit } from '#scripts/git/git-grep-hits'
import { plan_consumers_section } from '#scripts/issue/plan-consumers-section'

// `josh plan:consumers <identifier...>` — where each identifier a plan adds or changes is already
// read or written, so its existing-consumers section names them rather than leaving them for the
// next incident to find. Every reference in the tracked tree — a CI workflow or a settings file reads
// a name as surely as code does — grouped by kind, then a draft of the section for the plan to finish.
// `.josh/` is left out: its observations and metrics record past runs rather than read the name.
//
// **Unlike `run:prep`'s code locations it keeps every line and every kind** — a prompt that tells a
// run to count a label is as much a consumer of it as the code that does — but caps each kind, so one
// common name cannot bury the rest.

type Kind = 'code' | 'config' | 'doc' | 'prompt' | 'test'

interface Consumers {
	identifier: string
	hits: ReadonlyArray<Hit>
	has_failed: boolean
}

const PATHSPECS = [':(exclude).josh']
const KINDS: ReadonlyArray<readonly [Kind, string]> = [
	['code', 'code'],
	['config', 'config and workflows'],
	['prompt', 'prompts and skills'],
	['doc', 'docs'],
	['test', 'tests'],
]
const TEST_PATH = /(?:\.test\.ts|\.e2e\.ts|\.snap)$/u
const CODE_PATH = /\.(?:ts|js|mjs|cjs|svelte|sh)$/u
const PROMPT_ROOTS = ['prompts/', '.claude/']
const MAX_HITS_PER_KIND = 20
const MAX_DRAFT_FILES = 8
const INDENT = '  '
const HIT_INDENT = `${INDENT}${INDENT}`
const HIT_SEPARATOR = '  '
const NO_REFERENCE = ' — no reference in the tracked tree'
const SEARCH_FAILED = ' — git grep failed; not searched'
const DRAFT_ACTION = '<直す | 影響なし | 別 Issue>'
const DRAFT_NO_REFERENCE = 'no existing reference'

// Markdown under `prompts/` or `.claude/` instructs a run and other Markdown is read by people; the
// rest that is neither code nor a test — workflows, settings, JSON and YAML data — is configuration.
function markdown_kind(path: string): Kind {
	return PROMPT_ROOTS.some((root) => path.startsWith(root)) ? 'prompt' : 'doc'
}

function kind_of(path: string): Kind {
	if (TEST_PATH.test(path)) return 'test'
	if (CODE_PATH.test(path)) return 'code'

	return path.endsWith('.md') ? markdown_kind(path) : 'config'
}

function more_line(count: number): Array<string> {
	return count > MAX_HITS_PER_KIND
		? [`${HIT_INDENT}… +${String(count - MAX_HITS_PER_KIND)} more`]
		: []
}

function format_kind(hits: ReadonlyArray<Hit>, kind: Kind, label: string): Array<string> {
	const of_kind = hits.filter((hit) => kind_of(hit.path) === kind)

	if (of_kind.length === 0) return []
	const lines = of_kind
		.slice(0, MAX_HITS_PER_KIND)
		.map((hit) => `${HIT_INDENT}${hit.path}:${hit.line}${HIT_SEPARATOR}${hit.excerpt}`)

	return [`${INDENT}${label}`, ...lines, ...more_line(of_kind.length)]
}

function format_consumers(consumers: Consumers): string {
	if (consumers.has_failed) return `${consumers.identifier}${SEARCH_FAILED}`
	if (consumers.hits.length === 0) return `${consumers.identifier}${NO_REFERENCE}`
	const kinds = KINDS.flatMap(([kind, label]) => format_kind(consumers.hits, kind, label))

	return [consumers.identifier, ...kinds].join('\n')
}

// Tests are left out of the draft: a test follows the code it covers, so it is never the consumer a
// plan has to decide about.
function kind_rank(path: string): number {
	return KINDS.findIndex(([kind]) => kind === kind_of(path))
}

// Code first, in `KINDS` order, so the cap drops docs before the code a plan most has to decide on.
function draft_files(hits: ReadonlyArray<Hit>): Array<string> {
	const paths = [...new Set(hits.map((hit) => hit.path))]
		.filter((path) => kind_of(path) !== 'test')
		.toSorted((left, right) => kind_rank(left) - kind_rank(right))
	const shown = paths.slice(0, MAX_DRAFT_FILES).map((path) => `\`${path}\``)
	const rest = paths.length - shown.length

	return rest > 0 ? [...shown, `+${String(rest)} more`] : shown
}

function draft_entry(consumers: Consumers): string {
	const files = draft_files(consumers.hits)

	if (files.length === 0) return `- \`${consumers.identifier}\`: ${DRAFT_NO_REFERENCE}`

	return `- \`${consumers.identifier}\`: ${files.join(', ')} — ${DRAFT_ACTION}`
}

function format_draft(all: ReadonlyArray<Consumers>): string {
	const entries = all.map((consumers) => draft_entry(consumers))

	return ['draft:', plan_consumers_section.HEADING, '', ...entries].join('\n')
}

async function find(identifier: string): Promise<Consumers> {
	return { identifier, ...(await git_grep_hits.search(identifier, [], PATHSPECS)) }
}

async function report(
	identifiers: ReadonlyArray<string>,
): Promise<{ text: string; has_failed: boolean }> {
	const all = await Promise.all(identifiers.map(async (identifier) => await find(identifier)))
	const sections = [...all.map((consumers) => format_consumers(consumers)), format_draft(all)]

	return { text: sections.join('\n\n'), has_failed: all.some((consumers) => consumers.has_failed) }
}

const plan_consumers = { kind_of, report }

export { plan_consumers }
