#!/bin/sh
# Launch one kit hook: `sh <root>/scripts/hooks/run-hook.sh <name> [arguments...]` is the whole hook
# command (`scripts/init/hook-launch.ts`). Move to the project root this script sits under — into the
# Claude Code worktree the hook was launched in, if any, with the launch directory in `JOSH_HOOK_CWD` —
# clear the git location variables (`GIT_LOCATION_VARIABLES`) when the checkout resolves without them,
# then run `dist/hooks/<name>.js`, or josh with `<name>`'s first `-` as `:`. kit's checkout gates the
# bundles with the built `dist/hooks/ready.js`, or `tools/hooks/hook-bundle-ready.ts` before a first
# build; a built checkout or package first hands `pretool-guard` to its resident daemon (`daemon_answer`). No
# process the shell can do itself, and `if`/`else`
# rather than `&&`/`||`: a guard's refusal is a non-zero exit that must not run the hook twice.

hook_name=$1
shift
case $0 in
/*) hooks_dir=${0%/*} ;;
*/*) hooks_dir=$PWD/${0%/*} ;;
*) hooks_dir=$PWD ;;
esac
package_dir=${hooks_dir%/scripts/hooks}
bundle="$package_dir/dist/hooks/$hook_name.js"
josh_command="${hook_name%%-*}:${hook_name#*-}"

launch_directory=$PWD
cd "${package_dir%/node_modules/*/*}" || exit
# The project's own cache: an installed package's directory may be a read-only store link.
cache_dir=$PWD/node_modules/.cache
# A command from before joshuafolkken/kit#6033 exports the launch directory itself, then moves to the root.
if [ "$launch_directory" != "$PWD" ] || [ -z "$JOSH_HOOK_CWD" ]; then export JOSH_HOOK_CWD="$launch_directory"; fi
worktrees_dir=$PWD/.claude/worktrees/
case $JOSH_HOOK_CWD in
"$worktrees_dir"?*)
	worktree_path=${JOSH_HOOK_CWD#"$worktrees_dir"}
	cd "$worktrees_dir${worktree_path%%/*}" || exit
	;;
*) ;;
esac

location_variables='GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_DIR GIT_INDEX_FILE GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_WORK_TREE'
if [ -n "$GIT_ALTERNATE_OBJECT_DIRECTORIES$GIT_COMMON_DIR$GIT_DIR$GIT_INDEX_FILE$GIT_NAMESPACE$GIT_OBJECT_DIRECTORY$GIT_WORK_TREE" ] &&
	(unset $location_variables && git rev-parse --show-toplevel >/dev/null 2>&1); then
	unset $location_variables
fi

compile_cache="$cache_dir/kit-hook-compile"

# Hand the call to the resident pretool-guard of this checkout (`tools/hooks/hook-daemon.ts`) and exit
# with its answer. Returns, with the payload back on stdin, when there is none — starting one for the
# next call — or it answers `stale` or nothing in time. Each call directory sits beside the daemon's, so
# a daemon that goes never takes a payload with it. The call carries this environment in `env`, one
# `name=value` line per variable with `%` and line breaks escaped, for the daemon to answer under.
daemon_answer() {
	daemon_script=$1
	daemon_key=$(printf '%s\n' "$PWD" | cksum)
	daemons_dir="$cache_dir/kit-hook-daemon"
	daemon_dir="$daemons_dir/${daemon_key%% *}"
	daemon_pid=
	if [ -f "$daemon_dir/pid" ]; then read -r daemon_pid <"$daemon_dir/pid"; fi
	# Trusted only while the pid's command line is this daemon's, so a pid reused after an unclean
	# daemon exit is neither waited on nor stopped.
	case $(ps -ww -o command= -p "${daemon_pid:-0}" 2>/dev/null) in
	*"/daemon.js $daemon_dir") ;;
	*)
		rm -rf "$daemon_dir"
		NODE_COMPILE_CACHE="$compile_cache" node --disable-warning=ExperimentalWarning "$daemon_script" --detach "$daemon_dir" </dev/null >/dev/null 2>&1 &
		return
		;;
	esac
	request=$(mktemp -d "$daemons_dir/call.XXXXXX") || return
	cat >"$request/payload"
	printf '%s' "$JOSH_HOOK_CWD" >"$request/cwd"
	awk 'BEGIN { for (name in ENVIRON) { value = ENVIRON[name]; gsub(/%/, "%25", value); gsub(/\n/, "%0A", value); print name "=" value } }' >"$request/env"
	printf '%s' "$$" >"$request/launcher"
	mkfifo "$request/reply"
	exec 4<>"$request/reply"
	daemon_reply=timeout
	if printf '%s\n' "$request" 2>/dev/null 1<>"$daemon_dir/requests"; then
		(
			trap 'kill $! 2>/dev/null; exit' TERM
			sleep "${JOSH_HOOK_DAEMON_WAIT:-10}" &
			wait $!
			printf 'timeout\n' 1<>"$request/reply"
		) </dev/null >/dev/null 2>&1 4<&- &
		watchdog=$!
		read -r daemon_reply <&4
		kill "$watchdog" 2>/dev/null
	fi
	exec 4<&-
	case $daemon_reply in
	'' | *[!0-9]*) ;;
	*)
		if [ -s "$request/out" ]; then cat "$request/out"; fi
		if [ -s "$request/err" ]; then cat "$request/err" >&2; fi
		rm -rf "$request"
		exit "$daemon_reply"
		;;
	esac
	if [ "$daemon_reply" = timeout ]; then kill "$daemon_pid" 2>/dev/null; fi
	exec 0<"$request/payload"
	rm -rf "$request"
}

daemon="$package_dir/dist/hooks/daemon.js"
if [ "$hook_name" = pretool-guard ] && [ -f "$daemon" ]; then daemon_answer "$daemon"; fi

case $0 in
*node_modules/*)
	if [ -d "$package_dir/dist/hooks" ]; then exec node "$bundle" "$@"; else exec node "$package_dir/dist/josh.js" "$josh_command" "$@"; fi
	;;
*)
	gate="$package_dir/dist/hooks/ready.js"
	if [ ! -f "$gate" ]; then gate="$package_dir/tools/hooks/hook-bundle-ready.ts"; fi
	NODE_COMPILE_CACHE="$compile_cache" exec node --disable-warning=ExperimentalWarning "$gate" "$hook_name" "$josh_command" "$@"
	;;
esac
