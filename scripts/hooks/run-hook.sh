#!/bin/sh
# Launch one kit hook: `sh <root>/scripts/hooks/run-hook.sh <name> [arguments...]` is the whole hook
# command (`scripts/init/hook-launch.ts`). Move to the project root this script sits under — into the
# Claude Code worktree the hook was launched in, if any, with the launch directory in `JOSH_HOOK_CWD` —
# clear the git location variables (`GIT_LOCATION_VARIABLES`) when the checkout resolves without them,
# then run `dist/hooks/<name>.js`, or josh with `<name>`'s first `-` as `:`. kit's checkout gates the
# bundles with the built `dist/hooks/ready.js`, or `tools/hooks/hook-bundle-ready.ts` before a first
# build. No process the shell can do itself, and `if`/`else`
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

case $0 in
*node_modules/*)
	if [ -d "$package_dir/dist/hooks" ]; then exec node "$bundle" "$@"; else exec node "$package_dir/dist/josh.js" "$josh_command" "$@"; fi
	;;
*)
	gate="$package_dir/dist/hooks/ready.js"
	if [ ! -f "$gate" ]; then gate="$package_dir/tools/hooks/hook-bundle-ready.ts"; fi
	NODE_COMPILE_CACHE="$package_dir/node_modules/.cache/kit-hook-compile" exec node --disable-warning=ExperimentalWarning "$gate" "$hook_name" "$josh_command" "$@"
	;;
esac
