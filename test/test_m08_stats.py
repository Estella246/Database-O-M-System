class TestPersonalStats:
    def test_tc_m08_001_get_personal_stats(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200
        body = resp.json()
        assert "workload" in body
        assert "sla" in body
        assert "passthrough" in body

    def test_tc_m08_002_invalid_date_format(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "invalid",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 400

    def test_tc_m08_003_invalid_quality_scope(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
            "quality_scope": "invalid",
        })
        assert resp.status_code == 400

    def test_tc_m08_004_swapped_dates(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-30",
            "end_date": "2026-04-01",
        })
        assert resp.status_code == 200
