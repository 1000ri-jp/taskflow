# Internal help video assets

The recordings used by `/help` are internal material. This repository is public, so the MP4 files must never be committed, attached to a public release, or placed in `public/`.

Keep the video catalog in `src/lib/help/videos.json` under version control. Before preparing a production release, restore the approved recordings from the private operational backup into `src/assets/help-videos/`, using the filenames and SHA256 digests in that catalog. The directory is ignored by Git. Do not use `git add -f` for these assets. A different nonempty recording is not an approved replacement.

`npm run release:prepare -- NEW_OUTPUT_DIRECTORY` requires a new output directory outside the repository. It rejects missing, empty, symlinked or checksum-mismatched recordings. It copies only cataloged recordings and verifies the actual copied bytes against the approved SHA256, including a second check during copying. It includes the MCP contract generator, MCP runtime modules and Unicode attribution in the private web deployment source snapshot. The snapshot and its manifest belong in local/private storage, never in this repository. A failed preparation without a complete manifest is not a deployable candidate.

A fresh Git checkout does not contain the recordings. Building from Git alone does not produce a complete production release: provision the private assets before building and deploying. In particular, do not merge this change into an automatic deployment flow until that flow also provisions the assets privately. Keep the existing authenticated `/api/help/videos/[id]` delivery path and verify playback after release.

Run `npm run release:test` to verify the preparation gates using fictional recordings. Preservation of the current production behavior and remaining intentional differences are recorded in [PRODUCTION_SOURCE_PRESERVATION.md](PRODUCTION_SOURCE_PRESERVATION.md).
