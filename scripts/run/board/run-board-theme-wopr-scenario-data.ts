// The WINNER table's strategy names for the WARGAMES theme of `run:board` (joshuafolkken/kit#8917),
// ported from the confirmed theme demo (`fixed-v21-theme-wargames.mjs`). A replaceable table: the
// table pages through it in order and rounds again.
// cspell:disable -- the film's strategy names.

// The film's strategy list: the seven read off the user's stills first, then the rest as recalled.
const SCENARIOS: ReadonlyArray<string> = [
	'TAIWAN THEATERWIDE',
	'PACIFIC MANEUVER',
	'PORTUGAL REVOLUTION',
	'ALBANIAN DECOY',
	'CYPRUS MANEUVER',
	'EGYPT MISDIRECTION',
	'BANGLADESH THRUST',
	'U.S. FIRST STRIKE',
	'USSR FIRST STRIKE',
	'NATO / WARSAW PACT',
	'FAR EAST STRATEGY',
	'US USSR ESCALATION',
	'MIDDLE EAST WAR',
	'USSR CHINA ATTACK',
	'INDIA PAKISTAN WAR',
	'MEDITERRANEAN WAR',
	'HONGKONG VARIANT',
	'SEATO DECAPITATING',
	'CUBAN PROVOCATION',
	'ATLANTIC HEAVY',
	'CUBAN PARAMILITARY',
	'NICARAGUAN PREEMPTIVE',
	'PACIFIC TERRITORIAL',
	'BURMESE THEATERWIDE',
	'TURKISH DECOY',
	'ARGENTINA ESCALATION',
	'ICELAND MAXIMUM',
	'ARABIAN THEATERWIDE',
	'U.S. SUBVERSION',
	// Not confirmed against the film: more of the same kind, so the list runs on.
	'SINO SOVIET WAR',
	'KOREAN ESCALATION',
	'BALTIC DECAPITATION',
	'ALASKAN FLANK',
	'EUROPEAN THEATER',
	'GULF STRIKE',
	'AFRICAN SUBVERSION',
	'ATLANTIC BLOCKADE',
	'ARCTIC FIRST STRIKE',
	'PAN ASIAN WAR',
	'INDIAN OCEAN',
	'CARIBBEAN STRIKE',
	'SOUTH ATLANTIC',
	'JAPAN DEFENSE',
	'CANADIAN THEATER',
	'PANAMA CANAL',
	'SOVIET IRAN STRIKE',
	'CHINESE BURMA',
]

const run_board_theme_wopr_scenario_data = { SCENARIOS }

export { run_board_theme_wopr_scenario_data }
