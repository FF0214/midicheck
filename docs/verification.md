# Verification notes

Recorded 2026-10-21 for the initial 0.1.0 release.

## Automated checks

The 32-test suite, syntax checks and static build passed in the initial release candidate on Node.js 22 and 24, on both GitHub-hosted Ubuntu and Windows runners. [Recorded run](https://github.com/FF0214/midicheck/actions/runs/39617432587). Current commit results are available in [Actions](https://github.com/FF0214/midicheck/actions/workflows/ci.yml).

The suite includes hand-encoded MIDI fixtures and independent reading through `midi-file@1.2.4`, alongside metadata preservation, ambiguous pairing, SMPTE, malformed inputs and CLI overwrite protection. Synthetic stress coverage includes 10,000 unclosed same-pitch notes.

## Browser checks

The following were exercised in the desktop app's Chromium-based browser:

- The public [GitHub Pages app](https://ff0214.github.io/midicheck/) loads its modules and Worker from its repository subpath.
- A real file chooser imports a synthetic 3-track MIDI with 22 notes and four findings, then rejects a malformed 3-byte file with an explanatory error. Switching back to the valid queue entry restores the report.
- Selecting one eligible duplicate produces a preview with 21 notes, three findings and unchanged 8-second duration. The downloaded 330-byte MIDI was read again by this engine and by the independent parser, retaining three tracks. Overlap, pedal and unclosed-note findings remain for manual review.
- JSON export includes both the original report and the selected repair preview. Preview filenames match the MIDI download name.
- English/Chinese switching preserves the selected repair and comparison.
- Enter activates demo/import/preview controls, and Space toggles a repair checkbox.
- At a 390 × 844 viewport, the repaired page has no horizontal document overflow, and comparison text and download controls are visible. A synthetic 10,000-character track name is shortened for display without changing MIDI or JSON metadata.

The final filename and mobile-layout fixes were rechecked in the local production build before publication. Browser checks do not constitute a full accessibility audit or device-browser matrix.

## Still needed

No independent-user adoption, production-song validation, or DAW-wide compatibility is claimed. The most useful next evidence is a redistributable reproduction with source DAW/version, expected behavior and actual result. Planned work is tracked in the [roadmap](../ROADMAP.md).
