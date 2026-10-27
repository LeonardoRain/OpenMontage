import numpy as np

from tools.analysis.cut_refiner import find_subcuts, split_scenes

H, W = 160, 90


def _frame(title: int = 0, subtitle: int = 0, noise_seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(noise_seed)
    img = np.full((H, W), 200.0) + rng.normal(0, 0.3, (H, W))
    if title:
        img[40:70, 15:75] = 60.0 + title  # centered title text block
    if subtitle:
        img[135:145, 25:65] = 40.0 + subtitle  # subtitle band near the bottom
    return img


def _timeline(spec):
    return [(i * 0.2, _frame(*s, noise_seed=i)) for i, s in enumerate(spec)]


def test_detects_title_card_swap_on_static_background() -> None:
    spec = [(0, 0)] * 15 + [(50, 0)] * 15 + [(120, 0)] * 15
    cuts = find_subcuts(_timeline(spec))
    assert cuts == [3.0, 6.0]


def test_ignores_subtitle_changes_in_bottom_band() -> None:
    spec = [(50, 0)] * 10 + [(50, 30)] * 10 + [(50, 0)] * 10
    assert find_subcuts(_timeline(spec)) == []


def test_ignores_steady_noise() -> None:
    assert find_subcuts(_timeline([(50, 0)] * 40)) == []


def test_skips_cuts_too_close_to_scene_edges() -> None:
    spec = [(0, 0)] * 2 + [(80, 0)] * 30
    assert find_subcuts(_timeline(spec)) == []


def test_split_scenes_reindexes_and_preserves_bounds() -> None:
    scenes = [
        {"index": 0, "start_seconds": 0.0, "end_seconds": 2.0, "duration_seconds": 2.0},
        {"index": 1, "start_seconds": 2.0, "end_seconds": 20.0, "duration_seconds": 18.0},
        {"index": 2, "start_seconds": 20.0, "end_seconds": 22.0, "duration_seconds": 2.0},
    ]
    out = split_scenes(scenes, {1: [10.6, 17.7]})

    assert [s["index"] for s in out] == [0, 1, 2, 3, 4]
    assert [(s["start_seconds"], s["end_seconds"]) for s in out] == [
        (0.0, 2.0), (2.0, 10.6), (10.6, 17.7), (17.7, 20.0), (20.0, 22.0),
    ]
    assert out[2]["duration_seconds"] == 7.1
    assert out[2]["refined"] is True
    assert "refined" not in out[0]
    assert scenes[1]["end_seconds"] == 20.0  # input not mutated
