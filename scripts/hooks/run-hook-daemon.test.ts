import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hook_command_bootstrap } from '#scripts/init/hook-command-bootstrap-fixture'
import { hook_daemon, type Daemon } from '#tools/hooks/hook-daemon'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#6683: kit's checkout hands `pretool-guard` to its resident daemon, and launches
// node exactly as before whenever that daemon is missing or does not answer.
const make_directory = temporary_directory()
const RUN_HOOK_SOURCE = fileURLToPath(new URL('run-hook.sh', import.meta.url))
const LAUNCHER = 'scripts/hooks/run-hook.sh'
const PAYLOAD = '{"tool_name":"Bash"}'
const REFUSED = 2
const LAUNCH_TIMEOUT_MS = 60_000
const DETACH_PATTERN = /--detach (?<directory>\S+)/u
// The gate stub echoes its arguments and the payload it reads, so a fallback shows it got the call.
const GATE_STUB =
	"const fs = process.getBuiltinModule('node:fs')\n" +
	"process.stdout.write(`gate ${process.argv.slice(2).join(' ')} ${fs.readFileSync(0, 'utf8')}`)\n"
// The daemon stub logs its arguments, and stays up with `DAEMON_HOLD` set.
const DAEMON_STUB =
	"process.getBuiltinModule('node:fs').appendFileSync(process.env.DAEMON_LOG, `${process.argv.slice(2).join(' ')}\\n`)\n" +
	'if (process.env.DAEMON_HOLD) setInterval(() => {}, 1000)\n'
const DAEMON_SCRIPT = 'dist/hooks/daemon.js'
const FALLBACK_OUTPUT = `gate pretool-guard pretool:guard ${PAYLOAD}`
// joshuafolkken/kit#6962: the installed package's launcher, which runs its bundle where kit's runs the gate.
const INSTALLED_PACKAGE = 'node_modules/@joshuafolkken/kit'
const INSTALLED_LAUNCHER = `${INSTALLED_PACKAGE}/${LAUNCHER}`
const BUNDLE_STUB =
	"process.stdout.write(`bundle ${process.getBuiltinModule('node:fs').readFileSync(0, 'utf8')}`)\n"
const BUNDLE_OUTPUT = `bundle ${PAYLOAD}`
const PASSED_ANSWER = { status: 0, stdout: '', stderr: '' }
const CALLER_VARIABLE = 'HOOK_DAEMON_CALLER'
// The second caller's value holds a line break, which the launcher escapes to keep one line a variable.
const CALLERS = ['first', 'second\n line']

interface LaunchResult {
	status: number | null
	stdout: string
	node_launches: number
}

const NODE_LOG = 'node.log'
const DAEMON_LOG = 'daemon.log'
const workspace: { root: string; environment: NodeJS.ProcessEnv } = { root: '', environment: {} }
const started: Array<Daemon> = []
const running: Array<ChildProcess> = []

function path_in(relative: string): string {
	return path.join(workspace.root, relative)
}

// A `node` first on PATH that logs each launch before running the real one.
function counting_environment(): NodeJS.ProcessEnv {
	const node_stub = path_in('bin/node')

	write_file(
		workspace.root,
		'bin/node',
		`#!/bin/sh\necho node >> "${path_in(NODE_LOG)}"\nexec "${process.execPath}" "$@"\n`,
	)
	chmodSync(node_stub, 0o755)

	return {
		...hook_command_bootstrap.fresh_git_environment(),
		PATH: `${path.dirname(node_stub)}${path.delimiter}${process.env['PATH'] ?? ''}`,
		DAEMON_LOG: path_in(DAEMON_LOG),
		JOSH_HOOK_DAEMON_WAIT: '1',
	}
}

function read_log(name: string): string {
	return existsSync(path_in(name)) ? readFileSync(path_in(name), 'utf8') : ''
}

async function launch(launcher = LAUNCHER, extra: NodeJS.ProcessEnv = {}): Promise<LaunchResult> {
	const child = spawn('sh', [launcher, 'pretool-guard'], {
		cwd: workspace.root,
		env: { ...workspace.environment, ...extra },
	})
	const chunks: Array<Buffer> = []

	child.stdout.on('data', (chunk: Buffer) => {
		chunks.push(chunk)
	})
	child.stdin.end(PAYLOAD)
	const status = await new Promise<number | null>((resolve) => child.on('close', resolve))
	const node_launches = read_log(NODE_LOG)
		.split('\n')
		.filter((line) => line === 'node').length

	return { status, stdout: Buffer.concat(chunks).toString('utf8'), node_launches }
}

// The call a launch from the workspace root hands its daemon, under the workspace environment.
function launched_call(): unknown {
	return expect.objectContaining({
		raw_payload: PAYLOAD,
		launch_directory: workspace.root,
		launcher_pid: expect.any(Number),
		environment: expect.objectContaining({ DAEMON_LOG: path_in(DAEMON_LOG) }),
	})
}

// A launch with no daemon starts one; the stub records the directory it was asked to serve.
async function daemon_directory(launcher = LAUNCHER): Promise<string> {
	await launch(launcher)

	return await vi.waitFor(() => {
		const directory = DETACH_PATTERN.exec(read_log(DAEMON_LOG))?.groups?.['directory']

		if (directory === undefined) throw new Error('no daemon was started')

		return directory
	})
}

async function exited(child: ChildProcess): Promise<NodeJS.Signals | null> {
	return await new Promise((resolve) => child.on('exit', (_code, signal) => resolve(signal)))
}

// A process whose command line is the daemon's for `directory`, recorded as its pid: what the
// launcher checks before it trusts or stops one.
function daemon_identity(directory: string): ChildProcess {
	const identity = spawn(process.execPath, [path_in(DAEMON_SCRIPT), directory], {
		env: { ...workspace.environment, DAEMON_HOLD: '1' },
	})

	running.push(identity)
	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, 'pid'), `${String(identity.pid)}\n`)

	return identity
}

// The daemon served in this process, under a pid that passes the launcher's identity check.
function serve_from(directory: string, answer: Daemon['answer'], is_current = true): void {
	const daemon = hook_daemon.start(directory, { answer, is_current: () => is_current })

	if (daemon === undefined) throw new Error('the daemon directory was already claimed')
	started.push(daemon)
	void hook_daemon.serve(daemon)
	daemon_identity(directory)
}

beforeEach(() => {
	// Resolved, as the launcher's own working directory is.
	workspace.root = realpathSync(make_directory('kit-run-hook-daemon-'))
	mkdirSync(path_in('scripts/hooks'), { recursive: true })
	copyFileSync(RUN_HOOK_SOURCE, path_in(LAUNCHER))
	write_file(workspace.root, 'tools/hooks/hook-bundle-ready.ts', GATE_STUB)
	write_file(workspace.root, DAEMON_SCRIPT, DAEMON_STUB)
	workspace.environment = counting_environment()
})

afterEach(() => {
	for (const daemon of started.splice(0)) hook_daemon.close(daemon)
	for (const child of running.splice(0)) child.kill()
})

describe(
	'run-hook.sh pretool-guard with the resident daemon',
	{ timeout: LAUNCH_TIMEOUT_MS },
	() => {
		it('runs the call itself and starts a daemon when there is none', async () => {
			const result = await launch()

			expect(result.stdout).toBe(FALLBACK_OUTPUT)
			await expect(daemon_directory()).resolves.toContain('kit-hook-daemon')
		})

		it('answers from a live daemon without launching node', async () => {
			const answer = vi
				.fn<Daemon['answer']>()
				.mockResolvedValue({ status: REFUSED, stdout: 'denied', stderr: '' })

			serve_from(await daemon_directory(), answer)
			rmSync(path_in(NODE_LOG), { force: true })
			const result = await launch()

			expect(result).toStrictEqual({ status: REFUSED, stdout: 'denied', node_launches: 0 })
			expect(answer).toHaveBeenCalledWith(launched_call())
		})
	},
)

// joshuafolkken/kit#7125: the daemon is the checkout's, whatever environment its callers run under.
describe(
	'run-hook.sh pretool-guard from callers of differing environments',
	{ timeout: LAUNCH_TIMEOUT_MS },
	() => {
		it('hands each call to the one daemon with the environment it was launched under', async () => {
			const answer = vi.fn<Daemon['answer']>().mockResolvedValue(PASSED_ANSWER)

			serve_from(await daemon_directory(), answer)
			rmSync(path_in(NODE_LOG), { force: true })
			await launch(LAUNCHER, { [CALLER_VARIABLE]: CALLERS[0] })
			const second = await launch(LAUNCHER, { [CALLER_VARIABLE]: CALLERS[1] })

			expect(second.node_launches).toBe(0)
			expect(answer.mock.calls.map(([call]) => call.environment[CALLER_VARIABLE])).toStrictEqual(
				CALLERS,
			)
		})
	},
)

describe(
	'run-hook.sh pretool-guard with a daemon that cannot answer',
	{ timeout: LAUNCH_TIMEOUT_MS },
	() => {
		it('runs the call itself and stops a daemon that does not answer', async () => {
			const directory = await daemon_directory()
			const stopped = exited(daemon_identity(directory))

			execFileSync('mkfifo', [path.join(directory, 'requests')])

			const { stdout } = await launch()

			expect(stdout).toBe(FALLBACK_OUTPUT)
			await expect(stopped).resolves.toBe('SIGTERM')
		})

		it('neither waits on nor stops a reused pid that is not the daemon', async () => {
			const directory = await daemon_directory()
			const unrelated = spawn('sleep', ['30'])

			running.push(unrelated)
			mkdirSync(directory, { recursive: true })
			writeFileSync(path.join(directory, 'pid'), `${String(unrelated.pid)}\n`)
			execFileSync('mkfifo', [path.join(directory, 'requests')])

			const { stdout } = await launch()

			expect(stdout).toBe(FALLBACK_OUTPUT)
			expect(unrelated.signalCode).toBeNull()
			expect(existsSync(path.join(directory, 'requests'))).toBe(false)
		})

		// joshuafolkken/kit#6962: a daemon whose build was replaced replies `stale` and goes
		// (`tools/hooks/hook-daemon.test.ts`), so the call runs on the build in place.
		it('runs a call itself on the build in place when the daemon replies stale', async () => {
			const answer = vi.fn<Daemon['answer']>()

			serve_from(await daemon_directory(), answer, false)
			const { stdout } = await launch()

			expect(stdout).toBe(FALLBACK_OUTPUT)
			expect(answer).not.toHaveBeenCalled()
		})
	},
)

describe(
	'run-hook.sh pretool-guard in an installed package',
	{ timeout: LAUNCH_TIMEOUT_MS },
	() => {
		beforeEach(() => {
			mkdirSync(path_in(`${INSTALLED_PACKAGE}/scripts/hooks`), { recursive: true })
			copyFileSync(RUN_HOOK_SOURCE, path_in(INSTALLED_LAUNCHER))
			write_file(workspace.root, `${INSTALLED_PACKAGE}/${DAEMON_SCRIPT}`, DAEMON_STUB)
			write_file(workspace.root, `${INSTALLED_PACKAGE}/dist/hooks/pretool-guard.js`, BUNDLE_STUB)
		})

		it('answers a passed call from a live daemon without launching node', async () => {
			const answer = vi.fn<Daemon['answer']>().mockResolvedValue(PASSED_ANSWER)

			serve_from(await daemon_directory(INSTALLED_LAUNCHER), answer)
			rmSync(path_in(NODE_LOG), { force: true })
			const result = await launch(INSTALLED_LAUNCHER)

			expect(result).toStrictEqual({ status: 0, stdout: '', node_launches: 0 })
			expect(answer).toHaveBeenCalledWith(launched_call())
		})

		it('runs the bundle itself and starts a daemon under the project cache when there is none', async () => {
			const result = await launch(INSTALLED_LAUNCHER)

			expect(result.stdout).toBe(BUNDLE_OUTPUT)
			await expect(daemon_directory(INSTALLED_LAUNCHER)).resolves.toContain(
				path_in('node_modules/.cache/kit-hook-daemon/'),
			)
		})

		it('runs the bundle itself and stops a daemon that does not answer', async () => {
			const directory = await daemon_directory(INSTALLED_LAUNCHER)
			const stopped = exited(daemon_identity(directory))

			execFileSync('mkfifo', [path.join(directory, 'requests')])

			const { stdout } = await launch(INSTALLED_LAUNCHER)

			expect(stdout).toBe(BUNDLE_OUTPUT)
			await expect(stopped).resolves.toBe('SIGTERM')
		})
	},
)
