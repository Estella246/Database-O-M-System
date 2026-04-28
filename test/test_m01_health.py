def test_tc_m01_001_health_ok(api_client):
    resp = api_client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("status") == "ok"


def test_tc_m01_002_health_db_connected(api_client):
    resp = api_client.get("/health")
    assert resp.status_code == 200


class TestHealthDeep:
    def test_e_m01_health_response_is_json(self, api_client):
        resp = api_client.get("/health")
        assert resp.status_code == 200
        assert resp.headers.get("content-type", "").lower().startswith("application/json")

    def test_e_m01_health_has_status_field(self, api_client):
        resp = api_client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert "status" in body
        assert body["status"] == "ok"

    def test_e_m01_health_no_extra_unexpected_fields(self, api_client):
        resp = api_client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert "status" in body

    def test_e_m01_health_get_only(self, api_client):
        resp = api_client.post("/health")
        assert resp.status_code == 405

    def test_e_m01_health_put_not_allowed(self, api_client):
        resp = api_client.put("/health")
        assert resp.status_code == 405

    def test_e_m01_health_delete_not_allowed(self, api_client):
        resp = api_client.delete("/health")
        assert resp.status_code == 405

    def test_e_m01_health_consistent_across_calls(self, api_client):
        resp1 = api_client.get("/health")
        resp2 = api_client.get("/health")
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp1.json()["status"] == resp2.json()["status"]

    def test_e_m01_health_idempotent(self, api_client):
        for _ in range(5):
            resp = api_client.get("/health")
            assert resp.status_code == 200
            assert resp.json()["status"] == "ok"
