import { readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { execaSync } from 'execa'
import { eslint_daemon_environment } from './eslint-daemon-environment'

// A daemon whose record name is not the current one was started under another environment — a caller
// from before kit fixed the environment, or an older kit — and nothing else stops it: `eslint_d stop`
// reaches only its own environment's record (joshuafolkken/kit#8848). Left alone it stays resident
// until its idle timeout. A record outlives a daemon killed outright, and its pid can be reused, so
// only a pid that is still an `eslint_d` process is signalled.

// `eslint_d` writes `<token> <port> <pid> <hash>`.
const PID_FIELD = 2
const FIELD_SEPARATOR = ' '
// The process title `eslint_d` gives its daemon (`eslint_d/lib/daemon.js`).
const DAEMON_TITLE = 'eslint_d'

function pid_of(record: string): number | undefined {
	try {
		const pid = Number(readFileSync(record, 'utf8').split(FIELD_SEPARATOR)[PID_FIELD])

		return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
	} catch {
		return undefined
	}
}

function is_daemon(pid: number): boolean {
	const result = execaSync('ps', ['-p', String(pid), '-o', 'command='], { reject: false })

	return result.exitCode === 0 && result.stdout.trimStart().startsWith(DAEMON_TITLE)
}

function stop_one(record: string): void {
	const pid = pid_of(record)
	if (pid === undefined || !is_daemon(pid)) return

	try {
		process.kill(pid, 'SIGTERM')
	} catch {
		// It exited between the check and the signal.
	}

	rmSync(record, { force: true })
}

function list_records(eslint_directory: string): ReadonlyArray<string> {
	try {
		return readdirSync(eslint_directory).filter((name) =>
			eslint_daemon_environment.is_record_name(name),
		)
	} catch {
		return []
	}
}

// Stops every daemon recorded beside `current` other than its own.
function stop_replaced(eslint_directory: string, current: string): void {
	for (const name of list_records(eslint_directory)) {
		const record = path.join(eslint_directory, name)
		if (record !== current) stop_one(record)
	}
}

const eslint_daemon_replaced = { stop_replaced }

export { eslint_daemon_replaced }
