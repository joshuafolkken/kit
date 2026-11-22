// joshuafolkken/kit#8505: a board setting named by its flag, else by its environment variable — the
// theme (`--theme`, `JOSH_BOARD_THEME`) and the icons (`--icons`, `JOSH_BOARD_ICONS`) read alike: the
// flag wins, an empty variable is unset, and a name the setting does not have is refused.

interface OptionSpec<Name extends string> {
	flag: string
	env: string
	noun: string
	names: ReadonlyArray<Name>
}

interface Named {
	name: string | undefined
	argv: Array<string>
}

interface Chosen<Name extends string> {
	name: Name | undefined
	argv: Array<string>
}

// `<flag> <name>` and the arguments left without it; a flag with no name names `''`, which no setting has.
function from_flag(argv: ReadonlyArray<string>, flag: string): Named | undefined {
	const at = argv.indexOf(flag)

	if (at === -1) return undefined

	return {
		name: argv[at + 1] ?? '',
		argv: argv.filter((_, index) => index !== at && index !== at + 1),
	}
}

function from_environment(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
	variable: string,
): Named {
	const name = environment[variable]

	return { name: name === '' ? undefined : name, argv: [...argv] }
}

// The name the flag gives, else the variable's, with the arguments left; `undefined` for a name the
// setting does not have.
function choose<Name extends string>(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
	spec: OptionSpec<Name>,
): Chosen<Name> | undefined {
	const { name, argv: rest } =
		from_flag(argv, spec.flag) ?? from_environment(argv, environment, spec.env)

	if (name === undefined) return { name: undefined, argv: rest }
	const found = spec.names.find((candidate) => candidate === name)

	return found === undefined ? undefined : { name: found, argv: rest }
}

// The line that names the variable where it, not the flag, gave the name `choose` refused.
function refusal<Name extends string>(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
	spec: OptionSpec<Name>,
): string {
	if (argv.includes(spec.flag)) return ''
	const given = environment[spec.env] ?? ''

	return `${spec.env}=${given} names no ${spec.noun} (${spec.names.join(', ')})\n`
}

const run_board_option = { choose, refusal }

export { run_board_option }
export type { OptionSpec }
