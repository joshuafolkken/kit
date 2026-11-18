// The five sound cues `run:board` plays, as note definitions in three tiers (joshuafolkken/kit#7946).
// A rising figure marks a start or a success and a falling one a fault; sine is information, square
// a warning, so a cue tells its tier by ear. When several cues fall due at once, the highest tier sounds.

import { run_board_sound_synth, type Note } from './run-board-sound-synth'

type CueName = 'launch' | 'lane-end' | 'drain' | 'human' | 'alert'
type Tier = 'info' | 'action' | 'alert'

interface Cue {
	readonly tier: Tier
	readonly notes: ReadonlyArray<Note>
}

const { REST } = run_board_sound_synth

// Lowest tier first: a tier outranks every tier before it.
const TIER_ORDER: ReadonlyArray<Tier> = ['info', 'action', 'alert']

const ALERT_REPEATS = 3
// One falling figure of about a second; the trailing rest parts it from the next repeat.
const ALERT_FIGURE: ReadonlyArray<Note> = [
	{ pitch: 'E5', ms: 300, wave: 'square' },
	{ pitch: 'C5', ms: 300, wave: 'square' },
	{ pitch: 'A4', ms: 300, wave: 'square' },
	{ pitch: REST, ms: 100, wave: 'square' },
]

const CUES: Readonly<Record<CueName, Cue>> = {
	launch: {
		tier: 'info',
		notes: [
			{ pitch: 'C5', ms: 120, wave: 'sine' },
			{ pitch: 'G5', ms: 130, wave: 'sine' },
		],
	},
	'lane-end': {
		tier: 'info',
		notes: [
			{ pitch: 'C5', ms: 150, wave: 'sine' },
			{ pitch: 'E5', ms: 150, wave: 'sine' },
			{ pitch: 'G5', ms: 200, wave: 'sine' },
		],
	},
	drain: {
		tier: 'info',
		notes: [
			{ pitch: 'C5', ms: 250, wave: 'sine' },
			{ pitch: 'E5', ms: 250, wave: 'sine' },
			{ pitch: 'G5', ms: 250, wave: 'sine' },
			{ pitch: 'C6', ms: 250, wave: 'sine' },
		],
	},
	human: {
		tier: 'action',
		notes: [
			{ pitch: 'A5', ms: 450, wave: 'triangle' },
			{ pitch: REST, ms: 100, wave: 'triangle' },
			{ pitch: 'A5', ms: 450, wave: 'triangle' },
		],
	},
	alert: {
		tier: 'alert',
		notes: Array.from({ length: ALERT_REPEATS }, () => ALERT_FIGURE).flat(),
	},
}

function rank_of(name: CueName): number {
	return TIER_ORDER.indexOf(CUES[name].tier)
}

// The cue of the highest tier among those due; the first named wins a tie. None due → undefined.
function loudest(names: ReadonlyArray<CueName>): CueName | undefined {
	const top = Math.max(...names.map((name) => rank_of(name)))

	return names.find((name) => rank_of(name) === top)
}

const run_board_sound_cues = { CUES, TIER_ORDER, loudest }

export { run_board_sound_cues }
export type { Cue, CueName, Tier }
