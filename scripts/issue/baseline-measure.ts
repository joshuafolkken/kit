import { markdown_section } from './markdown-section'

// A behavior-change Issue's baseline section is written as `command + value`, never prose, so that
// `pnpm josh measure:rerun` can re-run the command after merge and print a before/after pair
// (joshuafolkken/kit#2212). When the value has not moved, the premise the rule rested on is recorded
// as refuted in the observation ledger — reusing that append-only mechanism rather than a second one.

const BASELINE_HEADING = '## ベースライン'
// `- `<command>` → <value>` (an ASCII `->` is accepted for the arrow). Prose with no backticked
// command does not match, which is exactly how a natural-language measurement is rejected.
const BASELINE_LINE = /^-\s*`([^`]+)`\s*(?:→|->)\s*(\S.*)$/u
const VALUE_GROUP = 2

const LEDGER_KEY_PREFIX = '- k:'
const LEDGER_DEPTH = 'd1'
const FIELD_SEPARATOR = ' | '
// The ledger splits on ` | ` into exactly five fields, so free text may not carry that separator.
const FIELD_SEPARATOR_REPLACEMENT = ' ; '
const REMEASURE_COMMAND = 'pnpm josh measure:rerun'
const NON_SLUG_RUN = /[^a-z0-9]+/gu
// The key when a command has no alphanumerics to slug (e.g. an all-symbol shell expression); without it
// the ledger key would be empty and the appended line would fail the ledger's own slug grammar.
const EMPTY_SLUG_FALLBACK = 'baseline'

interface Baseline {
	command: string
	value: string
}

function normalize(value: string): string {
	return value.trim()
}

// Every `command + value` line under the baseline section; an empty array is a section written in
// prose, which is the case the lint rejects.
function parse_baselines(body: string): ReadonlyArray<Baseline> {
	return markdown_section
		.section_lines(body, BASELINE_HEADING)
		.map((line) => BASELINE_LINE.exec(line.trim()))
		.filter((match): match is RegExpExecArray => match !== null)
		.map((match) => ({ command: match[1] ?? '', value: normalize(match[VALUE_GROUP] ?? '') }))
}

// A body carries a re-runnable baseline when at least one line parses to `command + value`.
function has_command_value(body: string): boolean {
	return parse_baselines(body).length > 0
}

// The value did not move between the recorded baseline and the re-measurement.
function is_no_change(before: string, after: string): boolean {
	return normalize(before) === normalize(after)
}

// The before/after pair for one baseline, printed under the command it was measured with.
function format_pair(baseline: Baseline, after: string): string {
	return [
		`\`${baseline.command}\``,
		`  before: ${normalize(baseline.value)}`,
		`  after:  ${normalize(after)}`,
	].join('\n')
}

function sanitize_field(text: string): string {
	return text.split(FIELD_SEPARATOR).join(FIELD_SEPARATOR_REPLACEMENT).trim()
}

// `NON_SLUG_RUN` collapses every non-alphanumeric run to a single `-`, so the only empty segments a
// split can produce are the leading and trailing ones; dropping them trims the edge dashes without a
// second anchored regex.
function slug_of(command: string): string {
	const runs = command.toLowerCase().replaceAll(NON_SLUG_RUN, '-').split('-')
	const slug = runs.filter(Boolean).join('-')

	return slug === '' ? EMPTY_SLUG_FALLBACK : slug
}

// The observation-ledger line for a refuted premise, in the grammar
// `- k:<slug> | d1 | <date> | <where> | <what>` (`observation-ledger-line.ts`). The key is derived
// from the command, so a second refutation of the same measurement appends a same-key line and the
// existing reappearance count sees it.
function ledger_line(baseline: Baseline, date: string): string {
	const what = sanitize_field(
		`反証: ${baseline.command} は before/after とも ${normalize(baseline.value)}（変化なし）`,
	)

	return [
		`${LEDGER_KEY_PREFIX}${slug_of(baseline.command)}`,
		LEDGER_DEPTH,
		date,
		REMEASURE_COMMAND,
		what,
	].join(FIELD_SEPARATOR)
}

const baseline_measure = {
	parse_baselines,
	has_command_value,
	is_no_change,
	format_pair,
	ledger_line,
	slug_of,
}

export type { Baseline }
export { baseline_measure }
