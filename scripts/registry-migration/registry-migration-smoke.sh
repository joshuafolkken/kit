#!/usr/bin/env bash
# Smoke run of the published npm migration entry against a throwaway copy of a consumer (#7447).
# Every command runs under `env -i` with an isolated HOME, cache and store, so no user setting or
# token leaks in. The source repository is only cloned from; nothing is written back to it.
# Procedure and recorded evidence: docs/maintainers/registry-migration-smoke.md.
set -euo pipefail

readonly NPM_REGISTRY='https://registry.npmjs.org'
readonly TRACKED_FILES=(.npmrc package.json pnpm-lock.yaml)

usage() {
	cat >&2 <<'EOF'
usage: registry-migration-smoke.sh <command> <work-dir> [args...]
  entry <work-dir> <kit-version>              fetch the published tarball, check its sha512, extract the entry
  copy <work-dir> <name> <source-repo> <ref>  clone a consumer into <work-dir>/<name> with no remote
  run <work-dir> <name> <command...>          run a command in the copy under the isolated environment
  hash <work-dir> <name>                      print sha256 of .npmrc, package.json and pnpm-lock.yaml
EOF
	exit 1
}

tool_dir() {
	local tool
	tool="$(type -P "$1")" || {
		echo "$1 is not on PATH" >&2
		exit 1
	}
	dirname "$tool"
}

isolated() {
	local work="$1" tool_path="$2"
	shift 2
	mkdir -p "$work/home" "$work/xdg/cache" "$work/xdg/config" "$work/xdg/data" "$work/xdg/state"
	env -i \
		PATH="$tool_path:/usr/bin:/bin:/usr/sbin:/sbin" \
		HOME="$work/home" \
		XDG_CACHE_HOME="$work/xdg/cache" \
		XDG_CONFIG_HOME="$work/xdg/config" \
		XDG_DATA_HOME="$work/xdg/data" \
		XDG_STATE_HOME="$work/xdg/state" \
		npm_config_cache="$work/xdg/cache/npm" \
		npm_config_store_dir="$work/xdg/data/pnpm-store" \
		CI=1 \
		"$@"
}

entry() {
	local work="$1" version="$2"
	local dir="$work/entry"
	mkdir -p "$dir"
	curl -fsS "$NPM_REGISTRY/@joshuafolkken%2fkit/$version" -o "$dir/metadata.json"
	local tarball integrity actual
	tarball="$(sed -n 's/.*"tarball":"\([^"]*\)".*/\1/p' "$dir/metadata.json")"
	integrity="$(sed -n 's/.*"integrity":"\([^"]*\)".*/\1/p' "$dir/metadata.json")"
	curl -fsS "$tarball" -o "$dir/kit.tgz"
	actual="sha512-$(openssl dgst -sha512 -binary "$dir/kit.tgz" | base64 | tr -d '\n')"
	echo "tarball: $tarball"
	echo "integrity: $integrity"
	if [[ "$actual" != "$integrity" ]]; then
		echo "sha512 mismatch: $actual" >&2
		exit 1
	fi
	tar -xzf "$dir/kit.tgz" -C "$dir" package/dist/registry-migrate.mjs
	echo "entry: $dir/package/dist/registry-migrate.mjs"
}

copy() {
	local work="$1" name="$2" source="$3" ref="$4"
	git clone --quiet --no-hardlinks "$source" "$work/$name"
	git -C "$work/$name" checkout --quiet "$ref"
	git -C "$work/$name" remote remove origin
	echo "copy: $work/$name @ $(git -C "$work/$name" rev-parse --short HEAD)"
}

run() {
	local work="$1" name="$2"
	shift 2
	# Resolved here, outside the `|| status=$?` below that turns off `set -e`, so a missing tool stops
	# the run. pnpm's directory comes first, so a pinned pnpm put first on PATH wins over one beside node.
	local pnpm_dir node_dir status=0
	pnpm_dir="$(tool_dir pnpm)"
	node_dir="$(tool_dir node)"
	(cd "$work/$name" && isolated "$work" "$pnpm_dir:$node_dir" "$@") || status=$?
	echo "exit: $status ($*)"
}

hash() {
	local work="$1" name="$2"
	(cd "$work/$name" && shasum -a 256 "${TRACKED_FILES[@]}" 2>&1 || true)
}

[[ "$#" -ge 2 ]] || usage
command="$1"
# The work directory is made absolute once, so `run` still finds it after `cd` into the copy.
mkdir -p "$2"
work_dir="$(cd "$2" && pwd -P)"
shift 2
set -- "$work_dir" "$@"
case "$command" in
	entry) [[ "$#" -eq 2 ]] || usage; entry "$@" ;;
	copy) [[ "$#" -eq 4 ]] || usage; copy "$@" ;;
	run) [[ "$#" -ge 3 ]] || usage; run "$@" ;;
	hash) [[ "$#" -eq 2 ]] || usage; hash "$@" ;;
	*) usage ;;
esac
