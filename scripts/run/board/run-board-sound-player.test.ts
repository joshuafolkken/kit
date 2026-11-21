import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
	run_board_sound_player,
	type Playing,
	type SoundPorts,
	type SoundSpawner,
	type StartHandlers,
} from './run-board-sound-player'
import { run_board_sound_stream } from './run-board-sound-stream'

const WAV = 'sounds/chime.wav'
const QUOTED_WAV = "C:\\o'clock.wav"
const DETACHED = { detached: true, stdio: 'ignore', windowsHide: true }
const DIRECTORY_PREFIX = 'run-board-sound-player-'
const create_directory = temporary_directory()

afterEach(() => {
	vi.restoreAllMocks()
})

interface FakeChild extends Playing {
	fail: () => void
	unref: Mock<() => unknown>
	kill: Mock<() => unknown>
}

interface Harness {
	ports: SoundPorts
	spawner: Mock<SoundSpawner>
	write: Mock<(text: string) => unknown>
	children: Array<FakeChild>
}

function fake_child(): FakeChild {
	const listeners: Array<() => void> = []

	return {
		on: (_event, listener) => {
			listeners.push(listener)
		},
		unref: vi.fn<() => unknown>(),
		kill: vi.fn<() => unknown>(),
		fail: () => {
			for (const listener of listeners) listener()
		},
	}
}

function harness(): Harness {
	const children: Array<FakeChild> = []
	const spawner = vi.fn<SoundSpawner>(() => {
		const child = fake_child()

		children.push(child)

		return child
	})
	const write = vi.fn<(text: string) => unknown>()

	return { ports: { spawner, write }, spawner, write, children }
}

function fail_child(test: Harness, index: number): void {
	test.children[index]?.fail()
}

describe('run_board_sound_player.play command table', () => {
	it('plays through afplay on macOS', () => {
		const test = harness()

		run_board_sound_player.play(WAV, 'darwin', test.ports)

		expect(test.spawner).toHaveBeenCalledWith('afplay', [WAV], DETACHED)
	})

	it('plays through PowerShell SoundPlayer.PlaySync on Windows, quoting the path', () => {
		const test = harness()

		run_board_sound_player.play(QUOTED_WAV, 'win32', test.ports)

		expect(test.spawner).toHaveBeenCalledWith(
			'powershell',
			[
				'-NoProfile',
				'-Command',
				"(New-Object System.Media.SoundPlayer 'C:\\o''clock.wav').PlaySync()",
			],
			DETACHED,
		)
	})

	it('tries paplay first on Linux', () => {
		const test = harness()

		run_board_sound_player.play(WAV, 'linux', test.ports)

		expect(test.spawner).toHaveBeenCalledExactlyOnceWith('paplay', [WAV], DETACHED)
	})

	it('lists the Linux candidates in order', () => {
		const commands = run_board_sound_player.players_for('linux').map((player) => player.command)

		expect(commands).toStrictEqual(['paplay', 'pw-play', 'aplay'])
	})
})

describe('run_board_sound_player.play fallbacks', () => {
	it('moves on to the next Linux candidate when one is missing', () => {
		const test = harness()

		run_board_sound_player.play(WAV, 'linux', test.ports)
		fail_child(test, 0)

		expect(test.spawner).toHaveBeenLastCalledWith('pw-play', [WAV], DETACHED)
		expect(test.write).not.toHaveBeenCalled()
	})

	it('rings the bell on a platform with no player row', () => {
		const test = harness()

		run_board_sound_player.play(WAV, 'aix', test.ports)

		expect(test.spawner).not.toHaveBeenCalled()
		expect(test.write).toHaveBeenCalledExactlyOnceWith(run_board_sound_player.BEL)
	})

	it('rings the bell when the player fails to start', () => {
		const test = harness()

		run_board_sound_player.play(WAV, 'darwin', test.ports)
		fail_child(test, 0)

		expect(test.write).toHaveBeenCalledExactlyOnceWith(run_board_sound_player.BEL)
	})

	it('rings the bell once every Linux candidate has failed', () => {
		const test = harness()

		run_board_sound_player.play(WAV, 'linux', test.ports)
		fail_child(test, 0)
		fail_child(test, 1)
		fail_child(test, 2)

		expect(test.spawner).toHaveBeenCalledTimes(3)
		expect(test.write).toHaveBeenCalledExactlyOnceWith(run_board_sound_player.BEL)
	})
})

// joshuafolkken/kit#8381: a spawn that throws as it starts never ends the board drawing it.
function throwing(test: Harness): void {
	test.spawner.mockImplementation(() => {
		throw new Error('spawn EMFILE')
	})
}

describe('run_board_sound_player.play a spawn that throws', () => {
	it('rings the bell rather than throwing', () => {
		const test = harness()

		throwing(test)

		expect(() => {
			run_board_sound_player.play(WAV, 'darwin', test.ports)
		}).not.toThrow()
		expect(test.write).toHaveBeenCalledExactlyOnceWith(run_board_sound_player.BEL)
	})

	it('moves on to the next Linux candidate, as a failed start does', () => {
		const test = harness()

		test.spawner.mockImplementationOnce(() => {
			throw new Error('spawn EAGAIN')
		})
		run_board_sound_player.play(WAV, 'linux', test.ports)

		expect(test.spawner).toHaveBeenLastCalledWith('pw-play', [WAV], DETACHED)
		expect(test.write).not.toHaveBeenCalled()
	})
})

describe('run_board_sound_player.play default ports', () => {
	it('rings the bell on the terminal', () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		run_board_sound_player.play(WAV, 'aix')

		expect(write).toHaveBeenCalledExactlyOnceWith(run_board_sound_player.BEL)
		write.mockRestore()
	})
})

describe('run_board_sound_player.play detachment', () => {
	it('returns at once and lets the child go without waiting for it to end', () => {
		const test = harness()

		run_board_sound_player.play(WAV, 'darwin', test.ports)

		const [child] = test.children

		expect(child?.unref).toHaveBeenCalledOnce()
		expect(test.write).not.toHaveBeenCalled()
	})
})

function handlers(): {
	started: Mock<StartHandlers['started']>
	failed: Mock<StartHandlers['failed']>
} {
	return { started: vi.fn<StartHandlers['started']>(), failed: vi.fn<StartHandlers['failed']>() }
}

describe('run_board_sound_player.loop unsupported platform', () => {
	it('reports an unsupported platform without spawning or ringing the bell (ac-fe518468)', () => {
		const test = harness()
		const told = handlers()

		run_board_sound_player.loop(WAV, told, 'aix', test.ports)

		expect(told.failed).toHaveBeenCalledOnce()
		expect(test.spawner).not.toHaveBeenCalled()
		expect(test.write).not.toHaveBeenCalled()
	})
})

describe('run_board_sound_player.loop', () => {
	it('loops within one player without restarting at clip boundaries (ac-036747cc)', () => {
		const test = harness()
		const told = handlers()

		vi.spyOn(run_board_sound_stream, 'ports_for').mockReturnValue(test.ports)

		run_board_sound_player.loop(WAV, told, 'linux', test.ports)

		expect(test.spawner).toHaveBeenCalledExactlyOnceWith(
			'paplay',
			['--raw', '--format=s16le', '--rate=44100', '--channels=1'],
			DETACHED,
		)
		told.started.mock.calls[0]?.[0].kill()
		const [child] = test.children

		expect(child?.kill).toHaveBeenCalledOnce()
	})

	it('stays silent when the loop player is missing (ac-fe518468)', () => {
		const test = harness()
		const told = handlers()

		vi.spyOn(run_board_sound_stream, 'ports_for').mockReturnValue(test.ports)

		run_board_sound_player.loop(WAV, told, 'linux', test.ports)
		fail_child(test, 0)
		fail_child(test, 1)
		fail_child(test, 2)

		expect(told.failed).toHaveBeenCalledOnce()
		expect(test.write).not.toHaveBeenCalled()
		expect(test.spawner).toHaveBeenCalledTimes(3)
	})
})

describe('run_board_sound_player native loops', () => {
	it('uses macOS AVAudioPlayer with indefinite looping', () => {
		const test = harness()

		run_board_sound_player.loop(WAV, handlers(), 'darwin', test.ports)

		const [command, args] = test.spawner.mock.calls[0] ?? []

		expect(command).toBe('osascript')
		expect(args).toContain(WAV)
		expect(args?.join(' ')).toContain('player.numberOfLoops = -1')
	})

	it('uses Windows SoundPlayer with a quoted path and native looping', () => {
		const test = harness()

		run_board_sound_player.loop(QUOTED_WAV, handlers(), 'win32', test.ports)

		const [command, args] = test.spawner.mock.calls[0] ?? []

		expect(command).toBe('powershell')
		expect(args?.join(' ')).toContain("'C:\\o''clock.wav'")
		expect(args?.join(' ')).toContain('$player.PlayLooping()')
	})
})

// joshuafolkken/kit#8250: a start hands back each candidate it starts, so a lasting sound can be ended.
describe('run_board_sound_player.start', () => {
	it('tells each candidate it starts, in order, so the last one started is the one playing', () => {
		const test = harness()
		const told = handlers()

		run_board_sound_player.start(WAV, told, 'linux', test.ports)
		fail_child(test, 0)

		expect(told.started.mock.calls.map(([child]) => child)).toStrictEqual(test.children)
		expect(test.spawner).toHaveBeenLastCalledWith('pw-play', [WAV], DETACHED)
		expect(told.failed).not.toHaveBeenCalled()
	})

	it('reports the failure of every candidate without ringing the bell', () => {
		const test = harness()
		const told = handlers()

		run_board_sound_player.start(WAV, told, 'darwin', test.ports)
		fail_child(test, 0)

		expect(told.failed).toHaveBeenCalledOnce()
		expect(test.write).not.toHaveBeenCalled()
	})

	it('hands back a child the caller can kill', () => {
		const test = harness()
		const told = handlers()

		run_board_sound_player.start(WAV, told, 'darwin', test.ports)
		told.started.mock.calls[0]?.[0].kill()
		const [child] = test.children

		expect(child?.kill).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#7951: the live board's cue port — the cue's cached WAV, played.
describe('run_board_sound_player.play_cue', () => {
	it('plays the cue’s WAV, written into the cache', () => {
		const test = harness()
		const directory = create_directory(DIRECTORY_PREFIX)

		run_board_sound_player.play_cue('launch', 'darwin', test.ports, directory)

		const [command, [file = ''] = []] = test.spawner.mock.calls[0] ?? []

		expect(command).toBe('afplay')
		expect(path.dirname(file)).toBe(directory)
		expect(path.basename(file)).toMatch(/^launch-[\da-f]+\.wav$/u)
		expect(existsSync(file)).toBe(true)
	})

	it('rings the bell when the WAV cannot be written', () => {
		const test = harness()
		const blocked = path.join(create_directory(DIRECTORY_PREFIX), 'file')

		writeFileSync(blocked, '')
		run_board_sound_player.play_cue('launch', 'darwin', test.ports, path.join(blocked, 'sounds'))

		expect(test.spawner).not.toHaveBeenCalled()
		expect(test.write).toHaveBeenCalledWith(run_board_sound_player.BEL)
	})
})
