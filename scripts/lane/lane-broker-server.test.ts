import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lane_broker_server } from './lane-broker-server'

// The record naming which process serves a lane's brokered sessions (joshuafolkken/kit#3840).

const state = { directory: '' }

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'lane-broker-server-'))
})

afterEach(() => {
	rmSync(state.directory, { recursive: true, force: true })
})

function response_target(): string {
	return path.join(state.directory, 'response.json')
}

function leave_record(record: unknown): void {
	writeFileSync(lane_broker_server.server_path(response_target()), JSON.stringify(record))
}

describe('lane_broker_server.write / read', () => {
	it('reads back the record this process wrote for the session', () => {
		const session = randomUUID()

		lane_broker_server.write(response_target(), session)

		expect(lane_broker_server.read(response_target(), session)?.pid).toBe(process.pid)
	})

	it('reads a record left for another session as no server', () => {
		lane_broker_server.write(response_target(), randomUUID())

		expect(lane_broker_server.read(response_target(), randomUUID())).toBeUndefined()
	})

	it('reads a missing or malformed record as no server', () => {
		const session = randomUUID()

		expect(lane_broker_server.read(response_target(), session)).toBeUndefined()
		leave_record({ session, pid: process.pid, extra: true })
		expect(lane_broker_server.read(response_target(), session)).toBeUndefined()
	})
})

describe('lane_broker_server.remove', () => {
	it('removes the record beside the response', () => {
		const record = lane_broker_server.server_path(response_target())

		lane_broker_server.write(response_target(), randomUUID())
		lane_broker_server.remove(response_target())

		expect(existsSync(record)).toBe(false)
	})
})

describe('lane_broker_server.is_running / is_serving_process', () => {
	it('reads this process as running and serving', () => {
		const server = { session: randomUUID(), pid: process.pid }

		expect(lane_broker_server.is_running(server)).toBe(true)
		expect(lane_broker_server.is_serving_process(server)).toBe(true)
	})

	it('reads a pid that cannot exist as neither', () => {
		const server = { session: randomUUID(), pid: process_identity_fixture.DEAD_PID }

		expect(lane_broker_server.is_running(server)).toBe(false)
		expect(lane_broker_server.is_serving_process(server)).toBe(false)
	})

	it.skipIf(!process_identity_fixture.has_native_start_probe)(
		'reads a reissued pid as not the serving process',
		() => {
			const server = {
				session: randomUUID(),
				pid: process.pid,
				process_start: process_identity_fixture.FOREIGN_START,
			}

			expect(lane_broker_server.is_serving_process(server)).toBe(false)
		},
	)
})
