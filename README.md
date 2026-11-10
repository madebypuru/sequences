# Sequences

Sequences turns images and videos into short animated pieces. The source shows through an irregular grid of cells on off-white paper. Each cell carries a small label: two letters, then a digit. A digit followed by `*` marks a stretch cell, which shows one line of the source smeared across the whole cell instead of the photo. Labels print in black, or in white where the picture under them is dark.

The grid changes on a beat. Some cells change mode and label, and now and then a cell splits or two neighbours merge. Stretch cells scan slowly across the source between beats.

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
- `Stretch` sets the share of stretch cells.
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

To add a new way for a cell to show the source, add one entry to `MODES` in `index.html` with a `mark`, a `weight` and a `draw` function.
