import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hook_daemon, type Daemon, type DaemonOptions } from './hook-daemon'
import { hook_daemon_call } from './hook-daemon-call'

const make_directory = temporary_directory()
const PAYLOAD = '{"tool_name":"Bash"}'
const LAUNCH_DIRECTORY = '/launched/here'
const REFUSED = 2
const REFUSED_ANSWER = { status: REFUSED, stdout: 'denied', stderr: 'why' }
const ROOT_PREFIX = 'hook-daemon-'
// The launcher's side of one call (`scripts/hooks/run-hook.sh`): hold the reply FIFO open, queue the
// call directory, then print the first reply line.
const CLIENT_SCRIPT =
	'exec 4<>"$1/reply"; printf \'%s\\n\' "$1" 1<>"$2/requests"; read -r reply <&4; printf %s "$reply"'
const started: Array<Daemon> = []
// Pids of daemons started as processes, stopped after each test.
const detached: Array<number> = []
const DAEMON_SOURCE = fileURLToPath(new URL('hook-daemon.ts', import.meta.url))
const TSX_BIN = path.join(import.meta.dirname, '../../node_modules/.bin/tsx')
const DETACH_TIMEOUT_MS = 10_000
const SOURCE_NAME = 'source.ts'
const SOURCE_CONTENT = 'export {}\n'
const FIRST_OUTPUT = 'first.js'
// Any pid not this process's: the launcher's, or a successor daemon's.
const LAUNCHER_PID = 1

// Each output written and stamped as built from the one source as it reads now.
function write_build(out_directory: string, outputs: ReadonlyArray<string>): void {
	const sources = new Map([[SOURCE_NAME, new TextEncoder().encode(SOURCE_CONTENT)]])

	for (const output of outputs) writeFileSync(path.join(out_directory, output), SOURCE_CONTENT)
	writeFileSync(
		path.join(out_directory, hook_bundle_stamp.STAMP_NAME),
		hook_bundle_stamp.stamp_text(sources, outputs),
	)
}

function built_package(package_directory = make_directory(ROOT_PREFIX)): {
	package_directory: string
	out_directory: string
} {
	const out_directory = path.join(package_directory, 'dist', 'hooks')

	mkdirSync(out_directory, { recursive: true })
	writeFileSync(path.join(package_directory, SOURCE_NAME), SOURCE_CONTENT)
	write_build(out_directory, [FIRST_OUTPUT])

	return { package_directory, out_directory }
}

function request_directory(root: string): string {
	const request = path.join(root, 'call')

	mkdirSync(request)
	writeFileSync(path.join(request, 'payload'), PAYLOAD)
	writeFileSync(path.join(request, 'cwd'), LAUNCH_DIRECTORY)
	writeFileSync(path.join(request, 'launcher'), String(LAUNCHER_PID))
	execFileSync('mkfifo', [path.join(request, 'reply')])

	return request
}

async function call(request: string, directory: string): Promise<string> {
	const client = spawn('sh', ['-c', CLIENT_SCRIPT, 'client', request, directory])
	const chunks: Array<Buffer> = []

	client.stdout.on('data', (chunk: Buffer) => {
		chunks.push(chunk)
	})

	return await new Promise((resolve) => {
		client.on('close', () => {
			resolve(Buffer.concat(chunks).toString('utf8'))
		})
	})
}

function serving_with(directory: string, options: DaemonOptions): Daemon {
	const daemon = hook_daemon.start(directory, options)

	if (daemon === undefined) throw new Error('the daemon directory was already claimed')
	started.push(daemon)
	void hook_daemon.serve(daemon)

	return daemon
}

function serving(directory: string, is_current: () => boolean): Daemon {
	const answer = vi.fn().mockResolvedValue(REFUSED_ANSWER)

	return serving_with(directory, { answer, is_current })
}

afterEach(() => {
	for (const daemon of started.splice(0)) hook_daemon.close(daemon)
	for (const pid of detached.splice(0)) process.kill(pid)
	vi.restoreAllMocks()
})

describe('hook_daemon', () => {
	it('answers a call with its exit status, writing its output beside the call', async () => {
		const root = make_directory(ROOT_PREFIX)
		const daemon = serving(path.join(root, 'daemon'), () => true)
		const request = request_directory(root)

		expect(await call(request, daemon.directory)).toBe(String(REFUSED))
		expect(readFileSync(path.join(request, 'out'), 'utf8')).toBe('denied')
		expect(readFileSync(path.join(request, 'err'), 'utf8')).toBe('why')
		expect(daemon.answer).toHaveBeenCalledWith(PAYLOAD, LAUNCH_DIRECTORY, LAUNCHER_PID)
	})

	it('replies stale and goes once its bundles are no longer current', async () => {
		const root = make_directory(ROOT_PREFIX)
		const daemon = serving(path.join(root, 'daemon'), () => false)

		expect(await call(request_directory(root), daemon.directory)).toBe(hook_daemon.STALE_REPLY)
		expect(existsSync(daemon.directory)).toBe(false)
		expect(daemon.answer).not.toHaveBeenCalled()
	})

	it('leaves a directory another daemon claimed to that daemon', () => {
		const directory = path.join(make_directory(ROOT_PREFIX), 'daemon')

		serving(directory, () => true)

		expect(hook_daemon.start(directory)).toBeUndefined()
	})

	it('leaves a directory a successor claimed when it goes', () => {
		const daemon = serving(path.join(make_directory(ROOT_PREFIX), 'daemon'), () => true)

		writeFileSync(path.join(daemon.directory, 'pid'), `${String(LAUNCHER_PID)}\n`)
		hook_daemon.close(daemon)

		expect(existsSync(daemon.directory)).toBe(true)
	})
})

describe('hook_daemon without an injected answer', () => {
	it('answers through the guard call under the root and environment it started with', async () => {
		const answer = vi.spyOn(hook_daemon_call, 'answer').mockResolvedValue(REFUSED_ANSWER)
		const root = make_directory(ROOT_PREFIX)
		const daemon = serving_with(path.join(root, 'daemon'), { is_current: () => true })

		expect(await call(request_directory(root), daemon.directory)).toBe(String(REFUSED))
		expect(answer).toHaveBeenCalledWith(
			{ root: process.cwd(), environment: { ...process.env } },
			PAYLOAD,
			LAUNCH_DIRECTORY,
			LAUNCHER_PID,
		)
	})
})

describe('the daemon process', () => {
	it('detaches a daemon that claims the directory it was launched for', async () => {
		const directory = path.join(make_directory(ROOT_PREFIX), 'daemon')
		const launcher = spawn(TSX_BIN, [DAEMON_SOURCE, '--detach', directory], { stdio: 'ignore' })
		const launched = await new Promise<number | null>((resolve) => launcher.on('exit', resolve))
		const pid = await vi.waitFor(() => Number(readFileSync(path.join(directory, 'pid'), 'utf8')), {
			timeout: DETACH_TIMEOUT_MS,
		})

		detached.push(pid)

		expect(launched).toBe(0)
		expect(pid).not.toBe(launcher.pid)
		expect(existsSync(path.join(directory, 'requests'))).toBe(true)
	})

	// joshuafolkken/kit#6962: an installed package is reached through its `node_modules` symlink.
	it('runs a daemon launched through a symlink to it', async () => {
		const root = make_directory(ROOT_PREFIX)
		const linked = path.join(root, 'linked-daemon.ts')
		const directory = path.join(root, 'daemon')

		symlinkSync(DAEMON_SOURCE, linked)
		const daemon = spawn(TSX_BIN, [linked, directory], { stdio: 'ignore' })
		const pid = await vi.waitFor(() => Number(readFileSync(path.join(directory, 'pid'), 'utf8')), {
			timeout: DETACH_TIMEOUT_MS,
		})

		detached.push(pid)

		expect(pid).toBeGreaterThan(0)
		daemon.unref()
	})
})

describe('hook_daemon.bundle_currency', () => {
	it('reads the build it loaded as current', () => {
		const { package_directory, out_directory } = built_package()

		expect(hook_daemon.bundle_currency(out_directory, package_directory)()).toBe(true)
	})

	it('reads a rebuild since it loaded as stale, though that build is fresh', () => {
		const { package_directory, out_directory } = built_package()
		const is_current = hook_daemon.bundle_currency(out_directory, package_directory)

		write_build(out_directory, [FIRST_OUTPUT, 'second.js'])

		expect(is_current()).toBe(false)
	})

	it('reads a source edited past the build as stale', () => {
		const { package_directory, out_directory } = built_package()
		const is_current = hook_daemon.bundle_currency(out_directory, package_directory)

		writeFileSync(path.join(package_directory, SOURCE_NAME), 'export const moved = 1\n')

		expect(is_current()).toBe(false)
	})
})

// joshuafolkken/kit#6962: an installed package ships its build, not the sources its stamp lists.
function installed_package(): { package_directory: string; out_directory: string } {
	const built = built_package(
		path.join(make_directory(ROOT_PREFIX), 'node_modules', '@joshuafolkken', 'kit'),
	)

	rmSync(path.join(built.package_directory, SOURCE_NAME))

	return built
}

describe('hook_daemon.bundle_currency in an installed package', () => {
	it('reads the build it loaded as current without the sources it was built from', () => {
		const { package_directory, out_directory } = installed_package()

		expect(hook_daemon.bundle_currency(out_directory, package_directory)()).toBe(true)
	})

	it('reads a reinstalled build as stale', () => {
		const { package_directory, out_directory } = installed_package()
		const is_current = hook_daemon.bundle_currency(out_directory, package_directory)

		write_build(out_directory, [FIRST_OUTPUT, 'second.js'])

		expect(is_current()).toBe(false)
	})
})
