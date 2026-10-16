// **The environment mark that says a parent already holds this process's cores**
// `josh gate` reserves per check and then spawns `pnpm josh lint`. Without
// the mark, that child's own dispatch would claim a second place for the cores its parent already
// holds. Every holder sets it, and every child inherits it through the environment and claims nothing.
const HELD_KEY = 'JOSH_CORE_RESERVED'
const HELD_VALUE = '1'
// The ledger key of the claim a command holds for its children (`core_budget.with_command_reservation`),
// so a child reading the machine can tell that claim's admitted, not-yet-busy weight from running load.
const HELD_RESERVATION_KEY = 'JOSH_CORE_RESERVATION'

function is_held(): boolean {
	return process.env[HELD_KEY] === HELD_VALUE
}

// The ledger key of the one claim a parent command holds for this process, `undefined` where none does.
function held_reservation(): string | undefined {
	const key = process.env[HELD_RESERVATION_KEY] ?? ''

	return key === '' ? undefined : key
}

// A function of its own so the restoring write does not sit after an `await`, where
// `require-atomic-updates` reads any write to `process` as a possible race — the reason `josh.ts`
// gives `record_exit_code`.
function set_held_mark(value: string, reservation: string): void {
	process.env[HELD_KEY] = value
	process.env[HELD_RESERVATION_KEY] = reservation
}

// Marks this process, and every child it spawns, as running inside a held reservation — `reservation`
// names its ledger key where one claim covers them all. The previous values come back afterwards, so a
// nested holder never clears the mark its outer holder set.
async function with_held_mark<T>(run: () => Promise<T>, reservation = ''): Promise<T> {
	const previous = process.env[HELD_KEY] ?? ''
	const previous_reservation = process.env[HELD_RESERVATION_KEY] ?? ''

	set_held_mark(HELD_VALUE, reservation)

	try {
		return await run()
	} finally {
		set_held_mark(previous, previous_reservation)
	}
}

const held_mark = {
	HELD_KEY,
	HELD_RESERVATION_KEY,
	HELD_VALUE,
	held_reservation,
	is_held,
	with_held_mark,
}

export { held_mark }
