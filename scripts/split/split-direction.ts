import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import { epic_parse } from '#scripts/epic/epic-parse'
import { epic_shape } from '#scripts/epic/epic-shape'
import { epic_validate } from '#scripts/epic/epic-validate'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { SPLIT_ROUTE_LABEL, TIER_A_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { markdown_section } from '#scripts/issue/markdown-section'
import { session_cite } from '#scripts/issue/session-cite'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { file_reader } from '#scripts/lib/read-file'
import { test_related_pins } from '#scripts/test/test-related-pins'

// **A split whose kept Issue depends on what it splits off** (joshuafolkken/kit#5985) — the reverse of
// `epic-split-reach.ts`. joshuafolkken/kit#5953 filed the `run:entry` relay off as an independent
// split, while the criteria it kept still needed the relay: review round 1 blocked, and the file came
// back. Before a `josh issue:file --route split --found-during <N>` lands, the
// kept Issue's expected result and criteria are read for the names of the files the child declares —
// each file's module name and the `josh` commands it registers or its source names (joshuafolkken/kit#5992:
// #5953's criteria named `run:cut`, which the relay passes on, and never its module); a hit refuses
// the independent split and points at `run:split --prerequisite`.

const KEPT_HEADINGS = [issue_body_keys.heading('expected'), issue_body_keys.heading('criteria')]
const CODE_SPAN = /`([^`]+)`/gu
const NOT_A_NAME = /[\s:]/u
const LINE_SUFFIX = /:\d+(?:[-:]\d+)?$/u
const SEPARATOR = '/'
const EXTENSION = /\.[^.]*$/u
const WORD = /\s+/u
const COMMAND_WORD = /[\w:-]+/gu
const COMMAND_SEPARATOR = ':'
const MARKDOWN = /\.mdx?$/iu

interface SplitFiling {
	route: string | undefined
	found_during: string | undefined
	labels?: ReadonlyArray<string>
}

interface Reference {
	path: string
	name: string
}

// `run_entry_cli` and `run-entry-cli` name the same module.
function normalized(name: string): string {
	return name.replaceAll('_', '-')
}

function module_of(path: string): string {
	return normalized(path.slice(path.lastIndexOf(SEPARATOR) + 1).replace(EXTENSION, ''))
}

// The file or identifier a span names, by its stem: `run-entry-cli.ts:12` and `run_entry_cli.main`
// both name `run-entry-cli`, and a `:12` line suffix is dropped. A span still holding a space or `:` is
// a command line, whose words name no module.
function stem_of(span: string): string | undefined {
	const name = span.replace(LINE_SUFFIX, '')
	if (NOT_A_NAME.test(name)) return undefined
	const stem = name.slice(name.lastIndexOf(SEPARATOR) + 1).split('.', 1)[0] ?? ''

	return stem === '' ? undefined : normalized(stem)
}

function is_command(word: string): boolean {
	return word.includes(COMMAND_SEPARATOR) && Object.hasOwn(COMMAND_MAP, word)
}

// The `josh` commands a span's words name: `pnpm josh run:cut --resume <N>` names `run:cut`.
function commands_of(span: string): Array<string> {
	return span.split(WORD).filter((word) => is_command(word))
}

// The names the kept Issue's expected result and criteria write in code spans.
function kept_names(body: string): ReadonlySet<string> {
	const text = KEPT_HEADINGS.flatMap((heading) => markdown_section.section_lines(body, heading))
	const spans = [...text.join('\n').matchAll(CODE_SPAN)].map((match) => match[1] ?? '')
	const stems = spans.map((span) => stem_of(span)).filter((stem) => stem !== undefined)

	return new Set([...stems, ...spans.flatMap((span) => commands_of(span))])
}

// Registered commands still count; documentation mentions do not implement commands (#6417), and
// neither does a command registry, which lists every command's name (#6639).
function commands_for(path: string): Array<string> {
	const registered = Object.entries(COMMAND_MAP)
		.filter(([, entry]) => entry.script === path)
		.map(([command]) => command)
	if (MARKDOWN.test(path) || test_related_pins.is_registry_source(path)) return registered
	const source = file_reader.read_if_readable(path) ?? ''
	const named = [...source.matchAll(COMMAND_WORD)].map((match) => match[0])

	return [...new Set([...registered, ...named.filter((word) => is_command(word))])]
}

// The names a split-off file goes by: its module name, then its commands.
function names_of(path: string): Array<string> {
	return [module_of(path), ...commands_for(path)]
}

// The first name of each file `child_body` declares that the kept Issue's criteria name.
function references(kept_body: string, child_body: string): Array<Reference> {
	const kept = kept_names(kept_body)
	const files = [...backlog_overlap.declared_paths(child_body)].filter(
		(path) => !path.endsWith(SEPARATOR),
	)

	return files
		.map((path) => ({ path, name: names_of(path).find((candidate) => kept.has(candidate)) ?? '' }))
		.filter((reference) => reference.name !== '')
}

function format_refusal(kept: string, found: ReadonlyArray<Reference>): string {
	const named = found.map(({ path, name }) => `\`${name}\` (\`${path}\`)`).join(', ')

	return [
		`✖ ${session_cite.issue(kept)}'s expected result or acceptance criteria name what this split takes off: ${named}. The kept Issue depends on the split-off part, so it cannot merge first.`,
		`File the part as a prerequisite instead (\`--route split --label route:tier-a\`), then run \`pnpm josh run:split ${kept} --prerequisite <P>\` — \`prerequisite.md\`; nothing was filed.`,
	].join('\n')
}

// The kept Issue of a split child found during a plain issue number of this repository.
function kept_issue({ route, found_during }: SplitFiling): string | undefined {
	if (route !== SPLIT_ROUTE_LABEL || found_during === undefined) return undefined

	return issue_number_shape.is_issue_number(found_during) ? found_during : undefined
}

function is_prerequisite({ labels = [] }: SplitFiling): boolean {
	return labels.includes(TIER_A_ROUTE_LABEL)
}

// A promoted epic keeps the aggregate criteria of its children, not a deliverable that merges first.
// Reuse the same label/body contract that permits adding a child to that container.
async function kept_deliverable_body(issue: string): Promise<string | undefined> {
	const raw = await git_gh_command.issue_get_labels_and_body(issue)
	const subject = epic_validate.parse_epic_subject(raw)
	if (subject === undefined) return undefined
	const tracked = epic_parse.parse_task_list_issue_numbers(subject.body)
	const shape = { epic_number: subject.number, labels: subject.labels, body: subject.body }

	return epic_shape.find_subject_error(shape, tracked) === undefined ? undefined : subject.body
}

// The refusal for a split child filed from `found_during`, or `undefined` when it may split off
// independently. An unreadable kept body refuses nothing: the check is advice on the split's direction,
// not a gate on reaching GitHub.
async function refusal_of(filing: SplitFiling, child_body: string): Promise<string | undefined> {
	// A split prerequisite explicitly keeps the opposite dependency (joshuafolkken/kit#6300).
	if (is_prerequisite(filing)) return undefined
	const found_during = kept_issue(filing)
	if (found_during === undefined) return undefined
	const kept_body = await kept_deliverable_body(found_during)
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
