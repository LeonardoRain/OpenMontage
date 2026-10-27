"""Second-pass cut detection for long, near-static scenes.

Global shot detectors (PySceneDetect content/adaptive, FFmpeg scene score)
average change over the whole frame. Title/quote cards that swap only a block
of text on a fixed gradient background barely move that average, so a run of
three cards gets reported as one long "static" shot. This module re-samples
such scenes and looks for localized spikes instead.
"""

from __future__ import annotations

from typing import Iterable, Sequence

import numpy as np

SAMPLE_WIDTH = 180


def _region_diff(a: np.ndarray, b: np.ndarray, grid: int, exclude_bottom: float) -> float:
    """Largest per-cell mean abs diff, ignoring the bottom subtitle band."""
    keep = int(a.shape[0] * (1.0 - exclude_bottom))
    delta = np.abs(a[:keep] - b[:keep])
    rows = np.array_split(delta, grid, axis=0)
    return max(float(cell.mean()) for row in rows for cell in np.array_split(row, grid, axis=1))


def find_subcuts(
    frames: Sequence[tuple[float, np.ndarray]],
    *,
    grid: int = 4,
    exclude_bottom: float = 0.25,
    ratio: float = 6.0,
    floor: float = 8.0,
    min_edge_gap: float = 0.6,
    min_gap: float = 0.8,
) -> list[float]:
    """Timestamps where a localized change spikes above the scene's own baseline."""
    if len(frames) < 3:
        return []
    diffs = [
        (frames[i][0], _region_diff(frames[i - 1][1], frames[i][1], grid, exclude_bottom))
        for i in range(1, len(frames))
    ]
    threshold = max(floor, ratio * float(np.median([d for _, d in diffs])))
    first, last = frames[0][0], frames[-1][0]

    cuts: list[float] = []
    for t, d in diffs:
        if d <= threshold or t - first < min_edge_gap or last - t < min_edge_gap:
            continue
        if cuts and t - cuts[-1] < min_gap:
            continue
        cuts.append(round(t, 3))
    return cuts


def split_scenes(scenes: Iterable[dict], cuts_by_index: dict[int, list[float]]) -> list[dict]:
    """Split scenes at the given cut times; returns new re-indexed scene dicts."""
    out: list[dict] = []
    for pos, scene in enumerate(scenes):
        cuts = sorted(cuts_by_index.get(pos, []))
        start, end = scene["start_seconds"], scene["end_seconds"]
        bounds = [start] + [c for c in cuts if start < c < end] + [end]
        refined = len(bounds) > 2
        for s0, s1 in zip(bounds, bounds[1:]):
            piece = {**scene, "start_seconds": round(s0, 3), "end_seconds": round(s1, 3),
                     "duration_seconds": round(s1 - s0, 3)}
            if refined:
                piece["refined"] = True
            out.append(piece)
    return [{**s, "index": i} for i, s in enumerate(out)]


def _sample_gray(cap, start: float, end: float, fps: float, sample_fps: float) -> list[tuple[float, np.ndarray]]:
    import cv2

    frames = []
    t = start
    while t < end:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ok, frame = cap.read()
        if ok:
            h, w = frame.shape[:2]
            small = cv2.resize(frame, (SAMPLE_WIDTH, int(h * SAMPLE_WIDTH / w)))
            frames.append((round(t, 3), cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)))
        t += 1.0 / sample_fps
    return frames


def refine_scenes(
    video_path: str,
    scenes: list[dict],
    *,
    min_duration: float = 6.0,
    sample_fps: float = 5.0,
    static_ceiling: float = 3.0,
) -> tuple[list[dict], list[float]]:
    """Split long near-static scenes at low-contrast cuts. Returns (scenes, added_cuts)."""
    import cv2

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return scenes, []
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    cuts_by_index: dict[int, list[float]] = {}
    try:
        for pos, scene in enumerate(scenes):
            start, end = scene["start_seconds"], scene["end_seconds"]
            if end - start < min_duration:
                continue
            frames = _sample_gray(cap, start, end, fps, sample_fps)
            if len(frames) < 3:
                continue
            whole = np.median([np.abs(a - b).mean() for (_, a), (_, b) in zip(frames, frames[1:])])
            if whole > static_ceiling:
                continue  # genuinely moving footage; spikes there are action, not cuts
            cuts = find_subcuts(frames)
            if cuts:
                cuts_by_index[pos] = cuts
    finally:
        cap.release()

    added = [c for pos in sorted(cuts_by_index) for c in cuts_by_index[pos]]
    return (split_scenes(scenes, cuts_by_index) if added else scenes), added
