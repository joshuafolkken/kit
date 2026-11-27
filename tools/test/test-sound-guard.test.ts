import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { run_board_sound_player } from '#scripts/run/board/run-board-sound-player'
import {
	run_board_sound_resident,
	type ResidentChild,
	type ResidentPorts,
} from '#scripts/run/board/run-board-sound-resident'
import { temporary_directory } from '#tools/test/temporary-directory'
import { test_network_guard } from '#tools/test/test-network-guard'
import { test_sound_guard } from '#tools/test/test-sound-guard'
import { GUARD_LOG_KEY } from '#tools/test/unit-guard-environment'
import { afterEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#9094: themed board tests started the real sound player through its default ports.
// These cases reach the default for real and point the guard's record at a scratch log, so the refusal
// is observed without failing the run this test is part of.

const TEMP_PREFIX = 'josh-sound-guard-'
const LOG_NAME = 'network-calls.log'
const LENGTH_MS = 100

const make_directory = temporary_directory()

afterEach(() => {
	vi.unstubAllEnvs()
})

function scratch_log(): string {
	const log_file = path.join(make_directory(TEMP_PREFIX), LOG_NAME)

	writeFileSync(log_file, '')
	vi.stubEnv(GUARD_LOG_KEY, log_file)

	return log_file
}

function recorded(log_file: string): Array<string> {
	return test_network_guard.calls_of(readFileSync(log_file, 'utf8'))
}

describe('test_sound_guard', () => {
	it('replaces both default spawners with the blocking one', () => {
		expect(run_board_sound_player.DEFAULT_PORTS.spawner).toBe(test_sound_guard.blocked_spawner)
		expect(run_board_sound_resident.DEFAULT_PORTS.spawner).toBe(test_sound_guard.blocked_spawner)
	})

	it('refuses a player started through the default ports and records the test', () => {
		const log_file = scratch_log()

		expect(run_board_sound_resident.open()).toBeUndefined()
		expect(recorded(log_file)).toEqual([
			expect.stringMatching(/^sound .*test-sound-guard\.test\.ts > .*default ports/u),
		])
	})

	it('throws its message from the blocking spawner', () => {
		scratch_log()

		expect(() => test_sound_guard.blocked_spawner()).toThrow(test_sound_guard.BLOCKED_MESSAGE)
	})

	it('leaves a test that injects its own spawner unblocked', () => {
		const log_file = scratch_log()
		const spawner = vi.fn((): ResidentChild => {
			throw new Error('ENOENT')
		})
		const ports: ResidentPorts = { spawner, length_ms: () => LENGTH_MS, after: vi.fn() }

		run_board_sound_resident.open(ports)

		expect(spawner).toHaveBeenCalledOnce()
		expect(recorded(log_file)).toEqual([])
	})
})
