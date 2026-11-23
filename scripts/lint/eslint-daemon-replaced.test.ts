import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eslint_daemon_environment } from './eslint-daemon-environment'
import { eslint_daemon_replaced } from './eslint-daemon-replaced'

const make_directory = temporary_directory('suite')
const project_root = make_directory('eslint-daemon-replaced-')
const eslint_directory = path.join(project_root, 'node_modules', 'eslint')
const shared_directory = make_directory('eslint-daemon-shared-')
const REPLACED = path.join(eslint_directory, `.eslint_d-${'b'.repeat(64)}`)
const KIT_RECORDS = ['.eslint_d-toolchain', '.eslint_d-calls']
// A process that looks like a daemon to `ps`: `eslint_d` titles its daemon the same way.
const DAEMON_SCRIPT = [
	"process.title = 'eslint_d - replaced'",
	"process.stdout.write('ready')",
	'setInterval(() => {}, 1000)',
].join('\n')

const stops: Array<() => void> = []

async function start_daemon(): Promise<{ pid: number; exited: Promise<unknown> }> {
	const child = execa(process.execPath, ['-e', DAEMON_SCRIPT], { reject: false })

	stops.push(() => child.kill())
	await new Promise((resolve) => child.stdout.once('data', resolve))

	return { pid: child.pid ?? 0, exited: child }
}

function write_record(file: string, pid: number): void {
	writeFileSync(file, `token 4321 ${String(pid)} hash`)
}

function current_record(): string {
	return eslint_daemon_environment.record_file(eslint_directory, project_root)
}

beforeEach(() => {
	mkdirSync(eslint_directory, { recursive: true })
	mkdirSync(shared_directory, { recursive: true })
	for (const name of KIT_RECORDS) writeFileSync(path.join(eslint_directory, name), 'kit')
})

afterEach(() => {
	for (const stop of stops.splice(0)) stop()
	rmSync(project_root, { recursive: true, force: true })
	rmSync(shared_directory, { recursive: true, force: true })
})

// joshuafolkken/kit#8848: a daemon started under another environment is stopped once one is current.
describe('eslint_daemon_replaced.stop_replaced', () => {
	it('stops the daemon of a record other than the current one and removes its record', async () => {
		const replaced = await start_daemon()

		write_record(REPLACED, replaced.pid)
		write_record(current_record(), process.pid)

		eslint_daemon_replaced.stop_replaced(eslint_directory, project_root)

		await expect(replaced.exited).resolves.toMatchObject({ signal: 'SIGTERM' })
		expect(existsSync(REPLACED)).toBe(false)
	})

	it("keeps the current record and kit's own records", async () => {
		const replaced = await start_daemon()

		write_record(REPLACED, replaced.pid)
		write_record(current_record(), process.pid)

		eslint_daemon_replaced.stop_replaced(eslint_directory, project_root)

		for (const file of [
			current_record(),
			...KIT_RECORDS.map((name) => path.join(eslint_directory, name)),
		]) {
			expect(existsSync(file)).toBe(true)
		}
	})
})

describe('eslint_daemon_replaced.stop_replaced — records it leaves or drops', () => {
	// A record outlives a daemon killed outright, and its pid may now be another process's: this test
	// process, which a signal would end.
	it('drops the record of a pid that is not a daemon without signalling it', () => {
		write_record(REPLACED, process.pid)

		eslint_daemon_replaced.stop_replaced(eslint_directory, project_root)

		expect(existsSync(REPLACED)).toBe(false)
	})

	it('keeps a record still being written', () => {
		writeFileSync(REPLACED, '')

		eslint_daemon_replaced.stop_replaced(eslint_directory, project_root)

		expect(existsSync(REPLACED)).toBe(true)
	})

	// A store several checkouts share holds the daemons of the others.
	it('stops nothing in an eslint installed outside the project root', async () => {
		const other = await start_daemon()
		const record = path.join(shared_directory, path.basename(REPLACED))

		write_record(record, other.pid)

		eslint_daemon_replaced.stop_replaced(shared_directory, project_root)

		expect(existsSync(record)).toBe(true)
		expect(process.kill(other.pid, 0)).toBe(true)
	})
})
