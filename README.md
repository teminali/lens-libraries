# Lens libraries

The engines Lens Code does not carry inside itself. Lens Code installs a library on the computer the first time a feature needs it, keeps it up to date in the
background, and lists it in **Settings > Libraries**, where you can see what is installed and what is outdated, update or remove any of them, and turn
updates off for one.

| Library | What it does |
|---|---|
| `ocr` | Reads the words in a picture (used when you ask Lens to copy a screenshot). Self-contained: its own runtime and models. |
| `fonts` | 49 open-licence (SIL OFL) type families from google/fonts as woff2, each with its licence. A family a page names is installed into that project, so it shows the real face offline. |

## How Lens Code trusts what it downloads

- The list of libraries (`libraries.json`, on the release tagged `index`) is accepted only when `libraries.json.sig` verifies against the public key built into
  Lens Code (ed25519). A list signed by anything else is ignored.
- Each archive must be exactly the size and sha256 the signed list names, and come from this repository's releases over https.
- A library that has its own program is asked for its version before it is used; the previous version is kept, so one that misbehaves can be rolled back.

## Publishing

A version of a library is a release tagged `<id>-v<version>` with one archive per platform (`darwin-arm64`, `linux-x64`, `windows-x64`, ... or `any`).

```sh
libraries/ocr/build.sh 1.0.0                     # builds dist/ocr-1.0.0-darwin-arm64.tar.gz on a Mac with Apple silicon
node tools/publish.js ocr 1.0.0 darwin-arm64=dist/ocr-1.0.0-darwin-arm64.tar.gz
node tools/publish.js                            # re-sign and re-publish the index alone
```

The index is signed on the publishing computer with the key in `~/.lens-libraries/signing-key.pem` (or `LIBRARIES_SIGNING_KEY_FILE`); the key is never
committed and never stored on GitHub.
