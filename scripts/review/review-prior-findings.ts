import { agent_safe_text } from '#scripts/agent/agent-safe-text'
import type { StopFinding } from '#scripts/run/ship/run-ship-review'
import { review_stop_log, type StopLine } from './review-stop-log'

// The findings earlier review stops of the same lane recorded, carried into the fix of the next stop and
// into the next review (joshuafolkken/kit#4780): a fix that saw only the latest finding broke the
// constraint an earlier one set on the same line, and came back as a new Medium round after round.
//
// **The durable stop log is the source** — the one record that keeps a finding's `<file>[:<line>]` and
// its reason. A ship round that passed on fixes made in place is in it too, marked fixed, and so is an
// agent's own `review:record` round whose findings carry their reason (joshuafolkken/kit#4817). The
// ledger keeps only the file, so a finding recorded without a reason is not carried.

const PRIOR_LIMIT = 5
// Each entry is bounded, so five of them never push a reviewer prompt past `MAX_VALUE_LENGTH`.
const ENTRY_LENGTH_LIMIT = 400
const LINE_SUFFIX = /:\d.*$/u
const KEY_SEPARATOR = ' — '
const LINE_BREAKS = /[\n\r]+/gu

function file_of(location: string): string {
	return location.replace(LINE_SUFFIX, '')
}

function key_of(finding: Pick<StopFinding, 'location' | 'sentence'>): string {
	return `${finding.location}${KEY_SEPARATOR}${finding.sentence}`
}

// An entry is one line of a prompt, so it never carries a line break or a control character
// `is_safe_prompt` refuses. Its parenthetical holds no `; `, the separator the reviewer prompt joins
// entries with.
function entry_text(line: StopLine): string {
	const disposition = line.fixed === true ? 'fixed in place' : 'stopped'
	const text = `${key_of(line)} (${line.kind}, ${disposition} in the ${line.stage} stage)`

	return agent_safe_text.printable(text.replaceAll(LINE_BREAKS, ' ')).slice(0, ENTRY_LENGTH_LIMIT)
}

// The latest findings of the lane's issue that `is_kept` admits, oldest first.
function latest(
	issue: string,
	is_kept: (line: StopLine) => boolean,
	log_path?: string,
): ReadonlyArray<string> {
	return review_stop_log
		.read(log_path)
		.filter((line) => String(line.issue) === issue && is_kept(line))
		.slice(-PRIOR_LIMIT)
		.map((line) => entry_text(line))
}

// The earlier findings on a file the current stop cites, the current stop's own lines left out — the
// stop is recorded before it is handed back.
function on_files(
	issue: string,
	current: ReadonlyArray<StopFinding>,
	log_path?: string,
): ReadonlyArray<string> {
	const files = new Set(current.map((finding) => file_of(finding.location)))
	const own = new Set(current.map((finding) => key_of(finding)))

	return latest(
		issue,
		(line) => files.has(file_of(line.location)) && !own.has(key_of(line)),
		log_path,
	)
}

// The lines the stop context prints after the changed files; none when no earlier finding applies.
function fix_lines(entries: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
	if (entries === undefined || entries.length === 0) return []

	return [
		'Earlier review findings on the same files in this lane — confirm the fix still meets each before shipping again:',
		...entries.map((entry) => `- ${entry}`),
	]
}

// One sentence for a reviewer prompt, which stays one line; none when the lane has no earlier stop.
function prompt_clauses(issue: string, log_path?: string): ReadonlyArray<string> {
	const entries = latest(issue, () => true, log_path)

	if (entries.length === 0) return []

	return [
		`Earlier review rounds in this lane recorded these findings: ${entries.join('; ')}.`,
		'Check that the change still meets each of them, and report a change that breaks one as a finding.',
	]
}

const review_prior_findings = {
	ENTRY_LENGTH_LIMIT,
	PRIOR_LIMIT,
	fix_lines,
	latest,
	on_files,
	prompt_clauses,
}

export { review_prior_findings }
