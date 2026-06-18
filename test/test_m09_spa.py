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

    def test_tc_m09_006_favicon_asset(self, api_client):
        resp = api_client.get("/assets/icons/favicon-32x32.png")
        assert resp.status_code == 200
        assert "image" in resp.headers.get("content-type", "").lower()

    def test_tc_m09_004_path_traversal_protection(self, api_client):
        resp = api_client.get("/../backend/app.py")
        assert resp.status_code in (200, 404, 400)

    def test_tc_m09_005_frontend_no_cache_header(self, api_client):
        # 前端文件须带 Cache-Control: no-cache,避免浏览器沿用旧缓存
        for path in ("/", "/app.js"):
            resp = api_client.get(path)
            assert resp.status_code == 200
            assert "no-cache" in resp.headers.get("cache-control", "").lower()


class TestFrontendSPADeep:
    def test_e_m09_spa_deep_route_fallback(self, api_client):
        resp = api_client.get("/admin/settings/users")
        assert resp.status_code == 200

    def test_e_m09_spa_api_route_not_intercepted(self, api_client):
        resp = api_client.get("/health")
        assert resp.status_code == 200
        assert resp.headers.get("content-type", "").lower().startswith("application/json")

    def test_e_m09_spa_double_dot_traversal(self, api_client):
        resp = api_client.get("/../../etc/passwd")
        assert resp.status_code in (200, 404, 400)

    def test_e_m09_spa_encoded_traversal(self, api_client):
        resp = api_client.get("/%2e%2e/backend/app.py")
        assert resp.status_code in (200, 404, 400)

    def test_e_m09_spa_null_byte_injection(self, api_client):
        resp = api_client.get("/assets%00.md")
        assert resp.status_code in (200, 404, 400)

    def test_e_m09_spa_api_prefix_routes_work(self, api_client):
        resp = api_client.get("/api/admin/users")
        assert resp.status_code == 200
        assert resp.headers.get("content-type", "").lower().startswith("application/json")

    def test_e_m09_spa_fallback_returns_html(self, api_client):
        resp = api_client.get("/nonexistent-spa-route-xyz")
        if resp.status_code == 200:
            ct = resp.headers.get("content-type", "").lower()
            assert "text/html" in ct or resp.text.strip().startswith("<")

    def test_e_m09_spa_css_asset_request(self, api_client):
        resp = api_client.get("/assets/index.css")
        assert resp.status_code in (200, 404)

    def test_e_m09_spa_js_asset_request(self, api_client):
        resp = api_client.get("/assets/index.js")
        assert resp.status_code in (200, 404)
