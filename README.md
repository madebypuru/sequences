# Sequences

Sequences turns images and videos into short animated pieces. It finds the main subject, puts a clean primary block on it, and builds an irregular grid of cells around it on off-white paper. In video the camera follows the subject.

The other cells show the same picture through a shader pane. The label suffix says which one:

| Suffix | Pane |
|---|---|
| none | clean photo |
| `*` | stretch: one row or column smeared across the cell |
| `°` | black and white |
| `#` | reeded glass |
| `@` | the cell's patch turned by quarter turns |
| `/` | a plane hinged on one edge, tilted back |

Each label is two letters and a digit plus that suffix. It prints in black, or in white where the picture under it is dark.

The grid changes on a beat. Some cells change pane and label, crossfading as they do, and now and then a cell splits or two neighbours merge. The primary block stays.

## Finding the subject

`Subject` is empty by default, which finds animals and people first and falls back to the most striking region (a waterfall, a flower). Type what you want (`bee`, `dog, cat`) to pick something else.

The first time, the page downloads two open models from the web (Grounding DINO tiny for objects, ormbg for the outline), about 450 MB, then keeps them cached. This is fast on a Mac's GPU (about half a second per look). Without a GPU it still works but takes many seconds per look. Offline, it uses a simple built-in method that only finds large, contrasting subjects.

## Open it

Open `index.html` in a desktop browser (Chrome, Safari or Firefox). It runs straight from the file. Nothing to install. A built-in demo source plays until you add your own.

## Add sources

Drop images or videos anywhere on the page, or click the drop box to pick files. Several files form a playlist. The piece moves to the next file every few beats (the `Source` slider). `Use demo` clears the playlist.

Videos play muted and loop.

## Controls

- `Aspect` sets the canvas size. 4:5 (1080×1350) is the default. 1:1, 9:16 and 16:9 are also there.
- `Seed` fixes the whole piece. The same seed and settings always give the same frames. `Reroll` picks a new seed.
- `Density` sets how finely the grid is cut.
- `Ragged` sets how many edge cells are left out, so the outline steps in and out.
- `Effects` sets the share of shader panes. The rest show the clean photo.
- `Syllables` lists the letter pairs used in labels, separated by spaces or commas.
- `Tempo` sets frames per beat. Lower is faster.
- `Change` sets the share of cells that change on each beat.
- `Source` sets how many beats each playlist item stays on screen.
- `Length` sets the export length in seconds. Playback loops over the same length.
- `Pause` / `Play` and the scrubber move through the frames.

## Export

- `PNG` saves the current frame.
- `Video` records the full length in real time. It saves MP4 where the browser can record it (recent Chrome and Safari) and WebM otherwise. Keep the tab in front while it records. A hidden or busy tab records slower and the clip comes out longer.
- `Frames` saves every frame as a PNG in a zip. It renders each frame on its own, so the result does not depend on how fast the machine is. Video sources are seeked frame by frame. It loads JSZip from cdnjs the first time, so it needs a network connection.

## For scripts

The page exposes `window.Seq`:

- `Seq.layout(params, rng)` builds the starting cells.
- `Seq.cellsAt(baseCells, params, beat)` returns the cells at a beat.
- `Seq.render(ctx, source, params, frameIndex)` draws one frame.
- `Seq.params` holds the live settings.

`shader.js` holds the panes: one `MODES` row (id, suffix, weight) and one GLSL branch per pane. `subject.js` holds the subject finder (`Subject.detect`, `Subject.tracker`).
