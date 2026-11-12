import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { atomic_write } from '#scripts/lib/atomic-write'

// Which caller fed the checkout's `eslint_d` how many files (joshuafolkken/kit#7245). The daemon's
// footprint grows with every file it lints over its life rather than with one call's size, since its
// large heap lets V8 put off collecting (measured on joshuafolkken/kit#7245). So each line carries
// the running total of the daemon it reached, and a new daemon starts the file afresh.

const CALLS_RECORD = '.eslint_d-calls'
const LINE_SEPARATOR = '\n'
// `eslint_d` writes `<token> <port> <pid> <hash>` as the daemon's record.
const DAEMON_RECORD_PID = /^\S+ \S+ (?<pid>\d+)/u
const LAST_LINE = /total=(?<total>\d+) pid=(?<pid>\d+)$/u

const DAEMON_CALLER = {
	EDIT_HOOK: 'edit-hook',
	WARM: 'warm',
	PRE_COMMIT: 'pre-commit',
	LINT_RELATED: 'lint:related',
} as const

interface DaemonCall {
	caller: (typeof DAEMON_CALLER)[keyof typeof DAEMON_CALLER]
	files: number
}

function pid_of(daemon_record = ''): string | undefined {
	return DAEMON_RECORD_PID.exec(daemon_record)?.groups?.['pid']
}

function read_text(file: string): string {
	try {
		return readFileSync(file, 'utf8')
	} catch {
		return ''
	}
}

// The total the record's last line names for `pid`, or nothing when it names another daemon.
function previous_total(text: string, pid: string): number | undefined {
	const groups = LAST_LINE.exec(text.trimEnd())?.groups
	if (groups?.['pid'] !== pid) return undefined

	return Number(groups['total'])
}

function line_of(call: DaemonCall, total: number, pid: string, now: Date): string {
	const { caller, files } = call

	return `${now.toISOString()} caller=${caller} files=${String(files)} total=${String(total)} pid=${pid}${LINE_SEPARATOR}`
}

// Best-effort, like the daemon's own record: a lost line costs one call's attribution, and two
// callers that read the same last line before either appends both carry its total forward, so the
// later total misses the other call's files. A measurement record tolerates either loss.
function write_line(file: string, line: string, is_new_daemon: boolean): void {
	try {
		if (is_new_daemon) atomic_write.replace_file(file, line)
		else appendFileSync(file, line)
	} catch {
		// The next call writes its own line.
	}
}

function record(
	directory: string,
	daemon_record: string | undefined,
	call: DaemonCall,
	now: Date = new Date(),
): void {
	const pid = pid_of(daemon_record)
	if (pid === undefined) return
	const file = path.join(directory, CALLS_RECORD)
	const previous = previous_total(read_text(file), pid)

	write_line(file, line_of(call, (previous ?? 0) + call.files, pid, now), previous === undefined)
}

const eslint_daemon_calls = { pid_of, record, CALLS_RECORD, DAEMON_CALLER }

export type { DaemonCall }
export { eslint_daemon_calls }
