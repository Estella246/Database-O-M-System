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

    def test_e_m08_workload_structure(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200
        workload = resp.json()["workload"]
        assert isinstance(workload, dict)

    def test_e_m08_sla_structure(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200
        sla = resp.json()["sla"]
        assert isinstance(sla, dict)

    def test_e_m08_passthrough_structure(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200
        passthrough = resp.json()["passthrough"]
        assert isinstance(passthrough, dict)

    def test_e_m08_different_operators(self, api_client):
        resp1 = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_admin",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        resp2 = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp1.status_code == 200
        assert resp2.status_code == 200

    def test_e_m08_missing_operator_id(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200

    def test_e_m08_missing_dates(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
        })
        assert resp.status_code in (200, 400)

    def test_e_m08_same_start_end_date(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2026-04-15",
            "end_date": "2026-04-15",
        })
        assert resp.status_code == 200

    def test_e_m08_wide_date_range(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "test_user01",
            "start_date": "2025-01-01",
            "end_date": "2026-12-31",
        })
        assert resp.status_code == 200

    def test_e_m08_nonexistent_operator(self, api_client):
        resp = api_client.get("/api/home/personal-stats", params={
            "operator_id": "nonexistent_user_xyz",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        })
        assert resp.status_code == 200


class TestTicketListStats:
    def test_e_m08_ticket_list_endpoint(self, api_client):
        resp = api_client.get("/api/tickets", params={"operator_id": "test_user01"})
        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body

    def test_e_m08_ticket_basic_list_endpoint(self, api_client):
        resp = api_client.get("/api/tickets/basic")
        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body
        assert isinstance(body["items"], list)

    def test_e_m08_ticket_basic_item_structure(self, api_client):
        resp = api_client.get("/api/tickets/basic")
        assert resp.status_code == 200
        items = resp.json()["items"]
        if items:
            item = items[0]
            assert "order_id" in item
            assert "subject" in item
            assert "node_key" in item
            assert "node_name" in item
            assert "creator_name" in item
            assert "created_date" in item
            assert "assignee" in item
