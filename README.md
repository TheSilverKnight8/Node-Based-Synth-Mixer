# Node-Based-Synth-Mixer
A node based synth mixer and arranger

**Synth Studio** is a music composition tool without sheet music. Build sounds from modules in a node editor, place notes for them on tracks in an arranger, and play them live on the computer keyboard.

It is an installable web app (PWA) for Chrome on a computer, hosted on GitHub Pages. Everything runs in the browser; files are saved in a folder you choose.

## What is in it

| Area | What it does |
| --- | --- |
| Node editor | Modules (Note input, Oscillator, Noise, Filter, Gain, Envelope, LFO, Output) connected with cables. Cables that make no sense, and loops, are refused with the reason. Settings change while notes play. New instruments start from the starter patch. |
| Live play | Home row (A S D F G H J K L ; ') plays the white keys from C; W E T Y U O P play the black keys. Left Shift: octave down, Right Shift: octave up. Held notes keep their pitch when the octave changes. |
| Arranger | Any number of tracks, one instrument each. Piano-roll grid with 1/2 to 1/32 and triplets. 3/4, 4/4 and 5/4, changeable from any bar; tempo, changeable from any bar. Playback scheduled on the Web Audio clock. Recording from the computer keyboard, snapped to the grid. |
| Clips | Save selected notes as a clip, place it on any track (it plays with that track's instrument), move it, shift its pitch. |
| Modulation tags | Vibrato, Tremolo, Swell, Fade out, Bend up / down, Filter open / close, on notes or placed clips. A tag that cannot act on the track's instrument is shown as unavailable, with the reason. |
| Files | Projects, instruments and clips are JSON files with a format version. Projects refer to instruments and clips by ID, so editing an instrument changes it everywhere. Missing files show a clear message. Changes save by themselves. |
| WAV export | Renders the whole piece offline, faster than real time, to a 16-bit stereo WAV. |

## Run it on your computer

Needs Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173) in Chrome.

## Put it online (GitHub Pages)

1. Push this project to a **public** GitHub repository (Pages is free for public repositories).
2. **Settings > Pages > Build and deployment > Source**: choose **GitHub Actions**.
3. Push to `main`. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds and publishes the app to `https://<your-username>.github.io/<repo-name>/`.

To install it: open the site in Chrome and use the install button in the address bar.

## Where your files go

The first time, the app asks for a location and makes a folder called **Synth Studio** there:

```
Synth Studio/
  Projects/      My Song (k3j9a2b8c1).json
  Instruments/   Bass (q8w1e5r7t2).json
  Clips/         Riff (z0r11hs1ku).json
```

The part in brackets is the ID that projects use to find instruments and clips. Renaming something renames its file; the ID stays.

Chrome asks again for permission to use the folder when the app opens. Choose **Allow on every visit** so it stops asking (Chrome 122 and newer).

## Project layout

```
src/
  lib/audio/     modules, cabling rules, voices, engine, playback, offline render, tags
  lib/files/     folder access, file formats and versions
  lib/           music timing (bars, tempo, grid), live keyboard, app state and saving
  editor/        node editor
  arranger/      tracks, piano roll, transport, inspector
  pages/         Home, Instruments, Project
  components/    app frame, dialogs, keyboard strip, shared pieces
```

Built with React, TypeScript, Vite, Tailwind CSS and vite-plugin-pwa, and the Web Audio API. Headings use Norwester by Jamie Wilson (SIL Open Font License, `src/assets/fonts/`).
