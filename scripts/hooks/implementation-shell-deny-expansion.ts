// What every consultation-scope refusal group shares (joshuafolkken/kit#6586): the refusal's shape and
// the word the shell expands before the call, which may spell any write.

type Refusal = string | undefined

// A word the shell expands before the call, so it may spell any subcommand or flag.
const DYNAMIC = /[$`]/u

function is_dynamic(word: string): boolean {
	return DYNAMIC.test(word)
}

function refusal(program: string, word: string): string {
	return `\`${program} ${word}\`, an expansion that may spell a write`
}

const implementation_shell_deny_expansion = { is_dynamic, refusal }

export { implementation_shell_deny_expansion }
export type { Refusal }
