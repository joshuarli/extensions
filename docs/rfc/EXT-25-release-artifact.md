# EXT-25: Publish a versioned, restorable extension release

Status: draft

## Summary

Build each published extension folder from a named release input, stamp that input into the extension, and retain the folder so the previous release can be restored unchanged.

## Motivation

`extension-suite/src/identity.ts:3` hardcodes `suiteVersion = "0.1.0"`. `.github/workflows/ci.yml` runs tests and lint but packages no release and retains no artifact. `README.md` tells users to load `dist/extension-suite` from a folder supplied by another person and to replace its contents when updating. A published folder has no commit or version provenance. When a build is bad, an operator must rebuild an older commit and hope regenerated assets match.

## Design

Take a git tag as the release input. The build writes that tag and its commit into the generated identity module instead of a hand-edited source constant. Produce one folder per release under a stable name such as `dist/extension-suite`, and retain each published folder with its tag and commit alongside it. Document which folder to load and how to restore the previous one. Keep the pinned manifest key so the extension ID stays stable across releases.

Retention covers the current release and the previous release. Older folders are disposable because git history holds the source.

## Alternatives considered

Bump the source constant by hand: keeps the current shape but still gives no link between a folder and a commit. Publish only the latest folder: removes provenance and makes rollback a rebuild. Add browser auto-update: a larger change that needs its own design and owner decision.

## Open questions

Who is authorized to publish a release. Whether the version comes from a git tag or `package.json`. Where published folders are retained and how many releases stay on hand. Whether publication happens in CI or as a local release command.

## Decision

Pending owner. No code changes are authorized by this draft.
