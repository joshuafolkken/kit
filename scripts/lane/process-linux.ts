import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import path from 'node:path'
import { lane_child_marker } from './lane-child-marker'

interface LinuxProcess {
	pid: number
	directory: string
	issue: string | undefined
}

type ProcessRead = { kind: 'read'; process: LinuxProcess } | { kind: 'skip' | 'unknown' }
const GONE_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ESRCH'])
const PID_DIRECTORY = /^\d+$/u
const MARK_PREFIX = `${lane_child_marker.KEY}=`

function is_gone(error: unknown): boolean {
	return error instanceof Error && 'code' in error && GONE_CODES.has(String(error.code))
}

function marked_issue(content: string): string | undefined {
	const assignment = content.split('\0').find((entry) => entry.startsWith(MARK_PREFIX))
	const value = assignment?.slice(MARK_PREFIX.length)

	return lane_child_marker.marked_issue({ [lane_child_marker.KEY]: value })
}

function read_process(root: string, pid: string, uid: number): ProcessRead {
	const directory = path.join(root, pid)

	try {
		if (statSync(directory).uid !== uid) return { kind: 'skip' }
		const cwd = readlinkSync(path.join(directory, 'cwd'))
		const issue = marked_issue(readFileSync(path.join(directory, 'environ'), 'utf8'))

		return { kind: 'read', process: { pid: Number(pid), directory: cwd, issue } }
	} catch (error) {
		return { kind: is_gone(error) ? 'skip' : 'unknown' }
	}
}

function processes(readings: ReadonlyArray<ProcessRead>): Array<LinuxProcess> {
	return readings.flatMap((reading) => (reading.kind === 'read' ? [reading.process] : []))
}

function read_owned(root: string, uid: number): Array<LinuxProcess> | undefined {
	try {
		const pids = readdirSync(root).filter((entry) => PID_DIRECTORY.test(entry))
		const readings = pids.map((pid) => read_process(root, pid, uid))
		if (readings.some((reading) => reading.kind === 'unknown')) return undefined

		return processes(readings)
	} catch {
		return undefined
	}
}

function read_processes(root = '/proc', uid = process.getuid?.()): Array<LinuxProcess> | undefined {
	return uid === undefined ? undefined : read_owned(root, uid)
}

function directories(): Map<number, string> | undefined {
	const read = read_processes()

	return read === undefined
		? undefined
		: new Map(read.map((entry) => [entry.pid, entry.directory] as const))
}

function marks(): Map<number, string> | undefined {
	const marked = read_processes()?.filter((entry) => entry.issue !== undefined)

	return marked === undefined
		? undefined
		: new Map(
				marked.flatMap((entry) => (entry.issue === undefined ? [] : [[entry.pid, entry.issue]])),
			)
}

const process_linux = { directories, marks, read_processes }

export { process_linux }
