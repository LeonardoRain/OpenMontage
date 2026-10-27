import sys
from types import SimpleNamespace

from tools.analysis.transcriber import Transcriber
from tools.analysis.video_analyzer import VideoAnalyzer
from tools.base_tool import ToolResult


def _fake_transcriber(monkeypatch, captured: list[dict]) -> None:
    def fake_execute(self, inputs):
        captured.append(dict(inputs))
        return ToolResult(
            success=True,
            data={
                "segments": [{"start": 0.0, "end": 1.0, "text": "你好"}],
                "language": inputs.get("language") or "zh",
            },
        )

    monkeypatch.setattr(Transcriber, "execute", fake_execute)
    monkeypatch.setattr(VideoAnalyzer, "_get_duration", lambda self, path: 10.0)


def _local_video(tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"fake")
    return video


def test_local_file_is_transcribed_from_video_track(monkeypatch, tmp_path) -> None:
    captured: list[dict] = []
    _fake_transcriber(monkeypatch, captured)
    video = _local_video(tmp_path)

    result = VideoAnalyzer().execute({
        "source": str(video),
        "analysis_depth": "transcript_only",
        "output_dir": str(tmp_path / "out"),
    })

    assert result.success, result.error
    assert len(captured) == 1
    assert captured[0]["input_path"] == str(video)
    assert result.data["narration_transcript"]["segments"][0]["text"] == "你好"


def test_default_transcription_model_is_medium(monkeypatch, tmp_path) -> None:
    captured: list[dict] = []
    _fake_transcriber(monkeypatch, captured)

    VideoAnalyzer().execute({
        "source": str(_local_video(tmp_path)),
        "analysis_depth": "transcript_only",
        "output_dir": str(tmp_path / "out"),
    })

    assert captured[0]["model_size"] == "medium"
    assert "language" not in captured[0]


def test_language_and_model_are_forwarded_with_simplified_prompt(monkeypatch, tmp_path) -> None:
    captured: list[dict] = []
    _fake_transcriber(monkeypatch, captured)

    VideoAnalyzer().execute({
        "source": str(_local_video(tmp_path)),
        "analysis_depth": "transcript_only",
        "language": "zh",
        "transcription_model": "large-v3",
        "output_dir": str(tmp_path / "out"),
    })

    assert captured[0]["language"] == "zh"
    assert captured[0]["model_size"] == "large-v3"
    assert "简体" in captured[0]["initial_prompt"]


def test_explicit_initial_prompt_wins(monkeypatch, tmp_path) -> None:
    captured: list[dict] = []
    _fake_transcriber(monkeypatch, captured)

    VideoAnalyzer().execute({
        "source": str(_local_video(tmp_path)),
        "analysis_depth": "transcript_only",
        "language": "zh",
        "transcription_prompt": "飘飘、茉莉、铲屎官",
        "output_dir": str(tmp_path / "out"),
    })

    assert captured[0]["initial_prompt"] == "飘飘、茉莉、铲屎官"


def test_word_count_handles_cjk_and_latin() -> None:
    assert VideoAnalyzer._count_words("飘飘，你开心一点嘛") == 8
    assert VideoAnalyzer._count_words("hello world, 3 2 1") == 5
    assert VideoAnalyzer._count_words("来321 茄子") == 4


def test_transcriber_forwards_initial_prompt(monkeypatch, tmp_path) -> None:
    seen: dict = {}

    class FakeWhisperModel:
        def __init__(self, model_size, *, device, compute_type):
            pass

        def transcribe(self, *args, **kwargs):
            seen.update(kwargs)
            return iter(()), SimpleNamespace(language="zh", duration=1.0)

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeWhisperModel))
    monkeypatch.setitem(
        sys.modules,
        "ctranslate2",
        SimpleNamespace(get_cuda_device_count=lambda: 0, get_supported_compute_types=lambda d: set()),
    )
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"fake")

    result = Transcriber().execute({
        "input_path": str(audio),
        "output_dir": str(tmp_path),
        "language": "zh",
        "initial_prompt": "以下是普通话的句子。",
    })

    assert result.success, result.error
    assert seen["initial_prompt"] == "以下是普通话的句子。"
