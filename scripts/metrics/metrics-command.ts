#!/usr/bin/env tsx
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { git_command } from '#scripts/git/git-command'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { line_budget, type FileBudget, type LineBudget } from '#scripts/lines/line-budget'
import { line_targets } from '#scripts/lines/line-targets'
import { metrics_logic, type Metrics, type ScriptFile } from './metrics-logic'

// `josh metrics [--write-baseline]` — the I/O around `metrics-logic.ts`: enumerate the files, read
// the code-line counts from `line_budget`, print the totals, and with `--write-baseline` record them
// in the repository. Comparing against the baseline is a later step.
//
// **It is kit-only.** The rule documents and the guard commands it counts are kit's own; a consumer
// has no root `prompts/` to read.
//
// **It reports and never fails on a large total**, as `josh lines` does; a non-zero exit means the
// arguments were unusable.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh metrics [--write-baseline]'
const WRITE_BASELINE_FLAG = '--write-baseline'
const FAILURE_EXIT_CODE = 1
const BASELINE_PATH = '.josh/metrics-baseline.json'
const RESIDENT_RULES = 'CLAUDE.md'
const RULES_DIR = 'prompts'
const MARKDOWN_EXTENSION = '.md'
const ENCODING = 'utf8'

// `undefined` on an unknown argument: a misspelled flag makes the invocation unreadable, and an
// unreadable invocation is refused rather than answered without the write it asked for.
function parse_write_baseline(argv: ReadonlyArray<string>): boolean | undefined {
	if (argv.some((argument) => argument !== WRITE_BASELINE_FLAG)) return undefined

	return argv.includes(WRITE_BASELINE_FLAG)
}

function read_text(file_path: string): string {
	return readFileSync(file_path, ENCODING)
}

// A file eslint sets no `max-lines` on has no code-line count to add, so it is left out of every total
// rather than counted as zero code lines.
function is_counted(entry: FileBudget): entry is FileBudget & { budget: LineBudget } {
	return entry.budget !== undefined
}

async function script_files(root: string): Promise<ReadonlyArray<ScriptFile>> {
	const targets = await line_targets.lint_target_files(root)
	const measured = targets.filter((target) =>
		metrics_logic.is_measured_script(path.relative(root, target).split(path.sep).join('/')),
	)
	const budgets = await line_budget.budgets_for(measured, root)

	return budgets
		.filter((entry) => is_counted(entry))
		.map((entry) => ({
			text: read_text(entry.file_path),
			code_lines: entry.budget.code_lines,
		}))
}

function write_baseline(root: string, metrics: Metrics): void {
	writeFileSync(path.join(root, BASELINE_PATH), metrics_logic.baseline_text(metrics))
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

async function run_metrics(argv: ReadonlyArray<string>): Promise<number> {
	const should_write = parse_write_baseline(argv)

	if (should_write === undefined) {
		process.stderr.write(`${USAGE}\n`)

		return FAILURE_EXIT_CODE
	}

	const root = await git_command.repository_root()
	const metrics = await measure(root)

	process.stdout.write(`${metrics_logic.render(metrics)}\n`)

	if (should_write) write_baseline(root, metrics)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_metrics(process.argv.slice(ARGV_OFFSET))
}

const metrics_command = {
	parse_write_baseline,
}

export { metrics_command }
