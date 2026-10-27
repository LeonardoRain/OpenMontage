"""Turn a VideoAnalysisBrief into Backlot's scene_plan + script artifacts.

`video_analyzer` reports hard cuts (dozens per short-form video). Backlot's
storyboard wants narrative beats — the units a director would call "shots" —
plus a script whose sections carry speaker and delivery cues. Doing that
conversion by hand for every reference episode is error-prone and produces a
different shape each time, so it lives here.

Beat boundaries, descriptions and visual intent still come from the agent's
vision pass; this tool owns timing arithmetic, merging, id assignment, script
section mapping and snapshot naming — the parts that should be identical
every run.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from tools.base_tool import (
    BaseTool,
    Determinism,
    ExecutionMode,
    ResourceProfile,
    ToolResult,
    ToolStability,
    ToolTier,
    ToolRuntime,
)

DEFAULT_PACES = {
    "narrator": "conversational",
}


class AnalysisToStoryboard(BaseTool):
    name = "analysis_to_storyboard"
    version = "0.1.0"
    tier = ToolTier.ANALYZE
    capability = "analysis"
    provider = "local"
    stability = ToolStability.BETA
    execution_mode = ExecutionMode.SYNC
    determinism = Determinism.DETERMINISTIC
    runtime = ToolRuntime.LOCAL

    dependencies = ["cmd:ffmpeg"]
    install_instructions = (
        "Install FFmpeg: https://ffmpeg.org/download.html\n"
        "Reads artifacts/video_analysis_brief.json produced by video_analyzer."
    )
    agent_skills = ["ffmpeg"]

    capabilities = [
        "build_scene_plan",
        "build_script",
        "name_scene_snapshots",
    ]

    best_for = [
        "converting a reference analysis into Backlot storyboard artifacts",
        "batching many reference episodes through one repeatable shape",
        "avoiding per-episode hand-written artifact scripts",
    ]

    not_good_for = [
        "understanding video content (use video_analyzer + agent vision)",
        "writing narration or story beats",
    ]

    input_schema = {
        "type": "object",
        "required": ["project_dir"],
        "properties": {
            "project_dir": {
                "type": "string",
                "description": "Project workspace that receives artifacts/ and snapshots/",
            },
            "brief_path": {
                "type": "string",
                "description": "Path to the analysis brief (default: <project_dir>/artifacts/video_analysis_brief.json)",
            },
            "merge_seconds": {
                "type": "number",
                "minimum": 0,
                "default": 1.2,
                "description": "Merge neighbouring scenes shorter than this into one beat",
            },
            "target_beats": {
                "type": "integer",
                "minimum": 1,
                "default": 24,
                "description": "Upper bound on beats; long runs are merged most aggressively first",
            },
            "video_path": {
                "type": "string",
                "description": "Source video for snapshots (defaults to the brief's local_path)",
            },
            "snapshot_dir": {
                "type": "string",
                "description": "Where b##.jpg snapshots go (default: <project_dir>/snapshots)",
            },
            "overwrite": {"type": "boolean", "default": False},
        },
    }

    output_schema = {
        "type": "object",
        "properties": {
            "scene_plan_path": {"type": "string"},
            "script_path": {"type": "string"},
            "beats": {"type": "integer"},
            "snapshots": {"type": "integer"},
        },
    }

    resource_profile = ResourceProfile(
        cpu_cores=1, ram_mb=512, vram_mb=0, disk_mb=200, network_required=False,
    )
    idempotency_key_fields = ["project_dir", "merge_seconds", "target_beats"]
    side_effects = [
        "writes artifacts/scene_plan.json",
        "writes artifacts/script.json",
        "writes snapshots/b##.jpg",
    ]
    user_visible_verification = [
        "Spot-check that beat boundaries match the video's narrative turns",
        "Confirm each beat's snapshot shows the intended shot",
    ]

    def execute(self, inputs: dict[str, Any]) -> ToolResult:
        project_dir = Path(inputs["project_dir"])
        artifacts = project_dir / "artifacts"
        brief_path = Path(
            inputs.get("brief_path") or artifacts / "video_analysis_brief.json"
        )
        if not brief_path.exists():
            return ToolResult(
                success=False,
                error=f"No video analysis brief at {brief_path}. Run video_analyzer first.",
            )

        plan_path = artifacts / "scene_plan.json"
        script_path = artifacts / "script.json"
        if not inputs.get("overwrite"):
            existing = [p.name for p in (plan_path, script_path) if p.exists()]
            if existing:
                return ToolResult(
                    success=False,
                    error=(
                        f"{', '.join(existing)} already exist in {artifacts}. "
                        "Pass overwrite=true to regenerate (hand edits will be lost)."
                    ),
                )

        brief = json.loads(brief_path.read_text(encoding="utf-8"))
        segments = (brief.get("narration_transcript") or {}).get("segments") or []
        if not segments and not brief.get("structure_analysis", {}).get("scenes"):
            return ToolResult(
                success=False,
                error="Brief has neither scene cuts nor a transcript; run video_analyzer again.",
            )

        merge_seconds = float(inputs.get("merge_seconds", 1.2))
        target = int(inputs.get("target_beats", 24))
        scenes = brief["structure_analysis"]["scenes"]
        beats = self._merge(scenes, merge_seconds, target)

        duration = brief["source"]["duration_seconds"]
        labeled = self._label(brief, beats, segments, duration)
        snap_dir = Path(inputs.get("snapshot_dir") or self._snapshot_dir(project_dir))
        snapshots = self._snapshots(
            brief, labeled, inputs.get("video_path"), snap_dir
        )

        plan = self._scene_plan(brief, labeled)
        script = self._script(brief, segments)
        artifacts.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(json.dumps(plan, indent=2, ensure_ascii=False), encoding="utf-8")
        script_path.write_text(json.dumps(script, indent=2, ensure_ascii=False), encoding="utf-8")

        return ToolResult(
            success=True,
            data={
                "scene_plan_path": str(plan_path),
                "script_path": str(script_path),
                "beats": len(labeled),
                "snapshots": snapshots,
                "source_scenes": len(scenes),
            },
            artifacts=[str(plan_path), str(script_path)],
        )

    # ─── beats ───

    def _merge(self, scenes: list[dict], merge_seconds: float, target: int) -> list[dict]:
        beats = [
            {"start_seconds": s["start_time"], "end_time": s["end_time"],
             "motion_type": s.get("motion_type"), "refined": bool(s.get("refined_cut"))}
            for s in scenes
        ]
        while len(beats) > 1:
            run = self._shortest_run(beats, merge_seconds)
            too_many = len(beats) > target
            if run is None and not too_many:
                break
            i = run if run is not None else self._nearest_pair(beats, merge_seconds)
            beats[i:i + 2] = [self._join(beats[i], beats[i + 1])]
        return beats

    @staticmethod
    def _join(a: dict, b: dict) -> dict:
        return {
            "start_seconds": a["start_seconds"],
            "end_time": b["end_time"],
            "motion_type": a["motion_type"],
            "refined": a["refined"] or b["refined"],
        }

    @staticmethod
    def _shortest_run(beats: list[dict], merge_seconds: float) -> int | None:
        best, best_len = None, merge_seconds
        for i in range(len(beats) - 1):
            length = beats[i + 1]["end_time"] - beats[i]["start_seconds"]
            if length < best_len:
                best, best_len = i, length
        return best

    @staticmethod
    def _nearest_pair(beats: list[dict], merge_seconds: float) -> int:
        lengths = [beats[i + 1]["end_time"] - beats[i]["start_seconds"]
                   for i in range(len(beats) - 1)]
        return lengths.index(min(lengths))

    # ─── labeling ───

    def _label(self, brief: dict, beats: list[dict], segments: list[dict], duration: float) -> list[dict]:
        out = []
        for i, beat in enumerate(beats, 1):
            start, end = beat["start_seconds"], beat["end_time"]
            inside = [
                (pos, s) for pos, s in enumerate(segments, 1)
                if start <= (s["start"] + s["end"]) / 2 < end
            ]
            speaker = next((s.get("speaker") for _, s in inside if s.get("speaker")), None)
            out.append({
                **beat,
                "id": f"b{i:02d}",
                "narration": " / ".join(s["text"] for _, s in inside) if inside else None,
                "speaker": speaker,
                "section_id": f"s{inside[0][0]:02d}" if inside else None,
                "text_like": beat["motion_type"] == "static_image",
            })
        return out

    # ─── snapshots ───

    def _snapshot_dir(self, project_dir: Path) -> Path:
        return project_dir / "snapshots"

    def _snapshots(self, brief: dict, beats: list[dict], video_path: str | None, snap_dir: Path) -> int:
        source = video_path or (brief["source"].get("local_path"))
        if not source or not Path(source).exists():
            return 0
        snap_dir.mkdir(parents=True, exist_ok=True)
        count = 0
        duration = brief["source"]["duration_seconds"]
        for beat in beats:
            ts = min(beat["start_seconds"] + 0.6, beat["end_time"] - 0.05)
            if ts <= 0 or ts >= duration:
                continue
            target = snap_dir / f"{beat['id']}.jpg"
            proc = subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-ss", f"{ts:.3f}", "-i", source,
                 "-frames:v", "1", "-q:v", "2", str(target)],
                capture_output=True,
            )
            if proc.returncode == 0 and target.exists() and target.stat().st_size > 0:
                count += 1
        return count

    # ─── artifacts ───

    def _scene_plan(self, brief: dict, beats: list[dict]) -> dict:
        scenes = []
        for i, beat in enumerate(beats):
            entry = {
                "id": beat["id"],
                "type": "text_card" if beat["text_like"] else "broll",
                "description": (
                    f"{beat['start_seconds']:.2f}s–{beat['end_time']:.2f}s"
                    f"{'（文字/静态卡）' if beat['text_like'] else ''}"
                ),
                "start_seconds": beat["start_seconds"],
                "end_seconds": beat["end_time"],
                "framing": "",
                "movement": "",
                "transition_in": "fade_in" if i == 0 else "cut",
                "narrative_role": "transition",
                "required_assets": [{
                    "type": "image",
                    "description": f"{beat['id']} 参考关键帧",
                    "source": "source",
                }],
            }
            if beat["section_id"]:
                entry["script_section_id"] = beat["section_id"]
            scenes.append(entry)
        return {
            "version": "1.0",
            "style_playbook": (brief.get("style_profile") or {}).get("closest_playbook") or "",
            "scenes": scenes,
            "metadata": {
                "reference": brief["source"].get("local_path") or brief["source"].get("url"),
                "duration_seconds": brief["source"]["duration_seconds"],
                "source_scenes": brief["structure_analysis"]["total_scenes"],
                "note": (
                    "Beats generated mechanically from video_analyzer scene cuts. "
                    "Descriptions, framing, movement and narrative_role are placeholders — "
                    "the agent fills them from its keyframe vision pass."
                ),
            },
        }

    def _script(self, brief: dict, segments: list[dict]) -> dict:
        sections = []
        for i, seg in enumerate(segments, 1):
            speaker = seg.get("speaker") or "narrator"
            sections.append({
                "id": f"s{i:02d}",
                "label": speaker,
                "text": seg["text"],
                "start_seconds": seg["start"],
                "end_seconds": seg["end"],
                "speaker_directions": "",
                "delivery_cues": {"pace": DEFAULT_PACES.get(speaker, "conversational"), "energy": ""},
            })
        return {
            "version": "1.0",
            "title": brief["source"].get("title") or "",
            "total_duration_seconds": brief["source"]["duration_seconds"],
            "sections": sections,
            "metadata": {
                "speakers": sorted({s["label"] for s in sections}),
                "language": (brief.get("narration_transcript") or {}).get("language"),
                "subtitle_style": (brief.get("style_profile") or {}).get("subtitle_style", ""),
                "note": "Delivery cues are defaults — refine per character before TTS.",
            },
        }
