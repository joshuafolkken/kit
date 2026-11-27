// The WINNER table's strategy names for the WARGAMES theme of `run:board` (joshuafolkken/kit#8917). A
// replaceable table: the table pages through it in order and rounds again.
// cspell:disable -- the film's strategy names.

// The names read on the film's frames (joshuafolkken/kit#9137), in the order read.
const READ_ON_FILM: ReadonlyArray<string> = [
	'U.S. FIRST STRIKE',
	'USSR FIRST STRIKE',
	'NATO / WARSAW PACT',
	'FAR EAST STRATEGY',
	'INDIA PAKISTAN WAR',
	'MEDITERRANEAN WAR',
	'HONGKONG VARIANT',
	'SEATO DECAPITATING',
	'ATLANTIC HEAVY',
	'CUBAN PARAMILITARY',
	'MIDDLE EAST HEAVY',
]
// The names read off the user's stills of the film.
const READ_ON_STILLS: ReadonlyArray<string> = [
	'TAIWAN THEATERWIDE',
	'PACIFIC MANEUVER',
	'PORTUGAL REVOLUTION',
	'ALBANIAN DECOY',
	'CYPRUS MANEUVER',
	'EGYPT MISDIRECTION',
	'BANGLADESH THRUST',
]
// Confirmed names only: none recalled, none made up.
const SCENARIOS: ReadonlyArray<string> = [...READ_ON_FILM, ...READ_ON_STILLS]

const run_board_theme_wopr_scenario_data = { SCENARIOS }

export { run_board_theme_wopr_scenario_data }
