#!/bin/sh
# Launch one kit hook by name: `sh scripts/hooks/run-hook.sh <name> [arguments...]`
# (joshuafolkken/kit#3184).
#
# A hook command in `.claude/settings.json` / `.codex/hooks.json` only moves to the project root
# (`scripts/init/hook-launch.ts`) and calls this script, so everything every hook shares lives here once:
#
# - The git location variables a git hook exports are cleared when the checkout resolves without
#   them, so the hook's own git calls act on the checkout it stands in, and kept when the git metadata
#   lives outside the work tree. `git` starts only when one of them is set — a hook runs on every tool
#   call (joshuafolkken/kit#3946, joshuafolkken/kit#4187). The list is `GIT_LOCATION_VARIABLES`
#   (`scripts/git/git-location-environment.ts`), held to it by `run-hook.test.ts`.
# - The pre-built bundle `dist/hooks/<name>.js` runs once its gate passes; otherwise the live source
#   runs through josh, whose command is the name with its first `-` turned into `:`
#   (`pretool-guard` → `pretool:guard`).
# - In kit's own checkout the gate is the kit-only `tools/hooks/hook-bundle-ready.ts`, which rebuilds stale bundles
#   (joshuafolkken/kit#2984) — in the background while a stale but whole build runs (joshuafolkken/kit#5628)
#   — and then runs the bundle — or the josh fallback — itself, so a hook call
#   starts node once (joshuafolkken/kit#3327). In an installed package it is a presence check: the
#   published bundles cannot be stale against a source the consumer never edits, and Node strips no
#   types under `node_modules`.
# - In kit's checkout node keeps a compile cache under `node_modules/.cache` (`NODE_COMPILE_CACHE`):
#   the type stripping of the gate's TypeScript is most of its load, and the cache keeps the stripped
#   output and the bundle's compiled code across launches. Node checks each entry against the source,
#   so an edited file is compiled afresh; the bundles' freshness stays the gate's (joshuafolkken/kit#5663).
#   The node processes a hook starts inherit the variable and share the cache, which is safe for the
#   same reason.
# - Nothing is spawned that the shell can do itself: the directory is a parameter expansion rather than
#   `dirname`, and `node` replaces this shell through `exec` rather than running beside it.
# - An `if`/`else`, never `&&`/`||`: a guard's refusal is a non-zero exit, and a chain would read it as
#   a missing bundle and run the hook twice.
# - A hook launched inside one of Claude Code's own worktrees (`EnterWorktree`, an
#   `isolation: "worktree"` subagent) runs in that worktree. Claude Code keeps `CLAUDE_PROJECT_DIR` on
#   the main checkout there, so the prefix lands on it and hands over where the hook was launched in
#   `JOSH_HOOK_CWD` (joshuafolkken/kit#4617). The code still comes from the project root — a fresh
#   worktree has no install and no bundles — so only the working directory moves.

hook_name=$1
shift
case $0 in
/*) hooks_dir=${0%/*} ;;
*/*) hooks_dir=$PWD/${0%/*} ;;
*) hooks_dir=$PWD ;;
esac
package_dir="$hooks_dir/../.."
bundle="$package_dir/dist/hooks/$hook_name.js"
josh_command="${hook_name%%-*}:${hook_name#*-}"

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
	NODE_COMPILE_CACHE="$package_dir/node_modules/.cache/kit-hook-compile" exec node --disable-warning=ExperimentalWarning "$package_dir/tools/hooks/hook-bundle-ready.ts" "$hook_name" "$josh_command" "$@"
	;;
esac
