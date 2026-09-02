// Whether the rule-compliance measurement is asked for at all (joshuafolkken/kit#1235).
//
// One `josh eval` is five real Claude sessions, and on the tree this shipped from the suite almost
// never reached `held` — so what the gate bought in practice was a wait, paid on every
// distributed-document change, which in this repository is most of them. The measurement is
// therefore **opt-in**: the trigger answers `skip` until this switch turns it on.
//
// **The switch is read here rather than inside `eval-trigger.ts`.** That module decides from the
// changed paths and nothing else, and an environment read folded into it would let one path set
// answer two ways — the property its whole test suite is written against.
//
// **It gates the trigger, never `josh eval` itself.** A person typing `pnpm josh eval` is asking for
// a measurement in so many words, and a switch that swallowed that would leave no way to take one.
const SWITCH_ENV_KEY = 'JOSH_EVAL'

// **Unset is off**, which is the whole point: turning the suite off had to cost nothing on a machine
// that has never heard of the variable, and `.env` is personal and non-committed, so an
// explicit-`off` design would need that line written per machine before the first run behaved as
// asked.
//
// More than one spelling is accepted because the mistake this side is silent: a value meant to
// enable the suite that the list does not recognize reads as off, and off is what the caller already
// had — they would see no measurement and no complaint. The reverse mistake cannot happen, since
// nothing but this list turns it on.
const ENABLED_VALUES: ReadonlyArray<string> = ['on', '1', 'true', 'yes']

const DISABLED_REASON = `the measurement is opt-in and ${SWITCH_ENV_KEY} does not enable it — set ${SWITCH_ENV_KEY}=on to decide from the changed paths again`

function read_switch(): string {
	return (process.env[SWITCH_ENV_KEY] ?? '').trim().toLowerCase()
}

function is_enabled(): boolean {
	return ENABLED_VALUES.includes(read_switch())
}

const eval_switch = {
	DISABLED_REASON,
	ENABLED_VALUES,
	is_enabled,
	read_switch,
	SWITCH_ENV_KEY,
}

export { eval_switch }
