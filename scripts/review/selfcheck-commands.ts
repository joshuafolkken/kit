import path from 'node:path'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { test_declared_logic } from '#scripts/test/test-declared-logic'
import type { Hunk } from '#scripts/test/test-pinned-logic'

// The self-check's "Commands your prose tells a reader to run are run" (`prompts/review.md`) as one
// pass (joshuafolkken/kit#5540): each backticked `pnpm josh …` an added line writes, run in a scratch
// tree from the root, from a subdirectory, with its path arguments absolute, and with its positional
// arguments empty. **Only a command whose registry side effects are `none` or `files` runs in the tree**
// (`none`, `files`); one that touches git refs, the network, processes or a release is listed as
// skipped, since a worktree copy shares its refs and remote with the lane. The tree is the caller's —
// `selfcheck-cli.ts` builds it — so nothing here can reach the lane's files.

interface Probe {
	label: string
	cwd: string
	args: ReadonlyArray<string>
	// An empty-input probe passes on any clean exit: a usage refusal is the right answer to it.
	is_empty_input: boolean
}

interface ProbeResult {
	exit_code: number | undefined
	output: string
}

interface Runner {
	tree: string
	is_path: (argument: string) => boolean
	exec: (args: ReadonlyArray<string>, cwd: string) => Promise<ProbeResult>
}

interface CommandsReport {
	lines: ReadonlyArray<string>
	failed: number
}

const SPAN = /`pnpm josh ([^`]+)`/gu
// A placeholder or shell syntax the reader fills in: `<N>`, `[--flag]`, `${x}`, `a | b`, an ellipsis.
const PLACEHOLDER = /[<>[\]{}$|…]|\.\.\./u
const WORD = /"[^"]*"|'[^']*'|\S+/gu
const QUOTES = /^["']|["']$/gu
// A Node stack frame line: an uncaught throw, where a refusal would have printed its own line.
const STACK_FRAME = /\n {4}at /u
const RUNNABLE_EFFECTS: ReadonlySet<string> = new Set(['none', 'files'])
// The registry reference's third field: `[synopsis, audience, side_effects]`.
const SIDE_EFFECTS = 2
const SUBDIRECTORY = 'scripts'
const FLAG_PREFIX = '-'
const EMPTY_ARGUMENT = ''
const FAIL_PREFIX = 'fail'

// A test's `pnpm josh …` is a fixture string, not an instruction to a reader.
function extract(hunks: ReadonlyArray<Hunk>): Array<string> {
	const read = hunks.filter((hunk) => !test_declared_logic.is_test_file(hunk.file))
	const added = read.flatMap((hunk) => hunk.new_lines ?? [])
	const spans = added.flatMap((line) => [...line.matchAll(SPAN)].map((match) => match[1] ?? ''))
	const unique = new Set(spans.map((span) => span.trim()))

	return [...unique].filter((span) => span !== '' && !PLACEHOLDER.test(span))
}

function tokenize(command: string): Array<string> {
	return [...command.matchAll(WORD)].map((match) => match[0].replaceAll(QUOTES, ''))
}

// The side effects that keep a command out of the scratch tree; `undefined` for an unknown command.
function blocking_effects(name: string): Array<string> | undefined {
	const command = Object.hasOwn(COMMAND_MAP, name) ? COMMAND_MAP[name] : undefined

	if (command === undefined) return undefined

	return command.reference[SIDE_EFFECTS].filter((effect) => !RUNNABLE_EFFECTS.has(effect))
}

function is_flag(argument: string): boolean {
	return argument.startsWith(FLAG_PREFIX)
}

// No cwd-relative probe: `pnpm josh` runs from the package root, so a path resolves from there
// wherever it is typed — the subdirectory probe already runs the root-relative form.
function absolute_probe(name: string, args: ReadonlyArray<string>, runner: Runner): Probe {
	const { tree, is_path } = runner
	const absolute = args.map((argument) =>
		is_path(argument) ? path.join(tree, argument) : argument,
	)

	return {
		label: 'absolute path',
		cwd: path.join(tree, SUBDIRECTORY),
		args: [name, ...absolute],
		is_empty_input: false,
	}
}

function empty_probe(name: string, args: ReadonlyArray<string>, tree: string): Array<Probe> {
	if (args.every((argument) => is_flag(argument))) return []

	const emptied = args.map((argument) => (is_flag(argument) ? argument : EMPTY_ARGUMENT))

	return [{ label: 'empty input', cwd: tree, args: [name, ...emptied], is_empty_input: true }]
}

// Every probe one command earns; the absolute one only when an argument names a file in the tree.
function probes(tokens: ReadonlyArray<string>, runner: Runner): Array<Probe> {
	const [name = '', ...args] = tokens
	const has_path = args.some((argument) => runner.is_path(argument))
	const subdirectory = path.join(runner.tree, SUBDIRECTORY)

	return [
		{ label: 'root', cwd: runner.tree, args: tokens, is_empty_input: false },
		{ label: 'subdirectory cwd', cwd: subdirectory, args: tokens, is_empty_input: false },
		...(has_path ? [absolute_probe(name, args, runner)] : []),
		...empty_probe(name, args, runner.tree),
	]
}

function is_failed(probe: Probe, result: ProbeResult): boolean {
	if (result.exit_code === undefined || STACK_FRAME.test(result.output)) return true

	return !probe.is_empty_input && result.exit_code !== 0
}

function failure_line(command: string, probe: Probe, result: ProbeResult): string {
	const last = result.output.trim().split('\n').at(-1)?.trim() ?? ''
	const exit = result.exit_code ?? 'signal'

	return `${FAIL_PREFIX} ${probe.label}: pnpm josh ${command} → exit ${String(exit)} — ${last}`
}

async function in_turn<T>(
	items: ReadonlyArray<T>,
	each: (item: T) => Promise<Array<string>>,
): Promise<Array<string>> {
	const lines: Array<string> = []

	for (const item of items) {
		// eslint-disable-next-line no-await-in-loop -- each probe is a `pnpm josh` start, and lanes share the machine
		lines.push(...(await each(item)))
	}

	return lines
}

async function probe_lines(command: string, runner: Runner): Promise<Array<string>> {
	return await in_turn(probes(tokenize(command), runner), async (probe) => {
		const result = await runner.exec(probe.args, probe.cwd)

		return is_failed(probe, result) ? [failure_line(command, probe, result)] : []
	})
}

async function command_lines(command: string, runner: Runner): Promise<Array<string>> {
	const blocking = blocking_effects(tokenize(command)[0] ?? '')

	if (blocking === undefined) return [`${FAIL_PREFIX}: pnpm josh ${command} → unknown command`]
	if (blocking.length > 0) return [`skipped: pnpm josh ${command} (${blocking.join(', ')})`]

	return await probe_lines(command, runner)
}

async function run(commands: ReadonlyArray<string>, runner: Runner): Promise<CommandsReport> {
	const lines = await in_turn(commands, async (command) => await command_lines(command, runner))

	return { lines, failed: lines.filter((line) => line.startsWith(FAIL_PREFIX)).length }
}

const selfcheck_commands = { extract, probes, run, tokenize }

export type { CommandsReport, ProbeResult, Runner }
export { selfcheck_commands }
