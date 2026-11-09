// cspell:words compinit compadd compdef COMPREPLY compgen

// The shell completion scripts `josh completion <shell>` prints. Each asks `josh completion --names`
// for the candidates on every completion instead of embedding them, so the command list keeps one
// source. Under `pnpm josh` only the first argument after `josh` is answered here; every other pnpm
// completion stays with the completer that was registered before (zsh and bash wrap it, fish adds to it).
const ZSH_SCRIPT = `# josh completion for zsh — enable after compinit with: eval "$(josh completion zsh)"
_josh_complete_names() {
	local -a names
	names=(\${(f)"$("$@" completion --names 2>/dev/null)"})
	compadd -a names
}
_josh() {
	(( CURRENT == 2 )) && _josh_complete_names josh
}
if [[ \${_comps[pnpm]-} != _josh_pnpm ]]; then
	typeset -g _josh_pnpm_previous=\${_comps[pnpm]-}
fi
_josh_pnpm() {
	if (( CURRENT == 3 )) && [[ \${words[2]} == josh ]]; then
		_josh_complete_names pnpm --silent josh
	elif [[ -n $_josh_pnpm_previous ]]; then
		"$_josh_pnpm_previous" "$@"
	fi
}
compdef _josh josh
compdef _josh_pnpm pnpm`

// bash splits words at the colons in names like \`run:step\`, so the position and the word being
// completed are read from the line itself, and the part before the last colon is trimmed off each reply.
// bash-completion 2 loads pnpm's completer only on its first Tab, which josh's own spec would then
// prevent, so the loader is run first to have a completer to wrap.
const BASH_SCRIPT = `# josh completion for bash — enable with: eval "$(josh completion bash)"
_josh_complete_names() {
	local line=\${COMP_LINE:0:COMP_POINT}
	local current=\${line##* }
	COMPREPLY=($(compgen -W "$("$@" completion --names 2>/dev/null)" -- "$current"))
	COMPREPLY=("\${COMPREPLY[@]#\${current%\${current##*:}}}")
}
_josh_complete() {
	local pattern='^[^ ]+ +[^ ]*$'
	[[ \${COMP_LINE:0:COMP_POINT} =~ $pattern ]] && _josh_complete_names josh
}
_josh_pnpm_complete() {
	local pattern='^[^ ]+ +josh +[^ ]*$'
	if [[ \${COMP_LINE:0:COMP_POINT} =~ $pattern ]]; then
		_josh_complete_names pnpm --silent josh
	elif [[ -n $_josh_pnpm_previous ]]; then
		"$_josh_pnpm_previous" "$@"
	fi
}
if ! complete -p pnpm >/dev/null 2>&1 && declare -F _completion_loader >/dev/null; then
	_completion_loader pnpm
fi
_josh_pnpm_spec=$(complete -p pnpm 2>/dev/null)
_josh_pnpm_pattern='-F ([^ ]+)'
if [[ $_josh_pnpm_spec =~ $_josh_pnpm_pattern && \${BASH_REMATCH[1]} != _josh_pnpm_complete ]]; then
	_josh_pnpm_previous=\${BASH_REMATCH[1]}
fi
unset _josh_pnpm_spec _josh_pnpm_pattern
complete -F _josh_complete josh
complete -o default -F _josh_pnpm_complete pnpm`

const FISH_SCRIPT = `# josh completion for fish — enable with: josh completion fish | source
complete -c josh -f -n '__fish_use_subcommand' -a '(josh completion --names 2>/dev/null)'
complete -c pnpm -f -n 'test (count (commandline -opc)) -eq 2; and test (commandline -opc)[2] = josh' -a '(pnpm --silent josh completion --names 2>/dev/null)'`

const COMPLETION_SCRIPTS: ReadonlyMap<string, string> = new Map([
	['zsh', ZSH_SCRIPT],
	['bash', BASH_SCRIPT],
	['fish', FISH_SCRIPT],
])

function completion_script(shell: string): string | undefined {
	return COMPLETION_SCRIPTS.get(shell)
}

export const josh_completion_scripts = {
	SHELLS: [...COMPLETION_SCRIPTS.keys()],
	completion_script,
}
