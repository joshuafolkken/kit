import { spawnSync } from 'node:child_process'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { lane_child_marker } from './lane-child-marker'
import { process_linux } from './process-linux'

// Each process's lane mark — the `JOSH_LANE_CHILD` it inherited — read from `ps -E`
// (joshuafolkken/kit#4315).
//
// **A process belongs to a lane by its mark wherever it runs.** A lane child that measures something
// from the main checkout or `/tmp` leaves processes whose working directory is not under the lane, and
// one started under `script` or a new session has left the child's tree and group for pid 1. The
// environment survives all of that, and `lane:dispatch` puts the issue number in it
// (`lane-child-marker.ts`), so the mark names the lane a process was started from.
//
// **The mark is read from the environment, never from the arguments.** `ps -E` appends the environment
// to the command line, so the plain command line is read too and only what follows it is searched: a
// `grep JOSH_LANE_CHILD=42` carries the text without the mark.
//
// **An application bundle is never marked.** A lane that opened Docker Desktop passed its environment
// to an application the whole machine uses; it is a person's, not the lane's.
//
// macOS uses ps; Linux reads exact inherited assignments from the current account's procfs entries.

const PS_COMMAND = '/bin/ps'
const LISTING_ARGUMENTS = ['-A', '-ww', '-o', 'pid=,command=']
const ENVIRONMENT_FLAG = '-E'
// `ps -E` over every process runs to hundreds of kilobytes; the default 1 MiB would cut it short.
const LISTING_BUFFER_BYTES = 67_108_864
const PID_LINE = /^\s*(?<pid>\d+) (?<command>.*)$/u
const APPLICATION_BUNDLE = '.app/Contents/'
const LISTING_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['darwin'])
const MARK = new RegExp(String.raw`(?:^|\s)${lane_child_marker.KEY}=(?<issue>\d+)(?=\s|$)`, 'u')

function command_lines(printed: string): Map<number, string> {
	const groups = printed.split('\n').map((line) => PID_LINE.exec(line)?.groups)

	return new Map(
		groups
			.filter((group) => group !== undefined)
			.map((group) => [Number(group['pid']), group['command'] ?? '']),
	)
}

// What `ps -E` printed after the plain command line; `undefined` for an application bundle and for a
// process the two listings disagree on (it ended or exec'd between them).
function environment_of(command: string | undefined, with_environment: string): string | undefined {
	if (command === undefined || command.includes(APPLICATION_BUNDLE)) return undefined

	return with_environment.startsWith(command) ? with_environment.slice(command.length) : undefined
}

function mark_of(command: string | undefined, with_environment: string): string | undefined {
	const environment = environment_of(command, with_environment)

	return environment === undefined ? undefined : MARK.exec(environment)?.groups?.['issue']
}

/** Each marked process's issue, from `ps`'s plain and `-E` listings. */
function parse(plain: string, with_environment: string): Map<number, string> {
	const commands = command_lines(plain)
	const marks = [...command_lines(with_environment)].map(
		([pid, line]) => [pid, mark_of(commands.get(pid), line)] as const,
	)

	return new Map(marks.filter((pair): pair is [number, string] => pair[1] !== undefined))
}

function listing(arguments_: ReadonlyArray<string>): string | undefined {
	const result = spawnSync(PS_COMMAND, arguments_, {
		encoding: 'utf8',
		maxBuffer: LISTING_BUFFER_BYTES,
		timeout: PROBE_TIMEOUT_MS,
		stdio: ['ignore', 'pipe', 'ignore'],
	})

	return result.error === undefined && result.status === 0 ? result.stdout : undefined
}

/**
 * Every marked process's issue, `undefined` where `ps` could not be run or timed out — never read as
 * "nothing marked".
 */
function darwin_marks(): Map<number, string> | undefined {
	const plain = listing(LISTING_ARGUMENTS)
	const with_environment = listing([ENVIRONMENT_FLAG, ...LISTING_ARGUMENTS])

	if (plain === undefined || with_environment === undefined) return undefined

	return parse(plain, with_environment)
}

function list_all(platform: NodeJS.Platform = process.platform): Map<number, string> | undefined {
	if (platform === 'linux') return process_linux.marks()

	return LISTING_PLATFORMS.has(platform) ? darwin_marks() : new Map()
}

const process_lane_marks = { list_all, parse }

export { process_lane_marks }
