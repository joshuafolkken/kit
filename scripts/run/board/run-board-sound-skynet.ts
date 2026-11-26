import { run_board_sound_shape } from './run-board-sound-shape'

// The skynet theme's voices (joshuafolkken/kit#8917): a hard, high square blip a letter, one low buzz
// as a line ends, and a two-tone alarm three times over, quickly, for the NOTICE.

const { silence, tone, voice_wav } = run_board_sound_shape

const BLIP_HZ = 2400
const BLIP_MS = 12
const BLIP_PEAK = 0.12
const BUZZ_HZ = 110
const BUZZ_MS = 260
const BUZZ_PEAK = 0.15
// The alarm: a high tone, a lower one, a short gap; three times.
const ALARM_HIGH_HZ = 1000
const ALARM_LOW_HZ = 750
const ALARM_TONE_MS = 90
const ALARM_GAP_MS = 40
const ALARM_REPEATS = 3
const ALARM_PEAK = 0.12

function blip(): Array<number> {
	return tone({ hz: BLIP_HZ, ms: BLIP_MS, wave: 'square' })
}

function buzz(): Array<number> {
	return tone({ hz: BUZZ_HZ, ms: BUZZ_MS, wave: 'square' })
}

function alarm(): Array<number> {
	const figure = [
		...tone({ hz: ALARM_HIGH_HZ, ms: ALARM_TONE_MS, wave: 'square' }),
		...tone({ hz: ALARM_LOW_HZ, ms: ALARM_TONE_MS, wave: 'square' }),
		...silence(ALARM_GAP_MS),
	]

	return Array.from({ length: ALARM_REPEATS }, () => figure).flat()
}

function typing_wav(letter_ms: number, directory?: string): string | undefined {
	const voice = { name: 'skynet-typing', peak: BLIP_PEAK, part: blip }

	return run_board_sound_shape.typing_wav(voice, letter_ms, directory)
}

function typed_wav(directory?: string): string | undefined {
	return voice_wav({ name: 'skynet-typed', key: '', peak: BUZZ_PEAK, render: buzz }, directory)
}

function notice_wav(directory?: string): string | undefined {
	return voice_wav({ name: 'skynet-notice', key: '', peak: ALARM_PEAK, render: alarm }, directory)
}

const run_board_sound_skynet = { alarm, blip, buzz, notice_wav, typed_wav, typing_wav }

export { run_board_sound_skynet }
