#!/usr/bin/env tsx
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { skill_meta } from '#scripts/claude/skill-meta'
import { gate_own_write } from '#scripts/gate/gate-own-write'
import { git_command } from '#scripts/git/git-command'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { file_reader } from '#scripts/lib/read-file'
import { line_targets } from '#scripts/lines/line-targets'
import { metrics_code_lines } from './metrics-code-lines'
import { metrics_duration_probe } from './metrics-duration-probe'
import { metrics_durations, type Durations } from './metrics-durations'
import { metrics_logic, type AiCostTotals, type Metrics, type ScriptFile } from './metrics-logic'
import { metrics_ratchet, type Baseline, type Verdict } from './metrics-ratchet'

// `josh metrics [--accept --reason "<why>"]` — the I/O around `metrics-logic.ts` and
// `metrics-ratchet.ts`: enumerate the files, count them, print the totals, and hold them to the
// baseline in the repository. It is a step of `josh gate`: a total that grew
// fails it, a total that shrank rewrites the baseline, and `--accept` raises the baseline to the
// current totals with the reason recorded beside them. The durations beside the totals are held to
// this machine's own baseline, with a tolerance (`metrics-durations.ts`).
//
// **It is kit-only.** The rule documents and the guard commands it counts are kit's own; a consumer
// has no root `prompts/` to read, and the gate leaves the step out there.
//
// `--totals-only` is the form a detached `josh ship` runs before the hand-off:
// the totals alone, so a grown total stops the session that knows why it grew. The durations stay with
// the supervised gate — before the detach the gate ledger they read is stale.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh metrics [--no-startup | --totals-only | --accept --reason "<why>"]'
const ACCEPT_FLAG = '--accept'
const REASON_FLAG = '--reason'
const ACCEPT_ARGUMENT_COUNT = 3
const FAILURE_EXIT_CODE = 1
const { BASELINE_PATH } = gate_own_write
const RESIDENT_RULES = 'CLAUDE.md'
// The instruction files an agent loads at the start of every session — Claude Code, Codex, Gemini.
const RESIDENT_DOCUMENTS: ReadonlyArray<string> = [RESIDENT_RULES, 'AGENTS.md', 'GEMINI.md']
const RULES_DIR = 'prompts'
const MARKDOWN_EXTENSION = '.md'
const ENCODING = 'utf8'
// `YYYY-MM-DD` — the first ten characters of an ISO timestamp.
const DATE_LENGTH = 10
// A total that shrank moves the baseline down with it, so the next growth is measured from there.
const SETTLED_NOTE: Record<'improved' | 'unchanged', string> = {
	improved: ` — ${gate_own_write.SHRUNK_NOTE}`,
	unchanged: '',
}

interface MetricsArguments {
	reason: string | undefined
	is_startup_timed: boolean
	is_totals_only: boolean
}

// The check forms, keyed by their joined argv. The gate's `--no-startup` runs beside the whole unit
// suite, so a startup timed there measures the load, not josh — startups are
// timed only when `josh metrics` runs alone.
const CHECK_FORMS: ReadonlyMap<string, MetricsArguments> = new Map([
	['', { reason: undefined, is_startup_timed: true, is_totals_only: false }],
	['--no-startup', { reason: undefined, is_startup_timed: false, is_totals_only: false }],
	['--totals-only', { reason: undefined, is_startup_timed: false, is_totals_only: true }],
])

// `undefined` on anything but no argument, the gate's form or the full accept form: an accept without
// a reason is the silent raise the ratchet exists to prevent, and a misspelled flag would run the
// check instead of the raise it asked for.
function accept_reason(argv: ReadonlyArray<string>): MetricsArguments | undefined {
	const [accept_flag, reason_flag, reason = ''] = argv
	const is_accept = accept_flag === ACCEPT_FLAG && reason_flag === REASON_FLAG

	return is_accept && reason.trim().length > 0
		? { reason: reason.trim(), is_startup_timed: true, is_totals_only: false }
		: undefined
}

function parse_arguments(argv: ReadonlyArray<string>): MetricsArguments | undefined {
	const form = CHECK_FORMS.get(argv.join(' '))

	if (form !== undefined) return form

	return argv.length === ACCEPT_ARGUMENT_COUNT ? accept_reason(argv) : undefined
}

function read_text(file_path: string): string {
	return readFileSync(file_path, ENCODING)
}

async function script_files(root: string): Promise<ReadonlyArray<ScriptFile>> {
	const targets = await line_targets.lint_target_files(root)
	const measured = targets.filter((target) =>
		metrics_logic.is_measured_script(path.relative(root, target).split(path.sep).join('/')),
	)
	const counts = await metrics_code_lines.code_line_counts(measured, root)

	return [...counts].map(([file_path, code_lines]) => ({ text: read_text(file_path), code_lines }))
}

// A directory the tree does not hold yields nothing: the gate's kit fixture carries no skills.
function markdown_paths(directory: string): ReadonlyArray<string> {
	if (!existsSync(directory)) return []

	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(MARKDOWN_EXTENSION))
		.map((entry) => path.join(entry.parentPath, entry.name))
}

function read_texts(paths: ReadonlyArray<string>): ReadonlyArray<string> {
	return paths.flatMap((file) => file_reader.read_if_readable(file) ?? [])
}

function skill_descriptions(skill_documents: ReadonlyArray<string>): ReadonlyArray<string> {
	const entries = skill_documents.filter(
		(file) => path.basename(file) === skill_meta.SKILL_ENTRY_FILE,
	)

	return read_texts(entries).map((text) => skill_meta.description_of(text))
}

function ai_cost(root: string, prompts: ReadonlyArray<string>): AiCostTotals {
	const documents = read_texts(RESIDENT_DOCUMENTS.map((file) => path.join(root, file)))
	const skill_documents = markdown_paths(path.join(root, skill_meta.SKILL_ROOT))

	return metrics_logic.ai_cost_totals(
		[...documents, ...skill_descriptions(skill_documents)],
		read_texts([...prompts, ...skill_documents]),
	)
}

async function measure(root: string): Promise<Metrics> {
	const scripts = metrics_logic.script_totals(await script_files(root))
	const prompts = markdown_paths(path.join(root, RULES_DIR))
	const rule_texts = read_texts([path.join(root, RESIDENT_RULES), ...prompts])
	const guards = metrics_logic.guard_count(Object.keys(COMMAND_MAP))

	return {
		scripts,
		rules: metrics_logic.rule_totals(rule_texts),
		guards,
		ai_cost: ai_cost(root, prompts),
	}
}

function write_baseline(root: string, baseline: Baseline): void {
	writeFileSync(path.join(root, BASELINE_PATH), metrics_logic.baseline_text(baseline))
}

function read_baseline(root: string): Baseline | undefined {
	const text = file_reader.read_if_readable(path.join(root, BASELINE_PATH))

	return text === undefined ? undefined : metrics_ratchet.parse_baseline(text)
}

function today(): string {
	return new Date().toISOString().slice(0, DATE_LENGTH)
}

function fail(message: string): number {
	process.stderr.write(`${message}\n`)

	return FAILURE_EXIT_CODE
}

function settle(root: string, verdict: Verdict): number {
	if (verdict.kind === 'regressed') {
		return fail(metrics_ratchet.render_regressions(verdict.regressions, BASELINE_PATH))
	}

	if (verdict.kind === 'improved') write_baseline(root, verdict.baseline)

	process.stdout.write(
		`josh metrics: no total grew past the baseline${SETTLED_NOTE[verdict.kind]}\n`,
	)

	return 0
}

function check_totals(root: string, metrics: Metrics): number {
	const baseline = read_baseline(root)

	if (baseline === undefined) return fail(`josh metrics: no readable baseline at ${BASELINE_PATH}`)

	return settle(root, metrics_ratchet.compare(baseline, metrics))
}

function check_totals_only(root: string, metrics: Metrics): number {
	process.stdout.write(`${metrics_logic.render(metrics)}\n`)

	return check_totals(root, metrics)
}

// Both halves always run, so one failing gate names every total and every duration that grew.
async function check(root: string, metrics: Metrics, durations: Durations): Promise<number> {
	const totals_exit = check_totals(root, metrics)
	const durations_file = await metrics_duration_probe.baseline_path()
	const durations_exit =
		durations_file === undefined ? 0 : metrics_duration_probe.check(durations_file, durations)

	return Math.max(totals_exit, durations_exit)
}

async function accept(
	root: string,
	metrics: Metrics,
	durations: Durations,
	reason: string,
): Promise<number> {
	const durations_file = await metrics_duration_probe.baseline_path()

	write_baseline(root, metrics_ratchet.accept(metrics, reason, today()))
	if (durations_file !== undefined) metrics_duration_probe.accept(durations_file, durations)
	process.stdout.write(`josh metrics: baseline raised to the current totals — ${reason}\n`)

	return 0
}

async function run_metrics(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = parse_arguments(argv)

	if (parsed === undefined) return fail(USAGE)

	const root = await git_command.repository_root()
	const metrics = await measure(root)

	if (parsed.is_totals_only) return check_totals_only(root, metrics)

	const durations = await metrics_duration_probe.measure(root, parsed.is_startup_timed)

	const shown = metrics_durations.render(durations, parsed.is_startup_timed)

	process.stdout.write(`${metrics_logic.render(metrics)}\n${shown}\n`)

	if (parsed.reason === undefined) return await check(root, metrics, durations)

	return await accept(root, metrics, durations, parsed.reason)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_metrics(process.argv.slice(ARGV_OFFSET))
}

const metrics_command = {
	parse_arguments,
}

export { metrics_command }
