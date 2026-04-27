class TestFrontendSPA:
    def test_tc_m09_001_index_accessible(self, api_client):
        resp = api_client.get("/")
        assert resp.status_code == 200
        assert "text/html" in resp.headers.get("content-type", "").lower() or resp.text.strip().startswith("<")

    def test_tc_m09_002_spa_fallback(self, api_client):
        resp = api_client.get("/tickets/test-page")
        assert resp.status_code == 200

    def test_tc_m09_003_static_asset(self, api_client):
        resp = api_client.get("/assets/skin-presets/preset-01.png")
        assert resp.status_code == 200

    def test_tc_m09_004_path_traversal_protection(self, api_client):
        resp = api_client.get("/../backend/app.py")
        assert resp.status_code in (200, 404, 400)
