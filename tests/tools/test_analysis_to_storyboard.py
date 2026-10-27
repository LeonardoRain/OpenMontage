import json
import subprocess
from pathlib import Path

from tools.analysis.analysis_to_storyboard import AnalysisToStoryboard


def _section(i, speaker, text, start, end):
    return {"id": f"s{i:02d}", "label": speaker, "text": text,
            "start_seconds": start, "end_seconds": end}


def _brief(scenes, sections):
    return {
        "version": "1.0",
        "source": {"type": "local_file", "duration_seconds": 30.0, "title": "测试片"},
        "structure_analysis": {
            "total_scenes": len(scenes),
            "scenes": scenes,
            "pacing_profile": {"avg_scene_duration_seconds": 6.0, "pacing_style": "dynamic_social"},
        },
        "narration_transcript": {
            "language": "zh",
            "segments": [{"start": s["start_seconds"], "end": s["end_seconds"],
                          "text": s["text"], "speaker": s["label"]} for s in sections],
        },
        "keyframes": [
            {"timestamp": 0.5, "scene_index": 0, "path": "kf/0.jpg"},
            {"timestamp": 31.0, "scene_index": 3, "path": "kf/31.jpg"},
        ],
        "style_profile": {"subtitle_style": "黄底黑字"},
    }


SCENES = [
    {"scene_index": 0, "start_time": 0.0, "end_time": 10.0, "motion_type": "static_image", "refined_cut": True},
    {"scene_index": 1, "start_time": 10.0, "end_time": 20.0, "motion_type": "motion_clip"},
    {"scene_index": 2, "start_time": 20.0, "end_time": 30.0, "motion_type": "static_image"},
]
SECTIONS = [
    _section(1, "甲", "第一句", 0.0, 4.0),
    _section(2, "乙", "第二句", 5.0, 9.0),
    _section(3, "甲", "第三句", 10.5, 14.0),
]


def _run(tmp_path, monkeypatch, brief, snapshot_dir=None, **overrides):
    (tmp_path / "artifacts").mkdir(exist_ok=True)
    brief_path = tmp_path / "artifacts" / "video_analysis_brief.json"
    brief_path.write_text(json.dumps(brief, ensure_ascii=False), encoding="utf-8")
    if snapshot_dir is not None:
        monkeypatch.setattr(AnalysisToStoryboard, "_snapshot_dir", lambda self, root: snapshot_dir)
    params = {"project_dir": str(tmp_path), "merge_seconds": 1.2, "target_beats": 24}
    params.update(overrides)
    return AnalysisToStoryboard().execute(params)


def test_builds_scene_plan_and_script(tmp_path, monkeypatch) -> None:
    result = _run(tmp_path, monkeypatch, _brief(SCENES, SECTIONS))
    assert result.success, result.error

    plan = json.loads((tmp_path / "artifacts" / "scene_plan.json").read_text())
    script = json.loads((tmp_path / "artifacts" / "script.json").read_text())

    assert [s["id"] for s in plan["scenes"]] == ["b01", "b02", "b03"]
    assert plan["scenes"][0]["type"] == "text_card"  # static + text on screen
    assert plan["scenes"][1]["type"] == "broll"
    assert plan["scenes"][0]["transition_in"] == "fade_in"
    assert plan["scenes"][1]["transition_in"] == "cut"
    assert script["title"] == "测试片"
    assert script["total_duration_seconds"] == 30.0
    assert [s["text"] for s in script["sections"]] == ["第一句", "第二句", "第三句"]


def test_beats_carry_their_script_section(tmp_path, monkeypatch) -> None:
    _run(tmp_path, monkeypatch, _brief(SCENES, SECTIONS))
    plan = json.loads((tmp_path / "artifacts" / "scene_plan.json").read_text())

    assert plan["scenes"][0]["script_section_id"] == "s01"
    assert plan["scenes"][1]["script_section_id"] == "s03"
    assert "script_section_id" not in plan["scenes"][2]  # 20-30s has no dialogue


def test_short_scenes_are_merged_by_duration(tmp_path, monkeypatch) -> None:
    scenes = [{"scene_index": i, "start_time": i * 1.0, "end_time": (i + 1) * 1.0,
               "motion_type": "motion_clip"} for i in range(10)]
    _run(tmp_path, monkeypatch, _brief(scenes, []), merge_seconds=2.5, target_beats=100)
    plan = json.loads((tmp_path / "artifacts" / "scene_plan.json").read_text())

    # Each 1s scene pairs below the 2.5s floor -> 5 beats of 2s.
    assert len(plan["scenes"]) == 5
    assert plan["scenes"][0]["start_seconds"] == 0.0
    assert plan["scenes"][0]["end_seconds"] == 2.0
    assert plan["metadata"]["source_scenes"] == 10


def test_target_beats_caps_long_timelines(tmp_path, monkeypatch) -> None:
    scenes = [{"scene_index": i, "start_time": i * 4.0, "end_time": (i + 1) * 4.0,
               "motion_type": "motion_clip"} for i in range(10)]
    _run(tmp_path, monkeypatch, _brief(scenes, []), merge_seconds=1.0, target_beats=3)
    plan = json.loads((tmp_path / "artifacts" / "scene_plan.json").read_text())
    assert len(plan["scenes"]) == 3


def test_snapshots_are_named_by_beat(tmp_path, monkeypatch) -> None:
    video = tmp_path / "v.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
         "color=c=red:s=64x64:d=30", "-pix_fmt", "yuv420p", str(video)],
        check=True,
    )
    brief = _brief(SCENES, SECTIONS)
    brief["source"]["local_path"] = str(video)
    result = _run(tmp_path, monkeypatch, brief, snapshot_dir=tmp_path / "snapshots")

    assert (tmp_path / "snapshots" / "b01.jpg").exists()
    assert (tmp_path / "snapshots" / "b02.jpg").exists()
    assert (tmp_path / "snapshots" / "b03.jpg").exists()
    assert result.data["snapshots"] == 3


def test_refuses_to_clobber_existing_artifacts(tmp_path, monkeypatch) -> None:
    _run(tmp_path, monkeypatch, _brief(SCENES, SECTIONS))
    before = (tmp_path / "artifacts" / "scene_plan.json").read_text()

    again = _run(tmp_path, monkeypatch, _brief(SCENES, SECTIONS))
    assert again.success is False
    assert "already exist" in again.error
    assert (tmp_path / "artifacts" / "scene_plan.json").read_text() == before


def test_brief_can_live_outside_artifacts(tmp_path) -> None:
    analysis = tmp_path / "analysis" / "video_analyzer"
    analysis.mkdir(parents=True)
    (analysis / "brief.json").write_text(
        json.dumps(_brief(SCENES, SECTIONS), ensure_ascii=False), encoding="utf-8"
    )

    result = AnalysisToStoryboard().execute({
        "project_dir": str(tmp_path),
        "brief_path": str(analysis / "brief.json"),
        "merge_seconds": 1.2,
        "target_beats": 24,
    })

    assert result.success, result.error
    assert (tmp_path / "artifacts" / "scene_plan.json").exists()


def test_missing_brief_is_reported(tmp_path) -> None:
    result = AnalysisToStoryboard().execute({"project_dir": str(tmp_path)})
    assert result.success is False
    assert "brief" in result.error.lower()


def test_outputs_validate_against_schemas(tmp_path, monkeypatch) -> None:
    import jsonschema

    _run(tmp_path, monkeypatch, _brief(SCENES, SECTIONS))
    root = Path(__file__).resolve().parents[2]
    for name in ("scene_plan", "script"):
        schema = json.loads((root / "schemas" / "artifacts" / f"{name}.schema.json").read_text())
        artifact = json.loads((tmp_path / "artifacts" / f"{name}.json").read_text())
        jsonschema.validate(instance=artifact, schema=schema)
