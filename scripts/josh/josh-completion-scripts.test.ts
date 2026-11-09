// cspell:words COMPREPLY
import { execaSync } from 'execa'
import { describe, expect, it } from 'vitest'
import { josh_completion_scripts } from './josh-completion-scripts'

// Each shell's own parse-only flag, reading the script from stdin without running it — with the
// startup files skipped, since a developer's `.zshenv` or fish config may run anything, `gh` included.
const SYNTAX_CHECK_FLAGS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
	['zsh', ['-f', '-n']],
	['bash', ['--norc', '-n']],
	['fish', ['--no-config', '--no-execute']],
])

// Stubs for the bash completion run: `josh` and `pnpm` answer a fixed name list, and an earlier
// pnpm completer stands in for pnpm's own so the delegation is visible.
const BASH_STUBS = `
josh() { printf '%s\\n' run:step run:entry gate; }
pnpm() { josh; }
_pnpm_previous() { COMPREPLY=(delegated); }
complete -F _pnpm_previous pnpm
`

function has_shell(shell: string): boolean {
	return !execaSync(shell, ['--version'], { reject: false }).failed
}

// bash-completion 2's lazy loader: no pnpm spec until it runs, then pnpm's own completer.
const BASH_LAZY_STUBS = `
josh() { printf '%s\\n' gate; }
_pnpm_lazy() { COMPREPLY=(lazy); }
_completion_loader() { [[ $1 == pnpm ]] && complete -F _pnpm_lazy pnpm; }
`

function bash_complete(line: string, completer: string, stubs = BASH_STUBS): string {
	const script = josh_completion_scripts.completion_script('bash') ?? ''
	const call = `COMP_LINE='${line}'; COMP_POINT=\${#COMP_LINE}; ${completer}; printf '%s\\n' "\${COMPREPLY[@]}"`
	const result = execaSync('bash', ['--norc', '-c', `${stubs}\n${script}\n${call}`], {
		reject: false,
	})

	return result.stdout
}

describe('josh_completion_scripts.completion_script', () => {
	it.for(josh_completion_scripts.SHELLS)(
		'returns a %s script its shell parses (ac-272accff)',
		(shell, { skip }) => {
			skip(!has_shell(shell), `${shell} is not installed`)

			const script = josh_completion_scripts.completion_script(shell) ?? ''
			const flags = SYNTAX_CHECK_FLAGS.get(shell) ?? []
			const result = execaSync(shell, flags, { input: script, reject: false })

			expect(result.stderr).toBe('')
			expect(result.exitCode).toBe(0)
		},
	)

	it('returns undefined for a shell it has no script for', () => {
		expect(josh_completion_scripts.completion_script('powershell')).toBeUndefined()
	})
})

describe('josh_completion_scripts — the bash script', () => {
	it.runIf(has_shell('bash'))('completes names past a colon for josh and pnpm josh', () => {
		expect(bash_complete('josh run:s', '_josh_complete')).toBe('step')
		expect(bash_complete('josh g', '_josh_complete')).toBe('gate')
		expect(bash_complete('pnpm josh run:e', '_josh_pnpm_complete')).toBe('entry')
	})

	it.runIf(has_shell('bash'))('leaves other pnpm completions to the earlier completer', () => {
		expect(bash_complete('pnpm ins', '_josh_pnpm_complete')).toBe('delegated')
		expect(bash_complete('josh gate ', '_josh_complete')).toBe('')
	})

	it.runIf(has_shell('bash'))('loads a lazily loaded pnpm completer before wrapping it', () => {
		expect(bash_complete('pnpm ins', '_josh_pnpm_complete', BASH_LAZY_STUBS)).toBe('lazy')
	})
})
