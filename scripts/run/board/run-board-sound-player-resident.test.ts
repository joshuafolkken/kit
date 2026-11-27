import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
	run_board_sound_player,
	type SoundPorts,
	type StartHandlers,
} from './run-board-sound-player'
import type { ResidentChild, ResidentPorts } from './run-board-sound-resident'

const WAV = '/sounds/chime.wav'
const LENGTH_MS = 100

// eslint-disable-next-line unicorn/prefer-event-target -- stands in for a spawned child, a Node EventEmitter
class FakeChild extends EventEmitter implements ResidentChild {
	readonly stdin = new PassThrough()
	readonly stdout = new PassThrough()
	readonly unref = vi.fn()
	readonly kill = vi.fn()
}

afterEach(() => {
	run_board_sound_player.close()
})

function resident_ports(child: FakeChild): ResidentPorts {
	return { spawner: vi.fn(() => child), length_ms: () => LENGTH_MS, after: vi.fn() }
}

function sound_ports(): SoundPorts & { spawner: ReturnType<typeof vi.fn> } {
	return { spawner: vi.fn(() => new FakeChild()), write: vi.fn() }
}

function handlers(): StartHandlers & { started: Mock<StartHandlers['started']> } {
	return { started: vi.fn<StartHandlers['started']>(), failed: vi.fn() }
}

function prepare_mac(child: FakeChild): void {
	run_board_sound_player.prepare({ platform: 'darwin', ports: resident_ports(child) })
}

describe('run_board_sound_player.prepare', () => {
	it('opens the resident player on a Mac only, and only once', () => {
		const ports = resident_ports(new FakeChild())

		run_board_sound_player.prepare({ platform: 'linux', ports })
		run_board_sound_player.prepare({ platform: 'darwin', ports })
		run_board_sound_player.prepare({ platform: 'darwin', ports })

		expect(ports.spawner).toHaveBeenCalledOnce()
	})
})

describe('run_board_sound_player.start and loop with a resident player', () => {
	it('plays one-shots and loops on the resident player, spawning none', () => {
		const ports = sound_ports()
		const started = handlers()

		prepare_mac(new FakeChild())
		run_board_sound_player.start(WAV, started, { platform: 'darwin', ports })
		run_board_sound_player.loop(WAV, started, { platform: 'darwin', ports })

		expect(started.started).toHaveBeenCalledTimes(2)
		expect(ports.spawner).not.toHaveBeenCalled()
	})

	it('falls back to a player of its own once the resident player is closed', () => {
		const ports = sound_ports()

		prepare_mac(new FakeChild())
		run_board_sound_player.close()
		run_board_sound_player.start(WAV, handlers(), { platform: 'darwin', ports })
		run_board_sound_player.loop(WAV, handlers(), { platform: 'darwin', ports })

		expect(ports.spawner.mock.calls.map(([command]) => command)).toEqual(['afplay', 'osascript'])
	})

	it('ends the resident sounds with every other as the board stops them all', () => {
		const child = new FakeChild()
		const lines: Array<string> = []

		child.stdin.on('data', (chunk: Buffer) => {
			lines.push(chunk.toString())
		})
		prepare_mac(child)
		run_board_sound_player.loop(WAV, handlers(), { platform: 'darwin', ports: sound_ports() })
		run_board_sound_player.stop_all()

		return new Promise<void>((resolve) => {
			setImmediate(() => {
				expect(lines.join('')).toBe(`play 0 1 ${WAV}\nstop 0\n`)
				resolve()
			})
		})
	})
})
