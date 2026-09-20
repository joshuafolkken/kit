#!/usr/bin/env tsx
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { run_event_follow, type FollowPorts } from './run-event-follow'
import { run_event_stream, type StreamRead } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// `josh run:event` — the command a run's step calls to append to, or read back, the append-only event
// stream (joshuafolkken/kit#2205). The in-process seams (`run:merge`) append directly; the steps with no
// josh command at the point the event happens — a plan posted, a child launched, a PR opened, a stop —
// call `--append` here, so parent and lane child alike write to the one stream. `--from` is the woken
// reader's "everything since the position I last read"; `--last` is the degenerate single-event read.
//
// **`--follow` is the reader an attached session relays with** (joshuafolkken/kit#2207). It is `--from`
// that waits: it returns the moment an event is past the given position, and otherwise at the interval,
// so a person sees a new event land at once and still sees the run is alive while it is quiet. The
// relayed lines go to standard output and the position to relay from next goes to standard error, so a
// session relays standard output verbatim and reads the position back — the same before and after a
// session cut, because the stream is the run's and the position is the caller's.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const APPEND_FLAG = '--append'
const FROM_FLAG = '--from'
const FOLLOW_FLAG = '--follow'
const LAST_FLAG = '--last'
const FLAG_INDEX = 0
const KIND_INDEX = 1
const POSITION_INDEX = 1
const TEXT_INDEX = 2
// The follow's quiet-tick cadence and how promptly it notices an arrival. The interval only bounds a
// wait that found nothing — an arrival returns within a tick of landing — so it can be as long as the
// heartbeat without making the relay late, and the tick is a cheap `stat` of one file.
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const FOLLOW_INTERVAL_MINUTES = 20
const FOLLOW_INTERVAL_MS = FOLLOW_INTERVAL_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND
const FOLLOW_TICK_MS = MS_PER_SECOND
const USAGE =
	'Usage: josh run:event --append <kind> <text> | --from <position> | --follow <position> | --last'

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

function follow_ports(target: string): FollowPorts {
	return {
		read: (position) => run_event_stream.read_from(target, position),
		now: () => Date.now(),
		sleep: async (milliseconds) => {
			await sleep(milliseconds)
		},
	}
}

// The events on standard output for a session to relay, and the next position on standard error for it
// to read back. An empty read is a quiet tick — nothing to relay, the position unchanged.
function relay(read: StreamRead): void {
	for (const event of read.events) {
		process.stdout.write(`${run_event_stream.format_event(event)}\n`)
	}

	process.stderr.write(`next_position: ${String(read.next_position)}\n`)
}

async function run_follow(position_text: string | undefined): Promise<number> {
	const target = await run_event_stream_emit.stream_target()
	const position = Number(position_text)

	if (target === undefined || position_text === undefined || !Number.isSafeInteger(position)) {
		return report_usage()
	}

	relay(
		await run_event_follow.follow(follow_ports(target), position, {
			interval_ms: FOLLOW_INTERVAL_MS,
			tick_ms: FOLLOW_TICK_MS,
		}),
	)

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
	if (flag === FOLLOW_FLAG) return await run_follow(argv[POSITION_INDEX])
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
