import { run_board_sound_synth } from './run-board-sound-synth'
import { run_board_sound_wav } from './run-board-sound-wav'

const NOTES = [{ pitch: 'C5', ms: 10, wave: 'sine' }] as const
const ARGUMENT_OFFSET = 2

function fail_synthesis(): never {
	throw new Error('Persistent cache unexpectedly synthesized audio')
}

function run(): void {
	const [directory, mode] = process.argv.slice(ARGUMENT_OFFSET)
	if (directory === undefined) throw new Error('Missing cache directory')
	if (mode === 'hit') run_board_sound_synth.samples_of = fail_synthesis
	const file = run_board_sound_wav.cached_wav('process', NOTES, directory)
	if (file === undefined) throw new Error('Audio cache failed')
	process.stdout.write(`${file}\n`)
}

run()
