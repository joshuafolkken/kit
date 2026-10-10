#!/usr/bin/env tsx
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { skill_meta } from '#scripts/claude/skill-meta'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { file_reader } from '#scripts/lib/read-file'
import { line_targets } from '#scripts/lines/line-targets'
import { z } from 'zod'
import { metrics_base, type Reading } from './metrics-base'
import { metrics_code_lines } from './metrics-code-lines'
import { metrics_duration_probe } from './metrics-duration-probe'
import { metrics_durations, type Durations } from './metrics-durations'
import { metrics_logic, type AiCostTotals, type Metrics, type ScriptFile } from './metrics-logic'
import { metrics_ratchet, type Verdict } from './metrics-ratchet'

// `josh metrics [--accept --reason "<why>"]` — the I/O around `metrics-logic.ts` and
// `metrics-ratchet.ts`: enumerate the files, count them, print the totals, and hold them to the same
// totals measured on the merge-base (`metrics-base.ts`). It is a step of `josh gate`: a total that
// grew fails it, and `--accept` records the growth and its reason in the issue's own approval file.
// The durations beside the totals are held to this machine's own baseline, with a tolerance
// (`metrics-durations.ts`).
//
// **It is kit-only.** The rule documents and the guard commands it counts are kit's own; a consumer
// has no root `prompts/` to read, and the gate leaves the step out there.
//
// `--totals-only` is the form a detached `josh ship` runs before the hand-off:
// the totals alone, so a grown total stops the session that knows why it grew. The durations stay with
// the supervised gate — before the detach the gate ledger they read is stale.
//
// `--json` is the form this command runs on the merge-base's tree: the totals alone, as JSON, held
// to nothing.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh metrics [--no-startup | --totals-only | --accept --reason "<why>"]'
const ACCEPT_FLAG = '--accept'
const REASON_FLAG = '--reason'
const ACCEPT_ARGUMENT_COUNT = 3
const FAILURE_EXIT_CODE = 1
// Read off the measured tree rather than imported: the merge-base's guards are the ones its own
// command map names, not the ones this checkout's does.
const COMMAND_MAP_FILE = 'scripts/josh/josh-command-map.ts'
const command_map_schema = z.object({ COMMAND_MAP: z.record(z.string(), z.unknown()) })
const RESIDENT_RULES = 'CLAUDE.md'
// The instruction files an agent loads at the start of every session — Claude Code, Codex, Gemini.
const RESIDENT_DOCUMENTS: ReadonlyArray<string> = [RESIDENT_RULES, 'AGENTS.md', 'GEMINI.md']
const RULES_DIR = 'prompts'
const MARKDOWN_EXTENSION = '.md'
const ENCODING = 'utf8'
// `YYYY-MM-DD` — the first ten characters of an ISO timestamp.
const DATE_LENGTH = 10
const NOT_GROWN = 'josh metrics: no total grew past the merge-base'
// Nothing records a total that shrank: once it merges, it is the merge-base the next branch is held to.
const SETTLED_LINE: Record<Exclude<Verdict['kind'], 'regressed'>, string> = {
	approved: 'josh metrics: every total that grew is within the approval this branch recorded',
	shrank: `${NOT_GROWN} — a total shrank, and the next branch is measured from it`,
	unchanged: NOT_GROWN,
}

type MetricsForm = 'full' | 'totals' | 'json'

interface GrowthToAccept {
	base: Metrics
	current: Metrics
	reason: string
}

interface MetricsArguments {
	reason: string | undefined
	is_startup_timed: boolean
	form: MetricsForm
}

// The check forms, keyed by their joined argv. The gate's `--no-startup` runs beside the whole unit
// suite, so a startup timed there measures the load, not josh — startups are
// timed only when `josh metrics` runs alone.
const CHECK_FORMS: ReadonlyMap<string, MetricsArguments> = new Map([
	['', { reason: undefined, is_startup_timed: true, form: 'full' }],
	['--no-startup', { reason: undefined, is_startup_timed: false, form: 'full' }],
	['--totals-only', { reason: undefined, is_startup_timed: false, form: 'totals' }],
	[metrics_base.JSON_FLAG, { reason: undefined, is_startup_timed: false, form: 'json' }],
])

// `undefined` on anything but no argument, the gate's form or the full accept form: an accept without
// a reason is the silent raise the ratchet exists to prevent, and a misspelled flag would run the
// check instead of the raise it asked for.
function accept_reason(argv: ReadonlyArray<string>): MetricsArguments | undefined {
	const [accept_flag, reason_flag, reason = ''] = argv
	const is_accept = accept_flag === ACCEPT_FLAG && reason_flag === REASON_FLAG

	return is_accept && reason.trim().length > 0
		? { reason: reason.trim(), is_startup_timed: true, form: 'full' }
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

// A tree that holds no command map names no guard: the gate's kit fixture carries no `scripts/`.
async function command_names(root: string): Promise<ReadonlyArray<string>> {
	const file = path.join(root, COMMAND_MAP_FILE)

	if (!existsSync(file)) return []

	const loaded: unknown = await import(pathToFileURL(file).href)

	return Object.keys(command_map_schema.parse(loaded).COMMAND_MAP)
}

async function measure(root: string): Promise<Metrics> {
	const scripts = metrics_logic.script_totals(await script_files(root))
	const prompts = markdown_paths(path.join(root, RULES_DIR))
	const rule_texts = read_texts([path.join(root, RESIDENT_RULES), ...prompts])
	const guards = metrics_logic.guard_count(await command_names(root))

	return {
		scripts,
		rules: metrics_logic.rule_totals(rule_texts),
		guards,
		ai_cost: ai_cost(root, prompts),
	}
}

function today(): string {
	return new Date().toISOString().slice(0, DATE_LENGTH)
}

function say(message: string): number {
	process.stdout.write(`${message}\n`)

	return 0
}

function fail(message: string): number {
	process.stderr.write(`${message}\n`)

	return FAILURE_EXIT_CODE
}

function settle(commit: string, verdict: Verdict): number {
	if (verdict.kind === 'regressed') {
		return fail(metrics_ratchet.render_regressions(verdict.regressions, commit))
	}

	return say(SETTLED_LINE[verdict.kind])
}

// No commit to measure from — not a repository, no default branch — holds the totals to nothing,
// the way every guard that asks for the merge-base fails open there. CI names its commit, and a name
// that does not resolve throws (`metrics-base.ts`).
async function check_totals(root: string, metrics: Metrics): Promise<number> {
	const commit = await metrics_base.resolve_commit()

	if (commit === undefined) return say('josh metrics: no merge-base, so no total is held to one')

	const current: Reading = { metrics, approvals: metrics_base.approval_texts(root) }
	const base = await metrics_base.read(commit, current)
	const approvals = metrics_ratchet.fresh_approvals(current.approvals, base.approvals)

	return settle(commit, metrics_ratchet.compare(base.metrics, metrics, approvals))
}

async function check_totals_only(root: string, metrics: Metrics): Promise<number> {
	process.stdout.write(`${metrics_logic.render(metrics)}\n`)

	return await check_totals(root, metrics)
}

// Both halves always run, so one failing gate names every total and every duration that grew.
async function check(root: string, metrics: Metrics, durations: Durations): Promise<number> {
	const totals_exit = await check_totals(root, metrics)
	const durations_file = await metrics_duration_probe.baseline_path()
	const durations_exit =
		durations_file === undefined ? 0 : metrics_duration_probe.check(durations_file, durations)

	return Math.max(totals_exit, durations_exit)
}

// The approval is the issue's own file, so a branch with growth to record has to name the issue — a
// file named for nothing would be the shared one every pull request rewrote. A branch with none to
// record is asked for no issue: an `--accept` there is the durations' alone, and it must not fail.
function record_growth(root: string, issue: number | undefined, growth: GrowthToAccept): number {
	const approval = metrics_ratchet.accept(growth.base, growth.current, growth.reason, today())

	if (approval === undefined) return say(`${NOT_GROWN} — there is no growth to record`)
	if (issue === undefined) return fail('josh metrics: this branch names no issue to record under')

	const file = metrics_base.write_approval(root, issue, approval)

	return say(`josh metrics: growth recorded in ${file} — ${growth.reason}`)
}

async function accept_totals(root: string, metrics: Metrics, reason: string): Promise<number> {
	const commit = await metrics_base.resolve_commit()

	if (commit === undefined) return fail('josh metrics: no merge-base to measure the growth from')

	const issue = git_branch.issue_from_branch(await git_command.branch())
	const current: Reading = { metrics, approvals: metrics_base.approval_texts(root) }
	const base = await metrics_base.read(commit, current)

	return record_growth(root, issue, { base: base.metrics, current: metrics, reason })
}

async function accept(
	root: string,
	metrics: Metrics,
	durations: Durations,
	reason: string,
): Promise<number> {
	const durations_file = await metrics_duration_probe.baseline_path()

	if (durations_file !== undefined) metrics_duration_probe.accept(durations_file, durations)

	return await accept_totals(root, metrics, reason)
}

async function run_full(root: string, metrics: Metrics, parsed: MetricsArguments): Promise<number> {
	const durations = await metrics_duration_probe.measure(root, parsed.is_startup_timed)
	const shown = metrics_durations.render(durations, parsed.is_startup_timed)

	process.stdout.write(`${metrics_logic.render(metrics)}\n${shown}\n`)

	if (parsed.reason === undefined) return await check(root, metrics, durations)

	return await accept(root, metrics, durations, parsed.reason)
}

async function run_metrics(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = parse_arguments(argv)

	if (parsed === undefined) return fail(USAGE)

	const root = await git_command.repository_root()
	const metrics = await measure(root)

	if (parsed.form === 'json') return say(JSON.stringify(metrics))
	if (parsed.form === 'totals') return await check_totals_only(root, metrics)

	return await run_full(root, metrics, parsed)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_metrics(process.argv.slice(ARGV_OFFSET))
}

const metrics_command = {
	parse_arguments,
}

export { metrics_command }
