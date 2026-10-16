#!/bin/sh
# Launch one kit hook by name: `sh scripts/hooks/run-hook.sh <name> [arguments...]`
# (joshuafolkken/kit#3184).
#
# A hook command in `.claude/settings.json` / `.codex/hooks.json` only moves to the project root
# (`scripts/init/hook-launch.ts`) and calls this script, so everything every hook shares lives here once:
#
# - The root prefix has already cleared the git location variables a git hook exports, or kept them
#   when the checkout needs them; this script starts no `git` of its own (joshuafolkken/kit#3946).
# - The pre-built bundle `dist/hooks/<name>.js` runs once its gate passes; otherwise the live source
#   runs through josh, whose command is the name with its first `-` turned into `:`
#   (`pretool-guard` → `pretool:guard`).
# - In kit's own checkout the gate is `hook-bundle-ready.ts`, which rebuilds stale bundles
#   (joshuafolkken/kit#2984) and then runs the bundle — or the josh fallback — itself, so a hook call
#   starts node once (joshuafolkken/kit#3327). In an installed package it is a presence check: the
#   published bundles cannot be stale against a source the consumer never edits, and Node strips no
#   types under `node_modules`.
# - Nothing is spawned that the shell can do itself: the directory is a parameter expansion rather than
#   `dirname`, and `node` replaces this shell through `exec` rather than running beside it.
# - An `if`/`else`, never `&&`/`||`: a guard's refusal is a non-zero exit, and a chain would read it as
#   a missing bundle and run the hook twice.

hook_name=$1
shift
case $0 in
*/*) hooks_dir=${0%/*} ;;
*) hooks_dir=. ;;
esac
package_dir="$hooks_dir/../.."
bundle="$package_dir/dist/hooks/$hook_name.js"
josh_command="${hook_name%%-*}:${hook_name#*-}"

case $0 in
*node_modules/*)
	if [ -d "$package_dir/dist/hooks" ]; then exec node "$bundle" "$@"; else exec node "$package_dir/dist/josh.js" "$josh_command" "$@"; fi
	;;
*)
	exec node --disable-warning=ExperimentalWarning "$hooks_dir/hook-bundle-ready.ts" "$hook_name" "$josh_command" "$@"
	;;
esac
