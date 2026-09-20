#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// `josh run:event` — the command a run's step calls to append to, or read back, the append-only event
// stream (joshuafolkken/kit#2205). The in-process seams (`run:merge`) append directly; the steps with no
// josh command at the point the event happens — a plan posted, a child launched, a PR opened, a stop —
// call `--append` here, so parent and lane child alike write to the one stream. `--from` is the woken
// reader's "everything since the position I last read"; `--last` is the degenerate single-event read.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const APPEND_FLAG = '--append'
const FROM_FLAG = '--from'
const LAST_FLAG = '--last'
const FLAG_INDEX = 0
const KIND_INDEX = 1
const POSITION_INDEX = 1
const TEXT_INDEX = 2
const USAGE = 'Usage: josh run:event --append <kind> <text> | --from <position> | --last'

function now_iso(): string {
	return new Date().toISOString()
}

function report_usage(): number {
	process.stderr.write(`${USAGE}\n`)

	return FAILURE_EXIT_CODE
}

async function run_append(kind: string, text: string): Promise<number> {
	const target = await run_event_stream_emit.stream_target()

	if (target === undefined) return report_usage()

	const result = run_event_stream.append(target, kind, text, now_iso())

	if (!result.appended) {
		process.stderr.write(`not a session-facing event kind: ${kind}\n`)

		return FAILURE_EXIT_CODE
	}

	process.stdout.write(`${String(result.position)}\n`)

	return SUCCESS_EXIT_CODE
}

async function run_from(position_text: string | undefined): Promise<number> {
	const target = await run_event_stream_emit.stream_target()
	const position = Number(position_text)

	if (target === undefined || position_text === undefined || !Number.isSafeInteger(position)) {
		return report_usage()
	}

	process.stdout.write(`${JSON.stringify(run_event_stream.read_from(target, position))}\n`)

	return SUCCESS_EXIT_CODE
}

async function run_last(): Promise<number> {
	const target = await run_event_stream_emit.stream_target()

	if (target === undefined) return report_usage()

	const last = run_event_stream.read_last(target)

	process.stdout.write(`${last === undefined ? '' : JSON.stringify(last)}\n`)

	return SUCCESS_EXIT_CODE
}

function append_kind(argv: ReadonlyArray<string>): string {
	return argv[KIND_INDEX] ?? ''
}

function append_text(argv: ReadonlyArray<string>): string {
	return argv.slice(TEXT_INDEX).join(' ')
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const flag = argv[FLAG_INDEX]

	if (flag === APPEND_FLAG) return await run_append(append_kind(argv), append_text(argv))
	if (flag === FROM_FLAG) return await run_from(argv[POSITION_INDEX])
	if (flag === LAST_FLAG) return await run_last()

	return report_usage()
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_event_cli = {
	USAGE,
	main,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_event_cli }
