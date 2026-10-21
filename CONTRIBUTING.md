# Contributing

Thank you for helping make MIDI handoffs clearer.

## Report a problem

Include app version, browser/OS or Node version, DAW and version (if relevant), expected behavior and actual behavior. A minimal **synthetic** MIDI is ideal. Do not attach unreleased songs, personal paths, copyrighted MIDI or secrets. Confirm that you may redistribute any fixture.

## Development

Node.js 22+; `npm ci --ignore-scripts`, `npm test`, `npm run check`, `npm run build`.

Keep core inspection logic in `src/midi.mjs`, independent of DOM and Node-specific APIs. Browser and CLI must share the same rules. Add a small regression fixture for a meaningful behavior change. Use hand-encoded bytes or document the generator; confirm output with the independent parser when applicable.

Preserve unknown metadata and musical timing. A new repair needs an explanation, an opt-in preview, a counterexample for ambiguity, and a preservation test. Do not silently add network calls, telemetry, uploads or overwrite behavior.

Describe what changed and how it was verified in the PR. AI-assisted contributions are welcome with the same requirements; review generated changes and disclose limitations.
