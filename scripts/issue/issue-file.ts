import type { parseArgs } from 'node:util'
import { epic_issue } from '#scripts/epic/epic-issue'
import { epic_triage } from '#scripts/epic/epic-triage'
import { github_issue_url } from '#scripts/gh/github-issue-url'
import { cli_flags } from '#scripts/lib/cli-flags'
import { issue_backlinks } from './issue-backlinks'
import { issue_classification } from './issue-classification'
import {
	AUTO_OK_LABEL,
	DEPTH_LABEL_ORDER,
	FILING_ROUTE_LABELS,
	has_label_name,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
} from './issue-labels'
import { markdown_section } from './markdown-section'

// The decisions behind `josh issue:file`, kept apart from the command that
// reads the network so each one is a pure answer a test can pin. The filing steps are the command's
// arguments: a label the filing owes is a required option rather than a line to remember.

const DEPTH_PREFIX = 'depth:'
const ROUTE_PREFIX = 'route:'
const LIST_SEPARATOR = ','
const WORD_SEPARATOR = /\s+/u
const CODE_SPAN = /`/gu
// Prose written against a reference with no space — `(owner/repo#N)`, `owner/repo#N。`, Japanese text
// after the number — is trimmed off, so the anchored parsers below still see the reference itself.
const LEADING_NON_WORD = /^[^\w]+/u
const DIGIT = /\d/u

interface FileArguments {
	title: string
	body_file: string
	depth: string
	route: string | undefined
	labels: ReadonlyArray<string>
	repo: string | undefined
	distinct: ReadonlyArray<number>
	// `--over-cap`: the run is blocked by this filing, so the WIP cap does not hold it (`issue-wip.ts`).
	is_over_cap: boolean
	// `--no-auto-ok`: the Issue needs a person's judgement, so `auto-ok` is not applied (`issue-auto-ok.ts`).
	is_auto_ok_opted_out: boolean
	// `--requested`: a person asked for this filing, so `auto-ok` is applied only when a `--label` names
	// it (`issue-auto-ok.ts`).
	is_requested: boolean
	// `--release`: the change reaches a consumer only once published, so the Issue is linked to the
	// repository's release Issue as a blocker (`issue-release-cli.ts`).
	is_release: boolean
}

const OPTIONS = {
	'body-file': { type: 'string' },
	depth: { type: 'string' },
	route: { type: 'string' },
	label: { type: 'string', multiple: true },
	repo: { type: 'string' },
	distinct: { type: 'string', multiple: true },
	'over-cap': { type: 'boolean' },
	'no-auto-ok': { type: 'boolean' },
	requested: { type: 'boolean' },
	release: { type: 'boolean' },
} as const

// The label a `--depth` / `--route` value names, or `undefined` when it names none — read against the
// label sets `issue-labels.ts` defines, so the command cannot apply a depth or route nobody provisions.
function label_of(
	prefix: string,
	value: string | undefined,
	known: ReadonlyArray<string>,
): string | undefined {
	if (value === undefined) return undefined
	const label = value.startsWith(prefix) ? value : `${prefix}${value}`

	return known.includes(label) ? label : undefined
}

const ROUTE_NAMES: ReadonlyArray<string> = FILING_ROUTE_LABELS.map((label) => label.name)

// `--distinct 12,34 --distinct 56` → `[12, 34, 56]`; `undefined` when any entry is not an issue number,
// so a typo is refused rather than read as an acknowledgement of nothing.
function distinct_numbers(values: ReadonlyArray<string>): ReadonlyArray<number> | undefined {
	const numbers = values
		.flatMap((value) => value.split(LIST_SEPARATOR))
		.map((raw) => {
			return Number(raw.trim().replace('#', ''))
		})

	return numbers.every((number) => Number.isSafeInteger(number) && number > 0) ? numbers : undefined
}

type ParsedValues = ReturnType<typeof parseArgs<{ options: typeof OPTIONS }>>['values']

function route_of(values: ParsedValues): string | undefined | false {
	if (values.route === undefined) return undefined

	return label_of(ROUTE_PREFIX, values.route, ROUTE_NAMES) ?? false
}

function has_text(value: string | undefined): value is string {
	return value !== undefined && value.trim() !== ''
}

// The labelled half of the arguments, or `undefined` when a depth, route or `--distinct` entry is not
// one the command knows.
function labelled_of(
	values: ParsedValues,
): Pick<FileArguments, 'depth' | 'route' | 'distinct'> | undefined {
	const depth = label_of(DEPTH_PREFIX, values.depth, DEPTH_LABEL_ORDER)
	const route = route_of(values)
	const distinct = distinct_numbers(values.distinct ?? [])

	if (route === false || depth === undefined || distinct === undefined) return undefined

	return { depth, route, distinct }
}

function arguments_of(values: ParsedValues, title: string | undefined): FileArguments | undefined {
	const labelled = labelled_of(values)
	const body_file = values['body-file']

	if (labelled === undefined || !has_text(title) || !has_text(body_file)) return undefined

	return {
		title,
		body_file,
		...labelled,
		labels: values.label ?? [],
		repo: values.repo,
		is_over_cap: values['over-cap'] === true,
		is_auto_ok_opted_out: values['no-auto-ok'] === true,
		is_requested: values.requested === true,
		is_release: values.release === true,
	}
}

// An unknown flag is `undefined` rather than a throw, so the answer is the usage line, not a stack trace.
function parse(argv: ReadonlyArray<string>): FileArguments | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	return parsed === undefined ? undefined : arguments_of(parsed.values, parsed.positionals[0])
}

// A classification label is the body's to declare, so an extra `--label` naming one the body does not
// declare is dropped rather than applied — the label then always matches what `issue:lint` reads.
function is_undeclared_classification(label: string, body: string): boolean {
	const is_classification = has_label_name(issue_classification.CLASSIFICATION_LABELS, label)

	return is_classification && !has_label_name(issue_classification.required_labels(body), label)
}

// Every label the filing carries: the depth, the route when there is one, the classification labels
// the body declares (`issue_classification.labels_for`, which merges case-insensitively), then any
// extra `--label`, then `auto-ok` when the filing opted in (`issue-auto-ok.ts`) and no `--label`
// already named it. One request applies them all, so no label is a separate step to forget.
function labels_of(args: FileArguments, body: string, is_auto_ok = false): ReadonlyArray<string> {
	const extra = args.labels.filter((label) => !is_undeclared_classification(label, body))
	const declared = [args.depth, ...(args.route === undefined ? [] : [args.route]), ...extra]
	const labels = issue_classification.labels_for(body, declared)

	if (!is_auto_ok || has_label_name(labels, AUTO_OK_LABEL)) return labels

	return [...labels, AUTO_OK_LABEL]
}

// Why an `auto-ok` filing with neither `run:lane` nor `run:solo` is refused, or `undefined` when it is
// not. The offer paths withhold every candidate while one opted-in Issue is
// untriaged, so a run's own filing without the judgement stopped every lane. No default is applied:
// `run:solo` is the answer that keeps a verification defect from running beside others, and only a
// reading of the Issue gives it (`backlogrun-lanes.md`).
function triage_problem(labels: ReadonlyArray<string>): string | undefined {
	const is_owed = has_label_name(labels, AUTO_OK_LABEL) && !epic_triage.has_triage_label(labels)

	if (!is_owed) return undefined

	return `an \`${AUTO_OK_LABEL}\` filing needs \`--label ${RUN_LANE_LABEL}\` or \`--label ${RUN_SOLO_LABEL}\` — \`${RUN_SOLO_LABEL}\` only for a defect in kit's own verification that makes unrelated PRs answer wrongly on main now (\`backlogrun-lanes.md\`), else \`${RUN_LANE_LABEL}\``
}

function is_same_repository(target: string, current: string): boolean {
	return target.toLowerCase() === current.toLowerCase()
}

// `owner/repo#N` or a github.com issue URL — the qualified forms the issue template's backlink section
// requires, never a bare `#N`, which resolves to whichever repository renders it. Read through the
// parsers that already know both forms rather than a third pattern.
function without_trailing_prose(text: string): string {
	let end = text.length

	while (end > 0 && !DIGIT.test(text.charAt(end - 1))) end -= 1

	return text.slice(0, end)
}

function is_qualified_reference(word: string): boolean {
	const bare = without_trailing_prose(word.replaceAll(CODE_SPAN, '').replace(LEADING_NON_WORD, ''))

	return (
		epic_issue.parse_epic_reference(bare)?.repo !== undefined ||
		github_issue_url.parse(bare) !== undefined
	)
}

function cites_origin(line: string): boolean {
	return line.split(WORD_SEPARATOR).some((word) => is_qualified_reference(word))
}

// Why a cross-repository filing is refused, or `undefined` when it is not refused. A filing into the
// session's own repository owes no `## Origin`; one into another repository owes the section with a
// qualified reference back to the Issue that found it (`issue-template.md`, the backlink section).
function origin_problem(body: string, target: string, current: string): string | undefined {
	if (is_same_repository(target, current)) return undefined
	const lines = markdown_section.section_lines(body, issue_backlinks.ORIGIN_HEADING)

	if (lines.some((line) => cites_origin(line))) return undefined

	return `filing into ${target} from ${current} needs a \`${issue_backlinks.ORIGIN_HEADING}\` section citing the originating Issue as \`owner/repo#N\` or its URL`
}

// The duplicate candidates the caller has not declared separate. The scan cannot tell a duplicate from
// a neighbor — that is a reading of each candidate (`issue-fold-existing.md`) — so the command holds
// the filing until every candidate it printed is named back with `--distinct`.
function unacknowledged(
	candidates: ReadonlyArray<number>,
	distinct: ReadonlyArray<number>,
): ReadonlyArray<number> {
	return candidates.filter((candidate) => !distinct.includes(candidate))
}

const issue_file = {
	parse,
	labels_of,
	origin_problem,
	triage_problem,
	unacknowledged,
	is_same_repository,
}

export type { FileArguments }
export { issue_file }
