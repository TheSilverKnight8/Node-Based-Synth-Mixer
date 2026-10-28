# Custom Synthesizer App: Spec

Owner: Caleb. This document holds the decisions made so far. It does not cover anything Caleb has not decided.

## Working rules for the builder

- Caleb wants a say at every step of design and build. Do not decide open items yourself. Ask him first.
- Do not add features that are not in this document.
- This project is independent. It is not connected to any of Caleb's other projects. The only link is the visual style (see "Visuals").

## What it is

A music composition tool, like MuseScore but without sheet music. Sounds are built in a node-based editor. They are placed on tracks in an arranger. Notes can also be played live on the computer keyboard.

It is a web app, built as a website like the shop manual. It is an installable PWA and is hosted on GitHub Pages, matching the shop manual. Chrome is the browser Caleb will mainly use. Behavior in other browsers is not specified.

## The two editors

### 1. Node editor (builds the sounds)

- A sound is built from modules. Each module is a box with inputs and outputs. The user connects modules with cables.
- Each module has settings (parameters) that can be changed while a note is playing.
- **Free cabling.** The user can place any module anywhere and connect any output to any compatible input.
  - Reject connections that make no sense (for example, an output into another output).
  - Catch or limit feedback loops. A loop can cause a very loud sound.
- A finished sound works like an instrument. Build it once, and any track can use it. Changing the sound in the node editor changes it everywhere it is used.
- A **starter patch** is included so the user does not start on an empty screen: Note input → Oscillator → Filter → Gain → Output, with an Envelope on the Gain.

**First-version modules:**

| Module | Purpose |
|---|---|
| Note input | Receives the note from the keyboard or arranger. Outputs pitch and a gate signal (on while the note is held). Every instrument needs one. |
| Oscillator | The raw tone. Waveforms: sine, square, sawtooth, triangle. |
| Noise | For percussion and breathy sounds. |
| Filter | Low-pass, high-pass, band-pass. |
| Gain | Volume. Several cables into one Gain add together, so it also works as a mixer. |
| Envelope (ADSR) | Shapes how a parameter changes between pressing and releasing a key. |
| LFO | A slow oscillator that wobbles another parameter. |
| Output | End of the chain. |

Left out of the first version: delay, reverb, distortion, stereo panning.

### 2. Arranger (places sounds in time)

- **Tracks:** no limit on the number of tracks. Each track uses one instrument from the node editor.
- Notes are placed on a grid. Each note has a pitch, a start time and a length. This is a piano-roll-style grid with no staff and no sheet music.
- **Grid resolution is adjustable while working.** Triplets are wanted.
- **Time signature is selectable.** The available time signatures are 3/4, 4/4 and 5/4. The time signature can change partway through a piece.
- **Tempo:** a tempo is set for the piece. Tempo changes partway through are optional.
- **Recorded notes snap to the grid.**
- Playback follows the tempo, and all tracks play in sync.
- A placed note can be shifted up or down in pitch from the instrument's default.
- There is no key signature feature.

**Clips**
- A clip is a saved group of notes (pitch, start, length). It is note data, not recorded audio.
- A clip can be reused on any track and plays with that track's instrument.
- Saved clips can be imported into the arranger.

**Modulation tags**
- A tag is a label attached to a placed note or section. It changes the sound automatically while the note plays.
- Tags come from a fixed set that is built into the app. Custom tags are left out of this version.
- A tag affects only the note it is attached to.

| Tag | Effect | Works on |
|---|---|---|
| Vibrato | Pitch wobble | Every instrument |
| Tremolo | Volume wobble | Every instrument |
| Swell | Volume rises over the note | Every instrument |
| Fade out | Volume falls over the note | Every instrument |
| Pitch bend up / down | Pitch slides during the note | Every instrument |
| Filter open / close | Filter cutoff sweeps during the note | Only instruments that contain a Filter |

If a tag cannot act on an instrument (for example, a filter tag on an instrument with no Filter), show it as unavailable in the interface. Do not let it fail silently.

## Live play

- Notes are played with the computer keyboard, using a piano-style layout. One row of letter keys plays the white keys. The row above plays the black keys, in the gaps where a piano has them.
- **Octave shifting:** tapping the left Shift key moves the whole layout down one octave. Tapping the right Shift key moves it up one octave. The shift stays until changed. Notes that are already sounding keep their pitch when the layout shifts.
- Live playing can be recorded into a track. Recorded notes snap to the grid (see above).
- Live play uses the same instruments as the arranger.

## Saving and files

- Chrome is the target. The app uses the File System Access API so it can read and write files directly.
- The user chooses a location once. The app creates its own folder there and keeps all its files in that folder.
- Projects are saved as files in that folder. The app lists them in its own interface, so the user opens a project from inside the app and does not need to find the file manually. This is similar to how MuseScore works.
- Instruments and clips are saved as their own files in the same folder. They are shared across all projects.
- **File format:** projects, instruments and clips are saved as JSON text files. Each file contains a format version number so the app can still open old files after future changes. The builder chooses file names, extensions and folder layout inside the app's folder.
- A project refers to its instruments and clips by name or ID instead of copying them in. This is what makes a change to an instrument appear everywhere it is used. If a referenced instrument or clip file is missing when a project opens, the app shows a clear message and does not crash.
- **Audio export is wanted as a nice-to-have.** The finished music is exported as a WAV file. It is not required for the first version. Render the piece offline, faster than real time, instead of recording playback. MP3 is not included.

## Technical notes (from design discussion)

- The browser's Web Audio API provides the audio engine. It is already a graph of connectable nodes, which matches the node editor.
- Each held note needs its own copy of the instrument's module chain, so several notes can sound at once (polyphony).
- Computer keyboards limit how many keys register at once, and the limit varies by keyboard. Large chords played live may drop notes. This is a hardware limit.
- Two rows of keys cover roughly an octave and a half, so a live chord cannot be wider than the layout. Wider chords are placed in the arranger.
- The browser has no ready-made envelope module. Build the Envelope from scheduled parameter changes.
- Arranger playback should schedule notes slightly ahead of time against the Web Audio clock so timing stays accurate.

## Visuals

Same color scheme and style as the new shop manual (not the old one). Caleb will provide the code, screenshots and a link. Do not guess at the style before receiving them.

## Not decided yet (ask Caleb before deciding)

Nothing is currently open. If a question comes up that this document does not answer, ask Caleb.
