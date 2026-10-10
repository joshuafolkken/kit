import { session_language_cli } from '#scripts/josh/session-language-cli'
import { test_declared_logic } from '#scripts/test/test-declared-logic'

// The pure half of `josh metrics`. ESLint and Sonar hold each function and file to an absolute limit, but nothing measures the repository-wide totals, so a slow growth in
// code, comments and rules shows up nowhere. These totals are the measurement that growth needs.
//
// **The code-line count is never computed here.** It is read off the project's own eslint
// `max-lines` rule with `skipBlankLines` and `skipComments` (`metrics-code-lines.ts`). A comment
// line is then every non-blank line eslint did not count as code — a line that holds code and a
// trailing comment is code, the same reading the rule makes.
//
// **AI cost is measured in bytes, as a stand-in for tokens**: the resident
// part is read on every session or turn, the on-demand part only when a run opens it.

const SCRIPTS_PREFIX = 'scripts/'
const GUARD_SUFFIX = ':guard'
const NEWLINE = '\n'
const RATIO_DIGITS = 2
const ENCODING = 'utf8'
// The `UserPromptSubmit` hook's line, in its default form — the same on every machine whatever its
// `.env` says. Empty, and kept so a default that prints again is counted.
const PER_TURN_HOOK_TEXT = session_language_cli.format_line({
	lang: session_language_cli.DEFAULT_SESSION_LANG,
	is_default: true,
})

interface ScriptFile {
	text: string
	code_lines: number
}

interface ScriptTotals {
	files: number
	code_lines: number
	comment_lines: number
	comment_ratio: number
}

interface RuleTotals {
	files: number
	lines: number
}

interface AiCostTotals {
	resident_bytes: number
	on_demand_bytes: number
}

interface Metrics {
	scripts: ScriptTotals
	rules: RuleTotals
	guards: number
	ai_cost: AiCostTotals
}

function is_measured_script(relative_path: string): boolean {
	if (!relative_path.startsWith(SCRIPTS_PREFIX)) return false

	return !test_declared_logic.is_test_file(relative_path)
}

function non_blank_lines(text: string): number {
	return text.split(NEWLINE).filter((line) => line.trim().length > 0).length
}

// Physical lines as `wc -l` counts them: a final newline closes the last line rather than opening one.
function physical_lines(text: string): number {
	if (text.length === 0) return 0

	const lines = text.split(NEWLINE).length

	return text.endsWith(NEWLINE) ? lines - 1 : lines
}

// Comment lines per code line, rounded for display and for a stable baseline value.
function comment_ratio(comment_lines: number, code_lines: number): number {
	if (code_lines === 0) return 0

	return Number((comment_lines / code_lines).toFixed(RATIO_DIGITS))
}

function script_totals(files: ReadonlyArray<ScriptFile>): ScriptTotals {
	const code_lines = files.reduce((sum, file) => sum + file.code_lines, 0)
	const non_blank = files.reduce((sum, file) => sum + non_blank_lines(file.text), 0)
	const comment_lines = non_blank - code_lines

	return {
		files: files.length,
		code_lines,
		comment_lines,
		comment_ratio: comment_ratio(comment_lines, code_lines),
	}
}

function rule_totals(texts: ReadonlyArray<string>): RuleTotals {
	return {
		files: texts.length,
		lines: texts.reduce((sum, text) => sum + physical_lines(text), 0),
	}
}

function guard_count(command_names: ReadonlyArray<string>): number {
	return command_names.filter((name) => name.endsWith(GUARD_SUFFIX)).length
}

function byte_total(texts: ReadonlyArray<string>): number {
	return texts.reduce((sum, text) => sum + Buffer.byteLength(text, ENCODING), 0)
}

// `resident` is the documents and skill descriptions loaded every session; the per-turn hook line is
// added here, so the command and a fixture baseline count it the same way.
function ai_cost_totals(
	resident: ReadonlyArray<string>,
	on_demand: ReadonlyArray<string>,
): AiCostTotals {
	return {
		resident_bytes: byte_total([...resident, PER_TURN_HOOK_TEXT]),
		on_demand_bytes: byte_total(on_demand),
	}
}

function render(metrics: Metrics): string {
	const { scripts, rules, ai_cost } = metrics

	return [
		`scripts  ${String(scripts.files)} files · ${String(scripts.code_lines)} code lines · ${String(scripts.comment_lines)} comment lines · comment ratio ${scripts.comment_ratio.toFixed(RATIO_DIGITS)}`,
		`rules    ${String(rules.files)} files · ${String(rules.lines)} lines`,
		`guards   ${String(metrics.guards)}`,
		`ai cost  ${String(ai_cost.resident_bytes)} resident bytes · ${String(ai_cost.on_demand_bytes)} on-demand bytes`,
	].join(NEWLINE)
}

const metrics_logic = {
	ai_cost_totals,
	guard_count,
	is_measured_script,
	physical_lines,
	render,
	rule_totals,
	script_totals,
}

export type { AiCostTotals, Metrics, RuleTotals, ScriptFile, ScriptTotals }
export { metrics_logic }
