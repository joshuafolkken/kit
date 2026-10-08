#!/usr/bin/env tsx
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { git_command } from '#scripts/git/git-command'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { file_reader } from '#scripts/lib/read-file'
import { line_targets } from '#scripts/lines/line-targets'
import { metrics_code_lines } from './metrics-code-lines'
import { metrics_logic, type Metrics, type ScriptFile } from './metrics-logic'
import { metrics_ratchet, type Baseline, type Verdict } from './metrics-ratchet'

// `josh metrics [--accept --reason "<why>"]` — the I/O around `metrics-logic.ts` and
// `metrics-ratchet.ts`: enumerate the files, count them, print the totals, and hold them to the
// baseline in the repository. It is a step of `josh gate` (joshuafolkken/kit#3408): a total that grew
// fails it, a total that shrank rewrites the baseline, and `--accept` raises the baseline to the
// current totals with the reason recorded beside them.
//
// **It is kit-only.** The rule documents and the guard commands it counts are kit's own; a consumer
// has no root `prompts/` to read, and the gate leaves the step out there.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh metrics [--accept --reason "<why>"]'
const ACCEPT_FLAG = '--accept'
const REASON_FLAG = '--reason'
const ACCEPT_ARGUMENT_COUNT = 3
const FAILURE_EXIT_CODE = 1
const BASELINE_PATH = '.josh/metrics-baseline.json'
const RESIDENT_RULES = 'CLAUDE.md'
const RULES_DIR = 'prompts'
const MARKDOWN_EXTENSION = '.md'
const ENCODING = 'utf8'
// `YYYY-MM-DD` — the first ten characters of an ISO timestamp.
const DATE_LENGTH = 10
// A total that shrank moves the baseline down with it, so the next growth is measured from there.
const SETTLED_NOTE: Record<'improved' | 'unchanged', string> = {
	improved: ` — a total shrank, so ${BASELINE_PATH} now records the current totals`,
	unchanged: '',
}

interface MetricsArguments {
	reason: string | undefined
}

// `undefined` on anything but no argument or the full accept form: an accept without a reason is the
// silent raise the ratchet exists to prevent, and a misspelled flag would run the check instead of
// the raise it asked for.
function accept_reason(argv: ReadonlyArray<string>): MetricsArguments | undefined {
	const [accept_flag, reason_flag, reason = ''] = argv
	const is_accept = accept_flag === ACCEPT_FLAG && reason_flag === REASON_FLAG

	return is_accept && reason.trim().length > 0 ? { reason: reason.trim() } : undefined
}

function parse_arguments(argv: ReadonlyArray<string>): MetricsArguments | undefined {
	if (argv.length === 0) return { reason: undefined }

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

function rule_paths(root: string): ReadonlyArray<string> {
	const prompts = readdirSync(path.join(root, RULES_DIR), { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(MARKDOWN_EXTENSION))
		.map((entry) => path.join(entry.parentPath, entry.name))

	return [path.join(root, RESIDENT_RULES), ...prompts]
}

async function measure(root: string): Promise<Metrics> {
	const scripts = metrics_logic.script_totals(await script_files(root))
	const rules = metrics_logic.rule_totals(rule_paths(root).map((file) => read_text(file)))

	return { scripts, rules, guards: metrics_logic.guard_count(Object.keys(COMMAND_MAP)) }
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

function check(root: string, metrics: Metrics): number {
	const baseline = read_baseline(root)

	if (baseline === undefined) return fail(`josh metrics: no readable baseline at ${BASELINE_PATH}`)

	return settle(root, metrics_ratchet.compare(baseline, metrics))
}

function accept(root: string, metrics: Metrics, reason: string): number {
	write_baseline(root, metrics_ratchet.accept(metrics, reason, today()))
	process.stdout.write(`josh metrics: baseline raised to the current totals — ${reason}\n`)

	return 0
}

async function run_metrics(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = parse_arguments(argv)

	if (parsed === undefined) return fail(USAGE)

	const root = await git_command.repository_root()
	const metrics = await measure(root)

	process.stdout.write(`${metrics_logic.render(metrics)}\n`)

	return parsed.reason === undefined ? check(root, metrics) : accept(root, metrics, parsed.reason)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_metrics(process.argv.slice(ARGV_OFFSET))
}

const metrics_command = {
	parse_arguments,
}

export { metrics_command }
