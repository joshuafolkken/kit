#!/usr/bin/env tsx
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { execa } from 'execa'
import { run_ship_body_draft } from './run-ship-body-draft'
import { run_ship_evidence } from './run-ship-evidence'

// `josh ship:evidence <N> -- <command...>` — run the command and append its invocation and output tail
// to the ship body draft's evidence section (`run-ship-evidence.ts`). It exits with the command's own
// code, so a command that failed is seen as one; its output is recorded either way, since a refusal
// can be the evidence.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const SEPARATOR = '--'
const USAGE = 'usage: josh ship:evidence <N> -- <command...>'

interface Evidence {
	readonly issue: string
	readonly command: ReadonlyArray<string>
}

// `--` is optional: a launcher that consumed it leaves the command right after the number.
function parse(argv: ReadonlyArray<string>): Evidence | undefined {
	const [issue_token = '', ...rest] = argv
	const issue = issue_number_shape.single_of([issue_token])
	const command = rest[0] === SEPARATOR ? rest.slice(1) : rest

	return issue === undefined || command.length === 0 ? undefined : { issue, command }
}

// Not `buffered_process`: that runs pnpm alone and forces colors, which would land in the body.
async function execute(command: ReadonlyArray<string>): Promise<{ output: string; code: number }> {
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

async function record(draft: string, evidence: Evidence): Promise<number> {
	const { output, code } = await execute(evidence.command)
	const block = run_ship_evidence.block_of(evidence.command, output)

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
