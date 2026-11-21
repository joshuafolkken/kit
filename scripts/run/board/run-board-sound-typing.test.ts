import { readFileSync } from 'node:fs'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { run_board_sound_player, type Playing } from './run-board-sound-player'
import { run_board_sound_synth, type Note } from './run-board-sound-synth'
import { run_board_sound_typing, type TypingPorts } from './run-board-sound-typing'
import { run_board_sound_wav } from './run-board-sound-wav'

const { HEADER_BYTES, SAMPLE_RATE } = run_board_sound_wav
const { NAME, NOTES, TELETYPE, TRILL_PAIRS, typing_sound } = run_board_sound_typing
const WAV = 'sounds/teletype.wav'
const MS_PER_SECOND = 1000
const FADE_MS = 5
const PAIR_MS = 50
const TOLERANCE = 0.01
const B_FLAT_5 = 932.33
const D_6 = 1174.66
const CLIP_SECONDS = 8
const create_directory = temporary_directory()

interface FakePlayer extends Playing {
	exit: (code?: number | null) => void
	kill: Mock<() => unknown>
}

interface Harness {
	ports: TypingPorts
	start: Mock<TypingPorts['start']>
	file: Mock<TypingPorts['file']>
	players: Array<FakePlayer>
}

function fake_player(): FakePlayer {
	const exits: Array<(code?: number | null) => void> = []

	return {
		on: (event, listener) => {
			if (event === 'exit') exits.push(listener)
		},
		unref: vi.fn<() => unknown>(),
		kill: vi.fn<() => unknown>(),
		exit: (code = 0) => {
			for (const listener of exits) listener(code)
		},
	}
}

function harness(): Harness {
	const players: Array<FakePlayer> = []
	const start = vi.fn<TypingPorts['start']>((_file, handlers) => {
		const player = fake_player()

		players.push(player)
		handlers.started(player)
	})
	const read = vi.fn<TypingPorts['file']>(() => WAV)

	return { ports: { file: read, start }, start, file: read, players }
}

function first_player(test: Harness): FakePlayer | undefined {
	const [player] = test.players

	return player
}

// The WAV the trill is cached as, its samples read back past the header.
function written_samples(): Int16Array {
	const file = run_board_sound_wav.cached_wav(NAME, NOTES, create_directory('run-board-typing-'))
	const bytes = readFileSync(file ?? '')
	const data = bytes.subarray(HEADER_BYTES)

	return new Int16Array(data.buffer, data.byteOffset, data.length / Int16Array.BYTES_PER_ELEMENT)
}

function note_of(index: number): Note {
	const note = TELETYPE[index]

	if (note === undefined) throw new Error(`no teletype note ${String(index)}`)

	return note
}

function note_length(note: Note): number {
	return run_board_sound_synth.samples_of([note], SAMPLE_RATE).length
}

// A rising zero crossing just before `index`, placed between its two samples by linear interpolation.
function crossing_at(samples: Int16Array, index: number): number | undefined {
	const before = samples[index - 1] ?? 0
	const after = samples[index] ?? 0

	return before < 0 && after >= 0 ? index - 1 + before / (before - after) : undefined
}

function rising_crossings(samples: Int16Array): Array<number> {
	return Array.from({ length: samples.length - 1 }, (_value, offset) =>
		crossing_at(samples, offset + 1),
	).filter((crossing) => crossing !== undefined)
}

// A tone's frequency from its rising crossings, the faded edges left out.
function frequency_in(samples: Int16Array): number {
	const fade = Math.round((FADE_MS * SAMPLE_RATE) / MS_PER_SECOND)
	const crossings = rising_crossings(samples.subarray(fade, samples.length - fade))
	const first = crossings[0] ?? 0
	const last = crossings.at(-1) ?? 0

	return ((crossings.length - 1) * SAMPLE_RATE) / (last - first)
}

function within(measured: number, expected: number): boolean {
	return Math.abs(measured - expected) / expected <= TOLERANCE
}

describe('run_board_sound_typing WAV', () => {
	it('doubles the clip to approximately eight seconds (ac-a2637e92)', () => {
		const seconds = written_samples().length / SAMPLE_RATE

		expect(within(seconds, CLIP_SECONDS)).toBe(true)
	})
	it('sounds B♭5 then D6, each within 1%', () => {
		const samples = written_samples()
		const [low, high] = [note_of(0), note_of(1)]
		const low_length = note_length(low)
		const pair_length = low_length + note_length(high)
		const low_hz = frequency_in(samples.subarray(0, low_length))
		const high_hz = frequency_in(samples.subarray(low_length, pair_length))

		expect(within(low_hz, B_FLAT_5)).toBe(true)
		expect(within(high_hz, D_6)).toBe(true)
	})

	it('takes 50 ms a pair and repeats the pair through the whole file', () => {
		const pair_ms = TELETYPE.reduce((total, note) => total + note.ms, 0)
		const pair_length = TELETYPE.reduce((total, note) => total + note_length(note), 0)

		expect(pair_ms).toBe(PAIR_MS)
		expect(Math.abs(pair_length - (PAIR_MS * SAMPLE_RATE) / MS_PER_SECOND)).toBeLessThanOrEqual(1)
		expect(written_samples()).toHaveLength(pair_length * TRILL_PAIRS)
	})
})

describe('run_board_sound_typing.typing_sound', () => {
	it('starts one player however many times it is switched on', () => {
		const test = harness()
		const sound = typing_sound(test.ports)

		sound.set(true)
		sound.set(true)

		expect(test.start).toHaveBeenCalledExactlyOnceWith(WAV, expect.any(Object))
	})

	it('kills the player once when switched off, and a second off does nothing', () => {
		const test = harness()
		const sound = typing_sound(test.ports)

		sound.set(true)
		sound.set(false)
		sound.set(false)

		expect(first_player(test)?.kill).toHaveBeenCalledOnce()
	})
})

describe('run_board_sound_typing.typing_sound player ends', () => {
	it('never restarts an ended stream while still on (ac-036747cc)', () => {
		const test = harness()
		const sound = typing_sound(test.ports)

		sound.set(true)
		first_player(test)?.exit()

		expect(test.start).toHaveBeenCalledOnce()
		expect(test.file).toHaveBeenCalledOnce()
	})
})

describe('run_board_sound_typing.typing_sound default ports', () => {
	it('plays the cached teletype WAV through the sound player by default', () => {
		const cached = vi.spyOn(run_board_sound_wav, 'cached_wav').mockReturnValue(WAV)
		const start = vi.spyOn(run_board_sound_player, 'loop').mockReturnValue(undefined)

		typing_sound().set(true)

		expect(cached).toHaveBeenCalledWith(NAME, NOTES)
		expect(start).toHaveBeenCalledWith(WAV, expect.anything())
		vi.restoreAllMocks()
	})

	// joshuafolkken/kit#8365: the wargames voice is the teletype WAV the trill always sounded.
	it('voices the teletype as the same cached notes WAV (ac-0f2189dd)', () => {
		const cached = vi.spyOn(run_board_sound_wav, 'cached_wav').mockReturnValue(WAV)

		expect(run_board_sound_typing.teletype_wav()).toBe(WAV)
		expect(cached).toHaveBeenCalledExactlyOnceWith(NAME, NOTES)
		vi.restoreAllMocks()
	})

	it('plays another voice through the sound player, keeping the switch rules', () => {
		const start = vi.spyOn(run_board_sound_player, 'loop').mockReturnValue(undefined)
		const sound = typing_sound(run_board_sound_typing.voiced(() => 'click.wav'))

		sound.set(true)
		sound.set(true)
		expect(start).toHaveBeenCalledExactlyOnceWith('click.wav', expect.anything())
		vi.restoreAllMocks()
	})
})

describe('run_board_sound_typing.typing_sound exited player', () => {
	it('keeps the current player when an older player exits (ac-ebfbdd99)', () => {
		const test = harness()
		const sound = typing_sound(test.ports)

		sound.set(true)
		sound.set(false)
		sound.set(true)
		first_player(test)?.exit()
		sound.stop()

		expect(test.players[1]?.kill).toHaveBeenCalledOnce()
	})

	it('does not kill a player that already exited (ac-ebfbdd99)', () => {
		const test = harness()
		const sound = typing_sound(test.ports)

		sound.set(true)
		first_player(test)?.exit()
		sound.set(false)

		expect(first_player(test)?.kill).not.toHaveBeenCalled()
	})
})

describe('run_board_sound_typing.typing_sound late player', () => {
	it.each(['started', 'failed'] as const)(
		'ignores an old %s after typing restarts (ac-ebfbdd99)',
		(event) => {
			const test = harness()
			const old_player = fake_player()

			test.start.mockImplementationOnce(() => undefined)
			const sound = typing_sound(test.ports)

			sound.set(true)
			sound.set(false)
			sound.set(true)
			test.start.mock.calls[0]?.[1][event](old_player)
			sound.stop()

			expect([
				first_player(test)?.kill.mock.calls.length,
				old_player.kill.mock.calls.length,
			]).toStrictEqual([1, event === 'started' ? 1 : 0])
		},
	)

	it('kills a late player after typing stops (ac-ebfbdd99)', () => {
		const test = harness()
		const player = fake_player()

		test.start.mockImplementation(() => undefined)
		const sound = typing_sound(test.ports)

		sound.set(true)
		sound.stop()
		test.start.mock.calls[0]?.[1].started(player)

		expect(player.kill).toHaveBeenCalledOnce()
	})
})

describe('run_board_sound_typing.typing_sound player fails', () => {
	it('starts nothing again when the player exits with a failure while on', () => {
		const test = harness()
		const sound = typing_sound(test.ports)

		sound.set(true)
		first_player(test)?.exit(1)

		expect(test.start).toHaveBeenCalledOnce()
	})

	it('starts nothing when a killed player ends', () => {
		const test = harness()
		const sound = typing_sound(test.ports)

		sound.set(true)
		sound.set(false)
		first_player(test)?.exit()

		expect(test.start).toHaveBeenCalledOnce()
	})

	it('kills the player on stop and stays silent after', () => {
		const test = harness()
		const sound = typing_sound(test.ports)

		sound.set(true)
		sound.stop()
		sound.set(true)

		expect(first_player(test)?.kill).toHaveBeenCalledOnce()
		expect(test.start).toHaveBeenCalledOnce()
	})
})

describe('run_board_sound_typing.typing_sound failures', () => {
	it('stays silent when the WAV cannot be written', () => {
		const test = harness()

		typing_sound({ ...test.ports, file: () => undefined }).set(true)

		expect(test.start).not.toHaveBeenCalled()
	})

	it('holds no player once every candidate failed, so switching off kills nothing', () => {
		const start = vi.fn<TypingPorts['start']>((_file, handlers) => {
			handlers.failed()
		})
		const sound = typing_sound({ file: () => WAV, start })

		sound.set(true)

		expect(() => {
			sound.set(false)
		}).not.toThrow()
		expect(start).toHaveBeenCalledOnce()
	})
})
