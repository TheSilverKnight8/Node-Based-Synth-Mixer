# Notes for Claude Code

`SPEC.md` is Caleb's. It holds what the app does. Follow it and do not add features that are not in it.

- The ideas are Caleb's; the design and implementation are the builder's. When a question is about *what* the app should do and `SPEC.md` does not answer it, ask Caleb before building it.
- This project is independent of Caleb's other projects. The only link is the visual style: the new Shop Manual look, as used in the Engineering Management Portal (cream, navy and red, Norwester headings, staggered stripes). Light mode only.
- Logo rule: the full Croswell Industries logo on Home only; the C mark on every other screen, in the gap left of the bottom stripes.
- Chrome on a computer is the target. Files go through the File System Access API into the folder the user picked (`Synth Studio/Projects`, `Instruments`, `Clips`).
- Every saved file has `format` and `version`. Changing what is saved means raising `FORMAT_VERSION` in `src/lib/files/formats.ts` and teaching `upgrade()` to bring older files forward. Never break old files.
- Projects refer to instruments and clips by ID. A missing file must show a clear message, never a crash.
- The node editor refuses cables that make no sense and refuses loops (Chrome does not mute audio loops; they get loud).
- `npm run typecheck` and `npm run build` must pass.
