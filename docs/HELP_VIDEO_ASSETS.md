# Internal help video assets

The recordings used by `/help` are internal material. This repository is public, so the MP4 files must never be committed, attached to a public release, or placed in `public/`.

Keep the video catalog in `src/lib/help/videos.json` under version control. Before preparing a production release, restore the approved recordings from the private operational backup into `src/assets/help-videos/`, using the filenames in that catalog. The directory is ignored by Git. Do not use `git add -f` for these assets.

`npm run release:prepare -- NEW_OUTPUT_DIRECTORY` checks that every catalog entry has a nonempty local file before creating a release candidate. It includes those files in the private deployment source snapshot. The snapshot and its manifest belong in local/private storage, never in this repository.

A fresh Git checkout does not contain the recordings. Building from Git alone does not produce a complete production release: provision the private assets before building and deploying. In particular, do not merge this change into an automatic deployment flow until that flow also provisions the assets privately. Keep the existing authenticated `/api/help/videos/[id]` delivery path and verify playback after release.
