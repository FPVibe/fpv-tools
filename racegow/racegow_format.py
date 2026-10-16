#!/usr/bin/env python3
"""Format a RaceGOW/IGOW mini-UTT clip for submission.

Takes a trimmed DVR clip plus the lap-boundary times within it, and burns in:
  - DVR placed left in a 1280x720 frame, right sidebar for the overlays
  - a running M:SS.cc timer zeroed on the first frame of lap 1
  - lap split labels appearing at each crossing
  - a freeze-frame hold at the end so the final time stays on screen
Bottom of the sidebar is left empty for a logo.

Example:
  racegow_format.py clip.mp4 --start 4.20 --laps 11.35 18.57 --end 25.78
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

FONT_ENV = "RACEGOW_FONT"
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
]


def pick_fontspec():
    """drawtext font spec: env override, known paths, else fontconfig name."""
    candidates = ([os.environ[FONT_ENV]] if FONT_ENV in os.environ else []) + FONT_CANDIDATES
    for path in candidates:
        if os.path.isfile(path):
            return f"fontfile={path}"
    return "font=DejaVu Sans"  # resolved via fontconfig when no known .ttf exists


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_streams", "-show_format", path],
        capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    v = next(s for s in data["streams"] if s["codec_type"] == "video")
    a = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    num, den = v["r_frame_rate"].split("/")
    return {
        "fps": float(num) / float(den),
        "rate": v["r_frame_rate"],
        "width": int(v["width"]),
        "height": int(v["height"]),
        "duration": float(data["format"]["duration"]),
        "has_audio": a is not None,
    }


def quantize(t, fps):
    """Snap a time to the nearest frame boundary."""
    return round(t * fps) / fps


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input")
    p.add_argument("--start", type=float, required=True,
                   help="seconds into the clip: first frame of lap 1 (timer zero)")
    p.add_argument("--laps", type=float, nargs=2, required=True, metavar=("L2", "L3"),
                   help="seconds into the clip: lap 2 and lap 3 crossing frames")
    p.add_argument("--end", type=float, required=True,
                   help="seconds into the clip: final crossing frame")
    p.add_argument("--hold", type=float, default=2.0,
                   help="freeze-hold seconds at the end (default 2.0)")
    p.add_argument("-o", "--output", help="output file (default: <input>_racegow.mp4)")
    args = p.parse_args()

    info = probe(args.input)
    fps, dur = info["fps"], info["duration"]

    font_spec = pick_fontspec()
    if font_spec.startswith("font="):
        print(f"note: no known font file found; asking fontconfig for 'DejaVu Sans' "
              f"(set ${FONT_ENV} to a .ttf path to override)")

    if not (0 <= args.start < args.laps[0] < args.laps[1] < args.end < dur):
        sys.exit(f"times must satisfy 0 <= start < l2 < l3 < end < clip duration "
                 f"({dur:.2f}s)")

    out = args.output or (os.path.splitext(args.input)[0] + "_racegow.mp4")
    start, l2, l3, end = (quantize(t, fps)
                          for t in (args.start, args.laps[0], args.laps[1], args.end))

    # Validate after snapping to the frame grid: marks distinct in seconds can
    # land on the same frame (e.g. 1.00 and 1.01 at 30 fps).
    if not (start < l2 < l3 < end):
        sys.exit(f"marks must land on distinct frames in order at {info['rate']} fps "
                 f"(start={start:.5f} l2={l2:.5f} l3={l3:.5f} end={end:.5f})")
    splits = [l2 - start, l3 - l2, end - l3]
    total = end - start
    hold_to = end + args.hold

    # DVR parked left, capped at 960 px wide so the overlays always have a
    # sidebar. Wider sources (e.g. 16:9) shrink to the cap, aspect preserved;
    # narrower ones scale to full 720 height.
    MAX_DVR_W = 960
    sw = round(720 * info["width"] / info["height"])
    if sw > MAX_DVR_W:
        sw = MAX_DVR_W
        sh = round(MAX_DVR_W * info["height"] / info["width"]) & ~1
        scale = f"scale={sw}:{sh}"
    else:
        sw &= ~1  # even width for yuv420p
        scale = f"scale={sw}:720"
    sx = sw + 20

    # Overlay texts via textfiles: drawtext expands %{...} per frame, and
    # textfile content needs no escaping at all (no filter-level parsing).
    s = f"{start:.5f}"
    cs = f"round((t-{s})*100)"
    timer_exp = (f"%{{eif:floor({cs}/6000):d}}:"
                 f"%{{eif:mod(floor({cs}/100),60):d:2}}."
                 f"%{{eif:mod({cs},100):d:2}}")

    texts = [(timer_exp, 44, 24, start)]
    for i, (split, at) in enumerate(zip(splits, [l2, l3, end])):
        texts.append((f"Lap {i + 1}: {split:.2f}", 30, 110 + i * 48, at))

    tmpfiles = []
    draw = ""
    for text, size, y, at in texts:
        tf = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
        tf.write(text)
        tf.close()
        tmpfiles.append(tf.name)
        draw += (f",drawtext={font_spec}:textfile={tf.name}:fontsize={size}:"
                 f"fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8:"
                 f"x={sx}:y={y}:enable='gte(t,{at - 0.001:.5f})'")
    draw = draw.lstrip(",")

    # Trim by frame count (inclusive of the end frame) so the frozen frame
    # shows the exact final time; a duration-based trim drops the end frame.
    end_frames = round(end * fps) + 1
    vf = (f"fps={info['rate']},{scale},pad=1280:720:0:0:black,"
          f"{draw},trim=end_frame={end_frames},"
          f"tpad=stop_duration={args.hold}:stop_mode=clone,setpts=PTS-STARTPTS")

    cmd = ["ffmpeg", "-y", "-i", args.input]
    if info["has_audio"]:
        af = (f"atrim=duration={end_frames / fps:.6f},asetpts=PTS-STARTPTS,"
              f"apad=pad_dur={args.hold}")
        cmd += ["-filter_complex", f"[0:v]{vf}[v];[0:a]{af}[a]",
                "-map", "[v]", "-map", "[a]"]
    else:
        cmd += ["-f", "lavfi", "-t", f"{hold_to}", "-i", "anullsrc=r=44100:cl=mono",
                "-filter_complex", f"[0:v]{vf}[v]",
                "-map", "[v]", "-map", "1:a"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out]

    try:
        subprocess.run(cmd, check=True)
    finally:
        for f in tmpfiles:
            os.unlink(f)

    print(f"\nInput:  {info['width']}x{info['height']} @ {info['rate']} fps, {dur:.2f}s")
    print(f"Output: {out} (1280x720, {hold_to:.2f}s)")
    print("Numbers for the racegow.com form (frame-quantized):")
    for i, sp in enumerate(splits):
        print(f"  Lap {i + 1}: {sp:.2f}")
    print(f"  Total time: {total:.2f}")
    print(f"  Hot lap:    {min(splits):.2f}")


if __name__ == "__main__":
    main()
