import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Spawner, Started } from '#scripts/run/wake/run-wake-caffeinate'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { run_board_sound_player, type SoundPorts } from './run-board-sound-player'

const WAV = 'sounds/chime.wav'
const QUOTED_WAV = "C:\\o'clock.wav"
const DETACHED = { detached: true, stdio: 'ignore' }
const DIRECTORY_PREFIX = 'run-board-sound-player-'
const create_directory = temporary_directory()

interface FakeChild extends Started {
	fail: () => void
	unref: Mock<() => unknown>
}

interface Harness {
	ports: SoundPorts
	spawner: Mock<Spawner>
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
		fail: () => {
			for (const listener of listeners) listener()
		},
	}
}

function harness(): Harness {
	const children: Array<FakeChild> = []
	const spawner = vi.fn<Spawner>(() => {
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

describe('run_board_sound_player.play detachment', () => {
	it('returns at once and lets the child go without waiting for it to end', () => {
		const test = harness()

		run_board_sound_player.play(WAV, 'darwin', test.ports)

		const [child] = test.children

		expect(child?.unref).toHaveBeenCalledOnce()
		expect(test.write).not.toHaveBeenCalled()
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
