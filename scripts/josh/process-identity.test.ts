import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { process_identity } from './process-identity'
import { process_identity_fixture } from './process-identity-fixture'

// joshuafolkken/kit#1245: the in-flight gate marker reported a gate that a reissued pid made look
// alive. `process.kill(pid, 0)` answers about whatever holds the number now, so a marker left behind
// by an interrupted `josh gate` began asserting a running gate again the moment the operating system
// handed that pid to something unrelated.
//
// **The recycled pid is testable without waiting for the operating system to reissue anything**: what
// the reader sees in that situation is a pid that is alive paired with a recorded start time that is
// not the one that pid has now. This suite constructs exactly that.

const {
	DEAD_PID,
	FOREIGN_START,
	GROUP_PID,
	NEGATIVE_PID,
	SANDBOX_START,
	has_native_start_probe,
	has_start_probe,
	sandbox_probes,
} = process_identity_fixture

const SOCKET_SCHEME = 'socket:'
const UNUSED_TARGET = 'unused.sock'
// A child its timeout or a signal killed reports no exit status.
const KILLED_STATUS = undefined
// The probe's exit when its own one-second socket timeout fires.
const SOCKET_TIMEOUT_STATUS = 1
// A listener SIGKILLed while bound, which leaves its socket file behind with nobody accepting on it.
const KILLED_LISTENER_SOURCE =
	"require('node:net').createServer().listen(process.argv[1],()=>process.kill(process.pid,'SIGKILL'))"

function missing_socket(): string {
	return path.join(tmpdir(), `${randomUUID()}.sock`)
}

function in_scratch_directory(work: (directory: string) => void): void {
	const directory = mkdtempSync(path.join(tmpdir(), 'process-identity-test-'))

	try {
		work(directory)
	} finally {
		rmSync(directory, { force: true, recursive: true })
	}
}

function fail_binding(): never {
	throw new Error('bind denied')
}

describe('process_identity.is_same_process — a pid is not a process identity', () => {
	it.skipIf(!has_start_probe)('recognizes this process by its own pid and start time', () => {
		expect(process_identity.is_same_process(process.pid, process_identity.own_start())).toBe(true)
	})

	// **The assertion this Issue was filed for.** The pid is live — it is this very process — and the
	// recorded start time belongs to some other process, which is precisely the state a reissued pid
	// leaves a marker in. Answering `true` here is what let the brief print "a gate is running".
	it.skipIf(!has_native_start_probe)('refuses a live pid the record did not name', () => {
		expect(process_identity.is_same_process(process.pid, FOREIGN_START)).toBe(false)
	})

	it.each([[DEAD_PID], [GROUP_PID], [NEGATIVE_PID]])(
		'answers false for pid %i, which no live process holds',
		(pid: number) => {
			expect(process_identity.is_same_process(pid, FOREIGN_START)).toBe(false)
		},
	)

	it('answers false when the record names no process at all', () => {
		expect(process_identity.is_same_process(undefined, FOREIGN_START)).toBe(false)
	})

	// **`undefined` is a third answer and not a soft `false`.** A record written before the start time
	// existed, or on a platform that cannot report one, is a live pid nobody can identify — and the two
	// callers resolve that in opposite directions, so it must reach them intact.
	it('answers undefined for a live pid whose record carries no start time', () => {
		expect(process_identity.is_same_process(process.pid, undefined)).toBeUndefined()
	})
})

describe('process_identity — reading a start time', () => {
	it('answers nothing for a pid no process holds', () => {
		expect(process_identity.read_start(DEAD_PID)).toBeUndefined()
	})

	// A process's own start time cannot change, and the probe costs a subprocess that every record
	// write would otherwise pay again — so the answer is read once and kept.
	it('answers the same start time for this process every time it is asked', () => {
		expect(process_identity.own_start()).toBe(process_identity.own_start())
	})

	it('uses the proc identity when the sandbox refuses ps', () => {
		expect(process_identity.read_start(process.pid, sandbox_probes(SANDBOX_START))).toBe(
			SANDBOX_START,
		)
	})

	it('keeps live, dead, and reused pids distinct when ps is unavailable', () => {
		function read(pid: number): string | undefined {
			return process_identity.read_start(pid, sandbox_probes(SANDBOX_START))
		}

		expect(process_identity.is_same_process(process.pid, SANDBOX_START, read)).toBe(true)
		expect(process_identity.is_same_process(process.pid, FOREIGN_START, read)).toBe(false)
		expect(process_identity.is_same_process(DEAD_PID, SANDBOX_START, read)).toBe(false)
	})
})

describe('process_identity — sandbox generation beacons', () => {
	it.skipIf(process.platform === 'win32')(
		'uses a live generation beacon when proc and ps are unavailable',
		() => {
			const token = process_identity.resolve_own_start(sandbox_probes(undefined)) ?? ''

			try {
				expect(token).toMatch(/^socket:/u)
				expect(process_identity.is_same_process(process.pid, token)).toBe(true)
				expect(process_identity.is_same_process(DEAD_PID, token)).toBe(false)
			} finally {
				process_identity.close_beacon(token)
			}

			expect(process_identity.is_same_process(process.pid, token)).toBe(false)
		},
	)

	it('keeps the safe unknown result on Windows when native probes are unavailable', () => {
		expect(process_identity.resolve_own_start(sandbox_probes(undefined), 'win32')).toBeUndefined()
	})

	it('keeps the safe unknown result when the generation beacon cannot bind', () => {
		expect(process_identity.open_beacon(() => createServer())).toBeUndefined()
		expect(process_identity.open_beacon(fail_binding)).toBeUndefined()
	})
})

// joshuafolkken/kit#3503: a beacon probe that a loaded machine timed out was read as a dead holder,
// so a waiter cleared a live holder's lock and two writers lost an event between them.
describe('process_identity.is_live_beacon — an unanswered probe is unknown, not gone', () => {
	it('answers undefined for a probe killed by its timeout or a signal', () => {
		expect(process_identity.is_live_beacon(UNUSED_TARGET, () => KILLED_STATUS)).toBeUndefined()
	})

	it('answers undefined for a probe whose own socket timed out', () => {
		expect(
			process_identity.is_live_beacon(UNUSED_TARGET, () => SOCKET_TIMEOUT_STATUS),
		).toBeUndefined()
	})

	it.skipIf(process.platform === 'win32')('answers true for a listening beacon', () => {
		const token = process_identity.open_beacon() ?? ''

		try {
			expect(process_identity.is_live_beacon(token.slice(SOCKET_SCHEME.length))).toBe(true)
		} finally {
			process_identity.close_beacon(token)
		}
	})

	it.skipIf(process.platform === 'win32')('answers false for a socket that is not there', () => {
		expect(process_identity.is_live_beacon(missing_socket())).toBe(false)
	})
})

describe('process_identity.is_live_beacon — which connection errors prove the listener gone', () => {
	it.skipIf(process.platform === 'win32')('answers false for a socket nobody listens on', () => {
		in_scratch_directory((directory) => {
			const target = path.join(directory, 'stale.sock')

			spawnSync(process.execPath, ['-e', KILLED_LISTENER_SOURCE, target])

			expect(process_identity.is_live_beacon(target)).toBe(false)
		})
	})

	it.skipIf(process.platform === 'win32')(
		'answers undefined for any other connection error',
		() => {
			in_scratch_directory((directory) => {
				const file = path.join(directory, 'not-a-directory')

				writeFileSync(file, '')

				expect(process_identity.is_live_beacon(path.join(file, UNUSED_TARGET))).toBeUndefined()
			})
		},
	)
})

// joshuafolkken/kit#1727: liveness and ownership are different questions, and a record's writer
// answering the first one about itself is what let a replaced supervisor overwrite its successor.
describe('process_identity.is_own_process — whether a record is the caller’s own', () => {
	it('recognizes the pair this process would write', () => {
		const own = process_identity.own_fields()

		expect(process_identity.is_own_process(own.pid, own.process_start)).toBe(true)
	})

	// **The assertion the Issue was filed for.** A successor's record names a process that is
	// unmistakably alive, so every liveness reading of it is `true`; only the identity comparison
	// separates it from this process's own.
	it('refuses a live pid that is not this process', () => {
		expect(process_identity.is_own_process(DEAD_PID, process_identity.own_start())).toBe(false)
	})

	it.skipIf(!has_native_start_probe)(
		'refuses this pid paired with another process’s start time',
		() => {
			expect(process_identity.is_own_process(process.pid, FOREIGN_START)).toBe(false)
		},
	)

	// A record written before the start time existed knows less than this process does, so it is not
	// claimed as this process's — the safe direction, since a refused write costs one pass.
	it.skipIf(!has_start_probe)('refuses a record that carries no start time', () => {
		expect(process_identity.is_own_process(process.pid, undefined)).toBe(false)
	})

	it('refuses a record that names no process at all', () => {
		expect(process_identity.is_own_process(undefined, process_identity.own_start())).toBe(false)
	})
})

describe('process_identity.own_fields — the identity a record carries', () => {
	it('names this process', () => {
		expect(process_identity.own_fields().pid).toBe(process.pid)
	})

	// **Absent rather than `undefined` where the platform cannot answer.** Every reader treats a missing
	// key as "cannot tell", and an explicit `undefined` would be a different thing under
	// `exactOptionalPropertyTypes` while meaning the same thing on disk.
	it('carries a start time exactly when this platform can report one', () => {
		expect(Object.hasOwn(process_identity.own_fields(), 'process_start')).toBe(has_start_probe)
	})

	it.skipIf(!has_start_probe)('carries the start time the probe reports', () => {
		expect(process_identity.own_fields().process_start).toBe(process_identity.own_start())
	})
})
