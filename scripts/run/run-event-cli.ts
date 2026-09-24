#!/usr/bin/env tsx
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { session_language } from '#scripts/josh/session-language'
import { run_event_follow, type FollowPorts } from './run-event-follow'
import { run_event_render } from './run-event-render'
import { run_event_stream, type StreamRead } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'
import { run_event_watch } from './run-event-watch'

// `josh run:event` — the command a run's step calls to append to, or read back, the append-only event
// stream (joshuafolkken/kit#2205). The in-process seams (`run:merge`) append directly; the steps with no
// josh command at the point the event happens — a plan posted, a child launched, a PR opened, a stop —
// call `--append` here, so parent and lane child alike write to the one stream. `--from` is the woken
// reader's "everything since the position I last read"; `--last` is the degenerate single-event read.
//
// **`--follow` is one bounded read that waits** (joshuafolkken/kit#2207). It is `--from` that returns
// the moment an event is past the given position, and otherwise at the interval. The lines go to
// standard output and the position to read from next goes to standard error — the same before and after
// a session cut, because the stream is the run's and the position is the caller's.
//
// **`--watch` is the ambient surface: the same pass in a loop that never exits** (joshuafolkken/kit#2492),
// each event rendered in the session language (`run-event-render.ts`), for a person to keep open in a
// pane of their own. No conversation relays the stream any more — a session woken per event re-read its
// whole history each time, and outspent every lane of the run doing it.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const APPEND_FLAG = '--append'
const FROM_FLAG = '--from'
const FOLLOW_FLAG = '--follow'
const LAST_FLAG = '--last'
const WATCH_FLAG = '--watch'
const FLAG_INDEX = 0
const KIND_INDEX = 1
const POSITION_INDEX = 1
const TEXT_INDEX = 2
const USAGE =
	'Usage: josh run:event --append <kind> <text> | --from <position> | --follow <position> | --watch [<position>] | --last'

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

// The events on standard output, and the next position on standard error for the caller to read back.
// An empty read is a quiet tick — nothing printed, the position unchanged.
function print_pass(read: StreamRead): void {
	for (const event of read.events) {
		process.stdout.write(`${run_event_stream.format_event(event)}\n`)
	}

	process.stderr.write(`next_position: ${String(read.next_position)}\n`)
}

async function follow_pass(target: string, position: number): Promise<StreamRead> {
	return await run_event_follow.follow(follow_ports(target), position, {
		interval_ms: run_event_follow.FOLLOW_INTERVAL_MS,
		tick_ms: run_event_follow.FOLLOW_TICK_MS,
	})
}

async function run_follow(position_text: string | undefined): Promise<number> {
	const target = await run_event_stream_emit.stream_target()
	const position = Number(position_text)

	if (target === undefined || position_text === undefined || !Number.isSafeInteger(position)) {
		return report_usage()
	}

	print_pass(await follow_pass(target, position))

	return SUCCESS_EXIT_CODE
}

// With no position the pane starts at the stream's current end, so opening it shows what happens next
// rather than replaying the up-to-`EVENT_CAP` events already there.
function watch_start(target: string, position_text: string | undefined): number | undefined {
	if (position_text === undefined) return run_event_stream.read_from(target, 0).next_position

	const position = Number(position_text)

	return Number.isSafeInteger(position) ? position : undefined
}

async function run_watch(position_text: string | undefined): Promise<number> {
	const target = await run_event_stream_emit.stream_target()
	const position = target === undefined ? undefined : watch_start(target, position_text)

	if (target === undefined || position === undefined) return report_usage()

	const { lang } = session_language.resolve_session_lang()

	await run_event_watch.watch(
		{
			pass: async (from) => await follow_pass(target, from),
			write: (line) => process.stdout.write(`${line}\n`),
			render: (event) => run_event_render.render(event, lang),
			should_continue: () => true,
		},
		position,
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

type Mode = (argv: ReadonlyArray<string>) => Promise<number>

const MODES: ReadonlyMap<string, Mode> = new Map<string, Mode>([
	[APPEND_FLAG, async (argv) => await run_append(append_kind(argv), append_text(argv))],
	[FROM_FLAG, async (argv) => await run_from(argv[POSITION_INDEX])],
	[FOLLOW_FLAG, async (argv) => await run_follow(argv[POSITION_INDEX])],
	[WATCH_FLAG, async (argv) => await run_watch(argv[POSITION_INDEX])],
	[LAST_FLAG, async () => await run_last()],
])

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const mode = MODES.get(argv[FLAG_INDEX] ?? '')

	return mode === undefined ? report_usage() : await mode(argv)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_event_cli = {
	USAGE,
	main,
	run,
	watch_start,
}

// `.env` is read here rather than through the dispatcher's `tsx_arguments`, which would take this
// command off in-process dispatch: `--watch` renders in the `JOSH_SESSION_LANG` a person keeps there.
// Inside the guard, so a developer's own `.env` cannot decide what the unit tests see.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	josh_environment_file.load_environment_file()
	await main(process.argv.slice(ARGV_OFFSET))
}

export { run_event_cli }
