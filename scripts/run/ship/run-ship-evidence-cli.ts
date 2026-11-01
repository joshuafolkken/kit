#!/usr/bin/env tsx
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { gate_tree } from '#scripts/gate/gate-tree'
import { tree_verdict } from '#scripts/gate/tree-verdict'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { stamp_file } from '#scripts/josh/stamp-file'
import { execa } from 'execa'
import { run_ship_body_draft } from './run-ship-body-draft'
import { run_ship_evidence } from './run-ship-evidence'

// `josh ship:evidence <N> -- <command...>` — run the command and append its invocation and output tail
// to the ship body draft's evidence section (`run-ship-evidence.ts`). It exits with the command's own
// code, so a command that failed is seen as one; its output is recorded either way, since a refusal
// can be the evidence.

const ARGV_OFFSET = 2
const COMMAND_KEY_LENGTH = 12
const FAILURE_EXIT_CODE = 1
const SEPARATOR = '--'
const FRESH_FLAG = '--fresh'
const USAGE = 'usage: josh ship:evidence <N> [--fresh] -- <command...>'

interface Evidence {
	readonly issue: string
	readonly command: ReadonlyArray<string>
	readonly is_fresh: boolean
}

interface Outcome {
	readonly output: string
	readonly code: number
	readonly reused?: string | undefined
}

// `--` is optional: a launcher that consumed it leaves the command right after the number.
function command_of(tokens: ReadonlyArray<string>): ReadonlyArray<string> {
	return tokens[0] === SEPARATOR ? tokens.slice(1) : tokens
}

function parse(argv: ReadonlyArray<string>): Evidence | undefined {
	const [issue_token = '', ...rest] = argv
	const issue = issue_number_shape.single_of([issue_token])
	const is_fresh = rest[0] === FRESH_FLAG
	const command = command_of(is_fresh ? rest.slice(1) : rest)

	return issue === undefined || command.length === 0 ? undefined : { issue, command, is_fresh }
}

// Not `buffered_process`: that runs pnpm alone and forces colors, which would land in the body.
async function execute(command: ReadonlyArray<string>): Promise<Outcome> {
	const [file = '', ...file_arguments] = command
	const result = await execa(file, file_arguments, {
		all: true,
		reject: false,
		// A command reading a piped stdin would wait for an end that never comes.
		stdin: 'ignore',
		// An inherited FORCE_COLOR overrides NO_COLOR, and Node warns about it into the output.
		env: { NO_COLOR: '1', FORCE_COLOR: undefined },
	})

	// A command that never ran (not found, killed) has no exit code: its reason is the output.
	const output = result.exitCode === undefined ? (result.message ?? result.all) : result.all

	return { output, code: result.exitCode ?? FAILURE_EXIT_CODE }
}

// joshuafolkken/kit#5693: a minutes-long command already run on this tree is not run again for its
// evidence. The record is `tree-verdict.ts`'s, keyed on the tree's content, with the command in its
// name, so one changed byte or argument runs it again; a failure is kept as one. The tree key cannot
// see state outside the tree (GitHub, a server), so `--fresh` runs such a command again.
function record_target(command: ReadonlyArray<string>): string {
	const key = stamp_file.digest(JSON.stringify(command)).slice(0, COMMAND_KEY_LENGTH)

	return tree_verdict.record_path(`ship-evidence-${key}`)
}

async function execute_once(evidence: Evidence): Promise<Outcome> {
	const target = record_target(evidence.command)
	const tree = await gate_tree.read_gate_tree()
	const verdict = evidence.is_fresh ? undefined : tree_verdict.read(tree, target)
	const reused = verdict === undefined ? undefined : tree_verdict.reused_line(verdict, target)

	if (verdict !== undefined) return { output: verdict.tail, code: verdict.exit_code, reused }

	const outcome = await execute(evidence.command)
	const tail = run_ship_evidence.tail_of(outcome.output)

	await tree_verdict.record(
		{ before: tree, exit_code: outcome.code, tail },
		gate_tree.read_gate_tree,
		target,
	)

	return outcome
}

// A replayed block carries its reuse line in the draft, so it never reads as a run made now.
async function record(draft: string, evidence: Evidence): Promise<number> {
	const { output, code, reused } = await execute_once(evidence)
	const evidence_block = run_ship_evidence.block_of(evidence.command, output)
	const block = reused === undefined ? evidence_block : `${reused}\n\n${evidence_block}`

	await writeFile(draft, run_ship_evidence.with_evidence(await readFile(draft, 'utf8'), block))
	console.info(`${block}\nappended to ${draft} (exit ${String(code)})`)

	return code
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const evidence = parse(argv)

	if (evidence === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const draft = await run_ship_body_draft.existing(evidence.issue)

	if (draft !== undefined) return await record(draft, evidence)
	console.error(`no ship body draft: \`pnpm josh run:prep ${evidence.issue}\` writes it`)

	return FAILURE_EXIT_CODE
}

const run_ship_evidence_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

export { run_ship_evidence_cli }
