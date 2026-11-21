import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	run_board_sound_player,
	type Playing,
	type SoundPorts,
	type SoundSpawner,
	type StartHandlers,
} from './run-board-sound-player'
import { run_board_sound_stream } from './run-board-sound-stream'
import { run_board_sound_wav } from './run-board-sound-wav'

// joshuafolkken/kit#8365: the Linux loop players take raw PCM with the WAV header stripped, so each
// is told the rate the header records — the matrix click is 48 kHz, and a fixed 44.1 kHz would play
// it slow and flat, behind the letters.

const CLICK_RATE = 48_000
const RAW = '--raw'
const MONO = '--channels=1'
const RATE_FLAG = `--rate=${String(CLICK_RATE)}`
const DIRECTORY_PREFIX = 'run-board-sound-player-rate-'
const create_directory = temporary_directory()

afterEach(() => {
	vi.restoreAllMocks()
})

function rated_wav(rate: number): string {
	const file = path.join(create_directory(DIRECTORY_PREFIX), 'loop.wav')

	writeFileSync(file, run_board_sound_wav.wav_of(new Int16Array(1), rate))

	return file
}

// Every candidate spawned, each failing at once so the next one is tried.
function failing_ports(): { ports: SoundPorts; spawner: ReturnType<typeof vi.fn<SoundSpawner>> } {
	const spawner = vi.fn<SoundSpawner>((): Playing => ({
		on: (event, listener) => {
			if (event === 'error') listener()
		},
		unref: () => undefined,
		kill: () => undefined,
	}))
	const ports: SoundPorts = { spawner, write: vi.fn() }

	vi.spyOn(run_board_sound_stream, 'ports_for').mockReturnValue(ports)

	return { ports, spawner }
}

function handlers(): StartHandlers {
	return { started: vi.fn(), failed: vi.fn() }
}

describe('run_board_sound_player.loop raw rate', () => {
	it('tells each raw player the rate the WAV header records', () => {
		const { ports, spawner } = failing_ports()

		run_board_sound_player.loop(rated_wav(CLICK_RATE), handlers(), 'linux', ports)

		expect(spawner.mock.calls.map(([, args]) => args)).toStrictEqual([
			[RAW, '--format=s16le', RATE_FLAG, MONO],
			[RAW, '--format=s16', RATE_FLAG, MONO, '-'],
			['-t', 'raw', '-f', 'S16_LE', '-r', String(CLICK_RATE), '-c', '1'],
		])
	})

	it('stays silent when the WAV header cannot be read', () => {
		const { ports, spawner } = failing_ports()
		const told = handlers()
		const missing = path.join(create_directory(DIRECTORY_PREFIX), 'missing.wav')

		run_board_sound_player.loop(missing, told, 'linux', ports)

		expect(told.failed).toHaveBeenCalledOnce()
		expect(spawner).not.toHaveBeenCalled()
		expect(ports.write).not.toHaveBeenCalled()
	})
})
