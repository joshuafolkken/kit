// Whether the running module was built into `dist/` (joshuafolkken/kit#8344). The build defines
// `process.env.JOSH_BUNDLED` as a constant (`BUNDLED_DEFINE`, `build-commands.ts`), so a bundled module
// reads `true` however its process was started. A source module reads the real, unset variable, so it
// reads `false` both under tsx and under `josh-ready`'s in-process fallback, which leaves no flag in
// `process.execArgv`. The variable is replaced at build time and never set, so no child inherits it.
const BUNDLED_VALUE = 'true'
const BUNDLED_VARIABLE = 'process.env.JOSH_BUNDLED'
const BUNDLED_DEFINE = { [BUNDLED_VARIABLE]: JSON.stringify(BUNDLED_VALUE) }

function is_bundled(): boolean {
	return process.env['JOSH_BUNDLED'] === BUNDLED_VALUE
}

const bundle_flag = { BUNDLED_DEFINE, is_bundled }

export { bundle_flag }
