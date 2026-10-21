# MIDI Check

**Understand a MIDI file before you change it.** A local-first inspection tool for musicians, arrangers and people working with generated or exported MIDI.

[简体中文](docs/README.zh-CN.md) · [Checks and limitations](docs/diagnostics.md) · [Contributing](CONTRIBUTING.md)

## What it does

- Open multiple `.mid` / `.midi` files, inspect them in a queue, and visualize notes on a piano roll.
- Locate exact duplicate note pairs, same-pitch overlaps, unclosed notes, orphan note-offs, zero-length notes, pedal state and missing end-of-track markers.
- Explain each observation with track, channel, pitch, tick and estimated seconds.
- Preview **explicitly selected** repairs and download a separate MIDI copy.
- Export a structured JSON report. English and Simplified Chinese interfaces.
- Read and inspect files from a dependency-free Node.js command-line tool.

The web app never uploads MIDI or calls an AI service. It has no analytics, accounts, remote fonts or runtime dependencies. Processing happens in a Web Worker. Files and reports are not persisted between page loads.

**An overlap is not automatically an error.** MIDI note pairing can be ambiguous. See the [diagnostic policy](docs/diagnostics.md) before using repair functions.

## Try locally

Requires Node.js 22 or newer. The app itself requires no package installation.

```sh
git clone https://github.com/FF0214/midicheck.git
cd midicheck
npm run build
npm run dev
```

Open the Local URL printed by the server (normally `http://127.0.0.1:4173`). Choose **Explore the demo** to inspect an original synthetic example. The four-bar demo is intentionally not a clean MIDI file: it contains a duplicate, overlap, hanging note and held pedal.

Do not open `index.html` directly with `file://`; browsers restrict module workers in that context.

## Command line

```sh
node cli.mjs song.mid
node cli.mjs song.mid --json
node cli.mjs song.mid --repair-copy song.checked.mid
```

Inspection is read-only by default. `--repair-copy` applies every currently eligible exact-duplicate/EOT repair to a **new** output path and prints the applied changes. It refuses to overwrite any existing file, including the input. Use the browser app when you want to select individual repairs first.

The MIDI engine is also an ES module:

```js
import { parseMidi, inspectMidi, repairMidi } from './src/midi.mjs';

const midi = parseMidi(bytes);
const report = inspectMidi(midi);
// Review report.issues, then pass only the IDs you explicitly selected:
const result = repairMidi(midi, selectedIssueIds);
```

## Scope

- Standard MIDI File formats **0 and 1**; PPQ and SMPTE timing (including 29.97 drop-frame).
- Maximum 20 MiB, 500,000 events and 4,096 tracks per file. Browser queue: 8 files / 40 MiB total.
- SMF 2, UMP/MIDI 2.0 clips, RIFF/RMID, SysEx dump files and malformed event streams are rejected.
- Notes pair FIFO within each **track + port + channel + pitch**. Cross-track interpretation is not reconstructed.
- Exact-duplicate note repairs are blocked for shared channels, overlapping third-party notes or CC messages in their span. Other note findings stay manual.
- Channel data, lyrics, unknown meta-events, SysEx payloads and non-track chunks retain their bytes and tick positions when rewritten. Running status may be expanded; a repaired file need not be byte-identical.
- Text is displayed as UTF-8. Legacy encodings may look wrong; payload bytes are retained.
- Conflicting simultaneous tempo messages are disclosed. Duration uses the last event in track order and is an estimate.

## Development and verification

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run build
```

The sole development dependency is [`midi-file`](https://github.com/carter-thaxton/midi-file), used as an independent parser in interoperability tests. It is not shipped with the browser app. Tests cover hand-encoded SMF fixtures, malformed inputs, note-pairing ambiguity, metadata retention, tempo maps, SMPTE, bounded dense inputs and CLI overwrite protection.

This project was developed with AI assistance. Automated tests do not establish compatibility with every DAW or validate a composition's musical quality. Reproducible, minimal bug reports are particularly welcome.

## Contributing

Good first contributions include real-world, redistributable MIDI reproductions; interoperability reports from DAWs; and improved explanations or translations. Please use synthetic examples whenever possible and do not upload unpublished songs or files without permission. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. The built-in synthetic demo is additionally dedicated to the public domain under CC0-1.0. No commercial MIDI or audio is bundled.
