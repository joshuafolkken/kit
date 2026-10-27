// **A command line's `--exclude` reaches both unit projects** (joshuafolkken/kit#5105): vitest applies
// the flag to the root config alone, which the inline projects of `tools/test/unit-projects.ts` do not
// inherit, so without this it excluded nothing. `josh test:related` passes it to leave the heavy files
// out of a scoped run. A leaf module, since `vitest.config.ts` imports it.

const EXCLUDE_FLAG = '--exclude'

function cli_excludes(argv: ReadonlyArray<string>): Array<string> {
	return argv.slice(1).filter((_argument, index) => argv[index] === EXCLUDE_FLAG)
}

const vitest_cli_excludes = { EXCLUDE_FLAG, cli_excludes }

export { vitest_cli_excludes }
