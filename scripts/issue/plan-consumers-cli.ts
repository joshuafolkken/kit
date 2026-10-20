import { plan_consumers } from '#scripts/issue/plan-consumers'

// `josh plan:consumers <identifier...>` — prints each identifier's existing references and the draft
// of a plan's existing-consumers section (`plan-consumers.ts`). A flag is refused rather than searched
// for, since an identifier never starts with `-`.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh plan:consumers <identifier...>'

function identifiers_of(argv: ReadonlyArray<string>): Array<string> | undefined {
	const identifiers = [...new Set(argv.map((argument) => argument.trim()))]

	if (identifiers.length === 0) return undefined

	return identifiers.some((identifier) => identifier === '' || identifier.startsWith('-'))
		? undefined
		: identifiers
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const identifiers = identifiers_of(argv)

	if (identifiers === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const { text, has_failed } = await plan_consumers.report(identifiers)

	console.info(text)

	return has_failed ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

const plan_consumers_cli = { USAGE, run }

export { plan_consumers_cli }
