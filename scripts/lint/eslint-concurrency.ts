// The eslint workers a run may use, named by `JOSH_ESLINT_CONCURRENCY` (joshuafolkken/kit#8885).
// Unset, eslint keeps its single worker: each worker builds a typed program of its own, so a lane or
// a smaller runner must not multiply it (`command-memory.ts`, #4582). Kit's CI lint legs name `2`,
// because a change to a module most of the tree imports sends about half their files back to eslint
// (the measurements are on #8885). A value that is not a positive whole number is ignored rather
// than handed to eslint to refuse.
const CONCURRENCY_PATTERN = /^[1-9]\d*$/u

function concurrency_args(value: string | undefined): ReadonlyArray<string> {
	if (value === undefined || !CONCURRENCY_PATTERN.test(value)) return []

	return ['--concurrency', value]
}

function from_environment(): ReadonlyArray<string> {
	return concurrency_args(process.env['JOSH_ESLINT_CONCURRENCY'])
}

const eslint_concurrency = { concurrency_args, from_environment }

export { eslint_concurrency }
