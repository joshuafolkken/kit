import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eslint_daemon_replaced } from './eslint-daemon-replaced'

const make_directory = temporary_directory('suite')
const eslint_directory = make_directory('eslint-daemon-replaced-')
const CURRENT = path.join(eslint_directory, `.eslint_d-${'a'.repeat(64)}`)
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

beforeEach(() => {
	mkdirSync(eslint_directory, { recursive: true })
	for (const name of KIT_RECORDS) writeFileSync(path.join(eslint_directory, name), 'kit')
})

afterEach(() => {
	for (const stop of stops.splice(0)) stop()
	rmSync(eslint_directory, { recursive: true, force: true })
})

// joshuafolkken/kit#8848: a daemon started under another environment is stopped once one is current.
describe('eslint_daemon_replaced.stop_replaced', () => {
	it('stops the daemon of a record other than the current one and removes its record', async () => {
		const replaced = await start_daemon()

		write_record(REPLACED, replaced.pid)
		write_record(CURRENT, process.pid)

		eslint_daemon_replaced.stop_replaced(eslint_directory, CURRENT)

		await expect(replaced.exited).resolves.toMatchObject({ signal: 'SIGTERM' })
		expect(existsSync(REPLACED)).toBe(false)
	})

	it("keeps the current record and kit's own records", async () => {
		const replaced = await start_daemon()

		write_record(REPLACED, replaced.pid)
		write_record(CURRENT, process.pid)

		eslint_daemon_replaced.stop_replaced(eslint_directory, CURRENT)

		for (const name of [path.basename(CURRENT), ...KIT_RECORDS]) {
			expect(existsSync(path.join(eslint_directory, name))).toBe(true)
		}
	})

	// A record outlives a daemon killed outright, and its pid may now be another process's.
	it('signals no process that is not a daemon', () => {
		write_record(REPLACED, process.pid)

		eslint_daemon_replaced.stop_replaced(eslint_directory, CURRENT)

		expect(existsSync(REPLACED)).toBe(true)
	})
})
