# Run kit in a cloud session

## When to use it

An agent runs your project in a cloud session or container instead of on your machine.

## Steps

1. Allow the hosts kit needs in the environment's network policy ([the hosts to allow](../cloud-session.md#network-policy--the-hosts-to-allow)).
2. Make sure `gh` is installed; kit's GitHub operations go through it ([why `gh` has to be installed](../cloud-session.md#gh--rest-only-and-it-has-to-be-installed)). It authenticates from `GH_TOKEN`, so no interactive login is needed.
3. Pass notification settings and `JOSH_SESSION_LANG` as environment variables ([environment variables](../cloud-session.md#environment-variables)).
4. Make sure the vulnerability scanner is present with [`josh audit:provision`](../josh-commands.md#josh-auditprovision); the pre-push audit refuses a push without it.

## Check it worked

- `command -v gh` finds `gh`, `josh audit:provision` reports a scanner, and a `git push` succeeds.

## Common failures

- Every `git push` fails: the vulnerability scan cannot reach its host. A blocked host shows up as a `Forbidden` response rather than a network error ([network policy](../cloud-session.md#network-policy--the-hosts-to-allow)).
- The scanner is missing: it is installed at session start; retry with [`josh audit:provision`](../josh-commands.md#josh-auditprovision).
- A command says it could not read the repository from `git remote`: check that `gh` is installed first ([REST does not make `gh` optional](../cloud-session.md#rest-does-not-make-gh-optional)).
- `fullrun` or `backlogrun` cannot merge: without `gh`, pull requests cannot be finalized.
