#!/bin/sh
# Launch one kit hook by name: `sh scripts/hooks/run-hook.sh <name> [arguments...]`
# (joshuafolkken/kit#3184).
#
# A hook command in `.claude/settings.json` / `.codex/hooks.json` only moves to the project root
# (`scripts/init/hook-launch.ts`) and calls this script, so everything every hook shares lives here once:
#
# - The git location variables a git hook exports are cleared when the root resolves without them, so
#   the hook's own git calls act on the checkout it stands in. They are kept when the checkout needs
#   them — git metadata outside the work tree.
# - The pre-built bundle `dist/hooks/<name>.js` runs once its gate passes; otherwise the live source
#   runs through josh, whose command is the name with its first `-` turned into `:`
#   (`pretool-guard` → `pretool:guard`).
# - In kit's own checkout the gate is `hook-bundle-ready.ts`, which rebuilds stale bundles
#   (joshuafolkken/kit#2984) and then runs the bundle — or the josh fallback — itself, so a hook call
#   starts node once (joshuafolkken/kit#3327). In an installed package it is a presence check: the
#   published bundles cannot be stale against a source the consumer never edits, and Node strips no
#   types under `node_modules`.
# - An `if`/`else`, never `&&`/`||`: a guard's refusal is a non-zero exit, and a chain would read it as
#   a missing bundle and run the hook twice.

location_variables='GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_DIR GIT_INDEX_FILE GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_WORK_TREE'
unset_options=''
for variable in $location_variables; do unset_options="$unset_options -u $variable"; done
# shellcheck disable=SC2086
if env $unset_options git rev-parse --show-toplevel >/dev/null 2>&1; then unset $location_variables; fi

hook_name=$1
shift
hooks_dir=$(dirname "$0")
package_dir="$hooks_dir/../.."
bundle="$package_dir/dist/hooks/$hook_name.js"
josh_command="${hook_name%%-*}:${hook_name#*-}"

case $0 in
*node_modules/*)
	if [ -d "$package_dir/dist/hooks" ]; then node "$bundle" "$@"; else node "$package_dir/dist/josh.js" "$josh_command" "$@"; fi
	;;
*)
	node --disable-warning=ExperimentalWarning "$hooks_dir/hook-bundle-ready.ts" "$hook_name" "$josh_command" "$@"
	;;
esac
