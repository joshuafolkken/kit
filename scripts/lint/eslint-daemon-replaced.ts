import { readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import path from 'node:path'
import { execaSync } from 'execa'
import { eslint_daemon_environment } from './eslint-daemon-environment'

// A daemon whose record name is not the current one was started under another environment — a caller
// from before kit fixed the environment, or an older kit — and nothing else stops it: `eslint_d stop`
// reaches only its own environment's record (joshuafolkken/kit#8848). Left alone it stays resident
// until its idle timeout. A record outlives a daemon killed outright, and its pid can be reused, so
// only a pid that is still an `eslint_d` process is signalled; the record of any other pid is dropped.
// An eslint installed outside the project root — a store several checkouts share — holds the records
// of every checkout that resolves it, so nothing is stopped there.

// `eslint_d` writes `<token> <port> <pid> <hash>`.
const PID_FIELD = 2
const FIELD_SEPARATOR = ' '
// The process title `eslint_d` gives its daemon (`eslint_d/lib/daemon.js`).
const DAEMON_TITLE = 'eslint_d'

// No pid while the record is still being written: it is left to its writer.
function read_text(record: string): string {
	try {
		return readFileSync(record, 'utf8')
	} catch {
		return ''
	}
}

function pid_of(record: string): number | undefined {
	const pid = Number(read_text(record).split(FIELD_SEPARATOR)[PID_FIELD])

	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

function is_daemon(pid: number): boolean {
	const result = execaSync('ps', ['-p', String(pid), '-o', 'command='], { reject: false })

	return result.exitCode === 0 && result.stdout.trimStart().startsWith(DAEMON_TITLE)
}

function stop_one(record: string): void {
	const pid = pid_of(record)
	if (pid === undefined) return

	if (is_daemon(pid)) {
		try {
			process.kill(pid, 'SIGTERM')
		} catch {
			// It exited between the check and the signal.
		}
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

function is_own_install(eslint_directory: string, project_root: string): boolean {
	const relative = path.relative(realpathSync(project_root), realpathSync(eslint_directory))

	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

// Stops every daemon recorded beside the project's current record other than its own.
function stop_replaced(eslint_directory: string, project_root: string): void {
	if (!is_own_install(eslint_directory, project_root)) return
	const current = eslint_daemon_environment.record_file(eslint_directory, project_root)

	for (const name of list_records(eslint_directory)) {
		const record = path.join(eslint_directory, name)
		if (record !== current) stop_one(record)
	}
}

const eslint_daemon_replaced = { stop_replaced }

export { eslint_daemon_replaced }
