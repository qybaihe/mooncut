from hybrid_subtitle.audio import plan_chunk_boundaries


def test_chunk_planner_prefers_silence_near_limit() -> None:
    ranges = plan_chunk_boundaries(
        duration=112,
        silence_midpoints=[12, 41.5, 44.2, 83.0, 89.0],
        chunk_seconds=45,
    )
    assert ranges == [(0.0, 44.2), (44.2, 89.0), (89.0, 112)]


def test_short_audio_stays_in_one_chunk() -> None:
    assert plan_chunk_boundaries(20, [5, 10], 45) == [(0.0, 20)]

