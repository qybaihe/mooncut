from dataclasses import replace

from fastapi.testclient import TestClient

from hybrid_subtitle.app import create_app
from hybrid_subtitle.config import Settings


def test_health_and_service_auth(tmp_path) -> None:
    settings = replace(
        Settings.from_env(),
        data_dir=tmp_path,
        mimo_api_key="mimo-test",
        deepgram_api_key="deepgram-test",
        service_api_key="public-test-key",
    )
    app = create_app(settings)

    with TestClient(app) as client:
        health = client.get("/healthz")
        assert health.status_code == 200
        assert health.json()["providers_configured"] is True

        unauthorized = client.get("/v1/subtitle-jobs")
        assert unauthorized.status_code == 401

        authorized = client.get(
            "/v1/subtitle-jobs",
            headers={"Authorization": "Bearer public-test-key"},
        )
        assert authorized.status_code == 200
        assert authorized.json() == []

