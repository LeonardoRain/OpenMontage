from tools.analysis import cut_refiner
from tools.analysis.scene_detect import SceneDetect
from tools.analysis.video_analyzer import VideoAnalyzer
from tools.base_tool import ToolResult

SCENES = [
    {"index": 0, "start_seconds": 0.0, "end_seconds": 2.0, "duration_seconds": 2.0},
    {"index": 1, "start_seconds": 2.0, "end_seconds": 20.0, "duration_seconds": 18.0},
]


def _setup(monkeypatch, tmp_path, refine_calls):
    monkeypatch.setattr(VideoAnalyzer, "_get_duration", lambda self, p: 20.0)
    monkeypatch.setattr(
        SceneDetect, "execute",
        lambda self, inputs: ToolResult(success=True, data={"scenes": [dict(s) for s in SCENES]}),
    )

    def fake_refine(video_path, scenes, **kw):
        refine_calls.append(video_path)
        return cut_refiner.split_scenes(scenes, {1: [10.0]}), [10.0]

    monkeypatch.setattr(cut_refiner, "refine_scenes", fake_refine)
    monkeypatch.setattr(VideoAnalyzer, "_classify_scene_motion",
                        lambda self, v, s: [{"motion_type": "static_image", "flow_variance": 0.0}] * len(s))
    video = tmp_path / "v.mp4"
    video.write_bytes(b"fake")
    return video


def test_long_scenes_are_refined_by_default(monkeypatch, tmp_path) -> None:
    calls: list = []
    video = _setup(monkeypatch, tmp_path, calls)

    result = VideoAnalyzer().execute({
        "source": str(video), "analysis_depth": "standard", "output_dir": str(tmp_path / "o"),
    })

    assert calls == [str(video)]
    sa = result.data["structure_analysis"]
    assert sa["total_scenes"] == 3
    assert [(s["start_time"], s["end_time"]) for s in sa["scenes"]] == [(0.0, 2.0), (2.0, 10.0), (10.0, 20.0)]
    assert result.data["_analysis_meta"]["refined_cuts"] == [10.0]
    assert "scene_refine" in result.data["_analysis_meta"]["steps_completed"]


def test_refinement_can_be_disabled(monkeypatch, tmp_path) -> None:
    calls: list = []
    video = _setup(monkeypatch, tmp_path, calls)

    result = VideoAnalyzer().execute({
        "source": str(video), "analysis_depth": "standard",
        "refine_long_scenes": False, "output_dir": str(tmp_path / "o"),
    })

    assert calls == []
    assert result.data["structure_analysis"]["total_scenes"] == 2
