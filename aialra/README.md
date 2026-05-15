# AIALRA Turn Engine Notes

This fork tracks upstream OpenCode while preserving the AIALRA deployment fixes
that currently power `opencode.aialra.online`.

## Remotes

- `origin`: `https://github.com/AIALRA-0/opencode-turn-engine.git`
- `upstream`: `https://github.com/anomalyco/opencode.git`

## Imported Local Changes

- Fixed the Web app server URL detection so `opencode.aialra.online` no longer
  matches the hosted `opencode.ai` fallback path.
- Imported the local deployment overlay under `aialra/opencode-deployment/`,
  including the form login proxy, SenseNova bridge, runtime package manifest,
  scripts, config templates, and tests.

## Development Rule

Keep upstream OpenCode source changes small and separately reviewable. Put
AIALRA-only operational glue under `aialra/`, unless a fix must live in product
source to keep the deployed workflow correct.
