// **A followup a ship runs carries `SHIPPED_ENVIRONMENT`** (joshuafolkken/kit#5696), so it prints no
// section of its own: the ship's governs it. Kept apart from `followup-section.ts`, so the ship's sync
// sets it without the section printer's imports (joshuafolkken/kit#5987).

const SHIP_FOLLOWUP_KEY = 'JOSH_SHIP_FOLLOWUP'
const SHIP_FOLLOWUP_ON = '1'
const SHIPPED_ENVIRONMENT: Readonly<Record<string, string>> = {
	[SHIP_FOLLOWUP_KEY]: SHIP_FOLLOWUP_ON,
}

function is_ship_run(source: NodeJS.ProcessEnv): boolean {
	return source[SHIP_FOLLOWUP_KEY] === SHIP_FOLLOWUP_ON
}

const followup_ship_environment = { SHIPPED_ENVIRONMENT, is_ship_run }

export { followup_ship_environment }
