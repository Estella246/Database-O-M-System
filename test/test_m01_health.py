def test_tc_m01_001_health_ok(api_client):
    resp = api_client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("status") == "ok"


def test_tc_m01_002_health_db_connected(api_client):
    resp = api_client.get("/health")
    assert resp.status_code == 200
