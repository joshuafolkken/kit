// joshuafolkken/kit#8505: a board setting named by its flag, else by its environment variable — the
// theme (`--theme`, `JOSH_BOARD_THEME`) and the icons (`--icons`, `JOSH_BOARD_ICONS`) read alike: the
// flag wins, an empty variable is unset, and a name the setting does not have is refused.

interface OptionSpec<Name extends string> {
	flag: string
	// joshuafolkken/kit#8915: none where the flag alone sets it (`--sound`), so no variable is read.
	env?: string | undefined
	noun: string
	names: ReadonlyArray<Name>
	// joshuafolkken/kit#8917: the name another one given stands for — an alias read as the name it names
	// where the option is parsed, so the board holds only `names`; none takes each name as it is.
	aliases?: ReadonlyMap<string, Name> | undefined
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
	variable: string | undefined,
): Named {
	const name = variable === undefined ? undefined : environment[variable]

	return { name: name === '' ? undefined : name, argv: [...argv] }
}

// The setting's name `name` is or stands for; none where it is neither.
function named_of<Name extends string>(name: string, spec: OptionSpec<Name>): Name | undefined {
	return spec.names.find((candidate) => candidate === name) ?? spec.aliases?.get(name)
}

// The name the flag gives, else the variable's, an alias read as the name it stands for, with the
// arguments left; `undefined` for a name the setting does not have.
function choose<Name extends string>(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
	spec: OptionSpec<Name>,
): Chosen<Name> | undefined {
	const { name, argv: rest } =
		from_flag(argv, spec.flag) ?? from_environment(argv, environment, spec.env)

	if (name === undefined) return { name: undefined, argv: rest }
	const found = named_of(name, spec)

	return found === undefined ? undefined : { name: found, argv: rest }
}

// The line that names the variable where it, not the flag, gave the name `choose` refused.
function refusal<Name extends string>(
	argv: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
	spec: OptionSpec<Name>,
): string {
	if (argv.includes(spec.flag) || spec.env === undefined) return ''
	const given = environment[spec.env] ?? ''

	return `${spec.env}=${given} names no ${spec.noun} (${spec.names.join(', ')})\n`
}

const run_board_option = { choose, refusal }

export { run_board_option }
export type { OptionSpec }
