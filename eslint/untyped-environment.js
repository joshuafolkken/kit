// joshuafolkken/kit#6768: the switch that has the shared config lint without a TypeScript program
// (`./untyped.js`). Kept apart from that config so the processes that only set it — the edit hook
// and the `eslint_d` launcher — never load `typescript-eslint`, an optional peer of this package.
//
// The switch is an environment variable rather than a second config file because every consumer's
// `eslint.config.js` reaches the shared config through `create_base_config`, and none of them has a
// second file to point a `--config` at. `eslint_d` reads it once: the daemon keeps the environment
// of the process that started it, so whoever starts one sets it.
const ENVIRONMENT_VARIABLE = 'JOSH_ESLINT_UNTYPED'
const ENABLED = '1'

function is_requested(variables) {
	return variables[ENVIRONMENT_VARIABLE] === ENABLED
}

// What a process that starts an edit-time eslint adds to its child's environment.
function environment() {
	return { [ENVIRONMENT_VARIABLE]: ENABLED }
}

export const untyped_environment = { environment, is_requested, ENVIRONMENT_VARIABLE }
