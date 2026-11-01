#!/usr/bin/env tsx
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	LINT_RULE_CACHE_FILE,
	LINT_RULE_CACHE_FLAGS,
	LINT_RULE_DIRECTORY,
	LINT_RULE_PATHS_CACHE_FILE,
	LINT_RULE_PATHS_CACHE_FLAGS,
	LINT_RULE_WORKERS,
} from '#scripts/josh/josh-command-types'
import { FAIL_EXIT_CODE, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import { lint_parallel } from './lint-parallel'

// `josh lint:rule` — one eslint rule, or a temporary config, over the whole repository in one run
// whose violations stay in a file. Checking a new rule against existing code was a hand-typed serial
// whole-tree eslint, repeated for each output format because nothing kept the answer
// (joshuafolkken/kit#5664). It goes through the gate lint's own eslint path (`lint-parallel.ts`), on a
// cache of its own, so a repeat of the same rule re-lints only what moved.
//
// **It reports and never fails on a violation.** Counting violations is the question, so a non-zero
// exit means eslint could not answer — an unknown rule, an unreadable config — never that it found some.
//
// **`--paths` lints only the paths it names**, so checking a rule while fixing it costs seconds, not a
// whole-tree run each time (joshuafolkken/kit#5692). It keeps a cache, report and JSON of its own, so
// the whole run's stay as they were.

const ARGV_START = 2
// eslint's exit for a configuration or internal error; 1 only means problems were found.
const ESLINT_FATAL_EXIT_CODE = 2
const PATHS_FLAG = '--paths'
const USAGE =
	'lint:rule: usage: lint:rule <rule> [--config <path>] [--output <path>] [--paths <path>...]'

type OptionKey = 'config' | 'output'

const OPTION_KEYS: Readonly<Partial<Record<string, OptionKey>>> = {
	'--config': 'config',
	'--output': 'output',
}

interface ParsedOptions {
	config?: string | undefined
	output?: string | undefined
	paths?: ReadonlyArray<string> | undefined
}

interface LintRuleOptions extends ParsedOptions {
	rule: string
}

interface LintScope {
	targets: ReadonlyArray<string>
	cache_file: string
	cache_flags: ReadonlyArray<string>
	suffix: string
}

const WHOLE_TREE: LintScope = {
	targets: ['.'],
	cache_file: LINT_RULE_CACHE_FILE,
	cache_flags: LINT_RULE_CACHE_FLAGS,
	suffix: '',
}

interface Violation {
	file: string
	line: number
	column: number
	message: string
}

interface RuleMessage {
	line: number
	column: number
	message: string
}

// Each flag with the values that follow it, so `--paths` takes every path a shell glob expands to.
function option_groups(rest: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> {
	const groups: Array<Array<string>> = []

	for (const token of rest) {
		const current = groups.at(-1)
		if (current === undefined || token.startsWith('-')) groups.push([token])
		else current.push(token)
	}

	return groups
}

function add_paths(options: ParsedOptions, values: ReadonlyArray<string>): boolean {
	if (values.length === 0) return false
	options.paths = [...(options.paths ?? []), ...values]

	return true
}

// `--config` and `--output` take exactly one value.
function set_option(options: ParsedOptions, flag: string, values: ReadonlyArray<string>): boolean {
	const key = OPTION_KEYS[flag]
	const [value, ...extra] = values
	if (key === undefined || value === undefined || extra.length > 0) return false
	options[key] = value

	return true
}

function apply_group(options: ParsedOptions, group: ReadonlyArray<string>): boolean {
	const [flag = '', ...values] = group

	return flag === PATHS_FLAG ? add_paths(options, values) : set_option(options, flag, values)
}

function parse_options(rest: ReadonlyArray<string>): ParsedOptions | undefined {
	const options: ParsedOptions = {}
	const is_applied = option_groups(rest).every((group) => apply_group(options, group))

	return is_applied ? options : undefined
}

function parse_arguments(command_arguments: ReadonlyArray<string>): LintRuleOptions | undefined {
	const [rule, ...rest] = command_arguments
	if (rule === undefined || rule.startsWith('-')) return undefined
	const options = parse_options(rest)

	return options === undefined ? undefined : { rule, ...options }
}

function lint_scope(options: LintRuleOptions): LintScope {
	const { paths } = options
	if (paths === undefined) return WHOLE_TREE

	return {
		targets: paths,
		cache_file: LINT_RULE_PATHS_CACHE_FILE,
		cache_flags: LINT_RULE_PATHS_CACHE_FLAGS,
		suffix: '.paths',
	}
}

function report_name(options: LintRuleOptions): string {
	return `${options.rule.replaceAll('/', '-')}${lint_scope(options).suffix}`
}

function default_output(options: LintRuleOptions): string {
	return `${LINT_RULE_DIRECTORY}/${report_name(options)}.txt`
}

function json_file_for(options: LintRuleOptions, root: string): string {
	return path.resolve(root, LINT_RULE_DIRECTORY, `${report_name(options)}.json`)
}

// The configured rule set plus the rule at `error`: a severity-only override keeps the options the
// config gives it, and a rule the config turns off is turned on.
function eslint_arguments(options: LintRuleOptions, json_file: string): ReadonlyArray<string> {
	const config = options.config === undefined ? [] : ['--config', options.config]
	const { targets, cache_flags } = lint_scope(options)

	return [
		'exec',
		'eslint',
		...targets,
		'--concurrency',
		String(LINT_RULE_WORKERS),
		'--rule',
		JSON.stringify({ [options.rule]: 'error' }),
		'--format',
		'json',
		'--output-file',
		json_file,
		...config,
		...cache_flags,
	]
}

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function as_array(value: unknown): ReadonlyArray<unknown> {
	return Array.isArray(value) ? value : []
}

function is_rule_message(value: unknown, rule: string): value is RuleMessage {
	return (
		is_record(value) &&
		value['ruleId'] === rule &&
		typeof value['line'] === 'number' &&
		typeof value['column'] === 'number' &&
		typeof value['message'] === 'string'
	)
}

function file_violations(entry: unknown, rule: string, root: string): ReadonlyArray<Violation> {
	if (!is_record(entry) || typeof entry['filePath'] !== 'string') return []
	const file = path.relative(root, entry['filePath'])
	const messages = as_array(entry['messages']).filter((message) => is_rule_message(message, rule))

	return messages.map((message) => ({ file, ...message }))
}

// `undefined` when eslint left no readable report, the one case the run could not answer.
function read_violations(
	json_file: string,
	rule: string,
	root: string,
): ReadonlyArray<Violation> | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(json_file, 'utf8'))
		if (!Array.isArray(parsed)) return undefined

		return parsed.flatMap((entry: unknown) => file_violations(entry, rule, root))
	} catch {
		return undefined
	}
}

function report_text(violations: ReadonlyArray<Violation>): string {
	return violations
		.map(
			({ file, line, column, message }) =>
				`${file}:${String(line)}:${String(column)}  ${message}\n`,
		)
		.join('')
}

function summary_line(rule: string, violations: ReadonlyArray<Violation>, output: string): string {
	const files = new Set(violations.map((violation) => violation.file)).size
	const counts = `${String(violations.length)} violations in ${String(files)} files`

	return `lint:rule ${rule} — ${counts} → ${output}\n`
}

function failed(result: BufferedProcessResult): number {
	process.stderr.write(`${result.output}\nlint:rule: eslint left no readable report\n`)

	return FAIL_EXIT_CODE
}

async function run_eslint_report(
	options: LintRuleOptions,
	json_file: string,
): Promise<BufferedProcessResult> {
	mkdirSync(path.dirname(json_file), { recursive: true })
	// A report left by an earlier run must never be read as this one's.
	rmSync(json_file, { force: true })

	return await lint_parallel.run_eslint({
		args: eslint_arguments(options, json_file),
		cache_file: lint_scope(options).cache_file,
		warm_daemon: false,
	})
}

function write_report(output_file: string, violations: ReadonlyArray<Violation>): void {
	mkdirSync(path.dirname(output_file), { recursive: true })
	writeFileSync(output_file, report_text(violations))
}

async function run_parsed(options: LintRuleOptions, root: string): Promise<number> {
	const json_file = json_file_for(options, root)
	const result = await run_eslint_report(options, json_file)
	const violations = read_violations(json_file, options.rule, root)
	if (violations === undefined || result.exit_code === ESLINT_FATAL_EXIT_CODE) return failed(result)
	const output = options.output ?? default_output(options)

	write_report(path.resolve(root, output), violations)
	process.stdout.write(summary_line(options.rule, violations, output))

	return 0
}

async function run_lint_rule(
	command_arguments: ReadonlyArray<string>,
	root: string = process.cwd(),
): Promise<number> {
	const options = parse_arguments(command_arguments)
	if (options !== undefined) return await run_parsed(options, root)

	process.stderr.write(`${USAGE}\n`)

	return FAIL_EXIT_CODE
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_lint_rule(process.argv.slice(ARGV_START))
}

const lint_rule = { eslint_arguments, parse_arguments, run_lint_rule }

export { lint_rule }
