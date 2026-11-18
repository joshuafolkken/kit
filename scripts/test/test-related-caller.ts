// Who started a `josh test:related` run, for its lane-ledger row (joshuafolkken/kit#7965): `run:chain`
// and the ship's stages name themselves in the environment their children inherit, so a row tells a
// re-run they caused from one started by hand.

const CALLER_ENVIRONMENT = 'JOSH_TEST_RELATED_CALLER'
const MANUAL = 'manual'

function read(): string {
	const caller = process.env[CALLER_ENVIRONMENT]

	return caller === undefined || caller === '' ? MANUAL : caller
}

function environment(caller: string): Record<string, string> {
	return { [CALLER_ENVIRONMENT]: caller }
}

const test_related_caller = { CALLER_ENVIRONMENT, MANUAL, environment, read }

export { test_related_caller }
