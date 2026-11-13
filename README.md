# Lens libraries

The engines Lens Code does not carry inside itself. Lens Code installs a library on the computer the first time a feature needs it, keeps it up to date in the
background, and lists it in **Settings > Libraries**, where you can see what is installed and what is outdated, update or remove any of them, and turn
updates off for one.

| Library | What it does |
|---|---|
| `cutout` | Takes pictures apart for a page copied from a screenshot: lifts a subject off its background, cleans a photo's design layer (plate), finds the images and the words the picture's edge cuts (inventory). |
| `fonts` | 49 open-licence (SIL OFL) type families from google/fonts as woff2, each with its licence. A family a page names is installed into that project, so it shows the real face offline. |
| `llama` | Runs the voice model on this computer (llama.cpp's server, b11960). |
| `lfm3-omni` | The voice model: hears, rewrites, answers and speaks for voice in Lens Code. LFM3-Omni-2B (Liquid AI). |

## How Lens Code trusts what it downloads

- The list of libraries (`libraries.json`, on the release tagged `index`) is accepted only when `libraries.json.sig` verifies against the public key built into
  Lens Code (ed25519). A list signed by anything else is ignored.
- Each archive must be exactly the size and sha256 the signed list names, and come from this repository's releases over https.
- A library that has its own program is asked for its version before it is used; the previous version is kept, so one that misbehaves can be rolled back.

## Publishing

A version of a library is a release tagged `<id>-v<version>` with one archive per platform (`darwin-arm64`, `linux-x64`, `windows-x64`, ... or `any`).

```sh
node libraries/lfm3-omni/build.js 1.0.0 --from ~/.cache/lens-models/lfm3-omni   # builds the voice model archive (checked by size and sha256)
node tools/publish.js lfm3-omni 1.0.0 any=~/.cache/lens-models/dist/lfm3-omni-1.0.0-any.tar.gz
node tools/publish.js                            # re-sign and re-publish the index alone
```

The index is signed on the publishing computer with the key in `~/.lens-libraries/signing-key.pem` (or `LIBRARIES_SIGNING_KEY_FILE`); the key is never
committed and never stored on GitHub.
