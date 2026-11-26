// The five sound cues `run:board` plays, as note definitions in three tiers (joshuafolkken/kit#7946).
// When several cues fall due at once, the highest tier sounds.

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

// joshuafolkken/kit#8917: the board in no theme sounds as plainly as it draws — a small, short click as
// a row or a progress line shows (the info tier), soft rising notes as a notice shows (the action and
// alert tiers, the alert a step higher). A themed board plays none of these: its score sounds instead.
const CLICK: ReadonlyArray<Note> = [{ pitch: 'C7', ms: 12, wave: 'sine' }]

const CUES: Readonly<Record<CueName, Cue>> = {
	launch: { tier: 'info', notes: CLICK },
	'lane-end': { tier: 'info', notes: CLICK },
	drain: { tier: 'info', notes: CLICK },
	human: {
		tier: 'action',
		notes: [
			{ pitch: 'E5', ms: 120, wave: 'sine' },
			{ pitch: REST, ms: 40, wave: 'sine' },
			{ pitch: 'A5', ms: 180, wave: 'sine' },
		],
	},
	alert: {
		tier: 'alert',
		notes: [
			{ pitch: 'G5', ms: 120, wave: 'sine' },
			{ pitch: REST, ms: 40, wave: 'sine' },
			{ pitch: 'C6', ms: 180, wave: 'sine' },
		],
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
