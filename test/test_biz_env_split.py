"""历史「问题阶段」混排值拆成阶段 + 环境。"""

from legacy_migration import apply_biz_env_stage_env_split


def test_split_production_env_to_ops_stage():
    out = apply_biz_env_stage_env_split({"biz_env": "生产环境", "location": "农行"})
    assert out["biz_env"] == "运维阶段"
    assert out["problem_env"] == "生产环境"
    assert out["location"] == "农行"


def test_split_legacy_prod_variants():
    for raw in ("生产环境（运维）", "生产环境（巡检）", "生产环境（影响业务）"):
        out = apply_biz_env_stage_env_split({"biz_env": raw})
        assert out["biz_env"] == "运维阶段"
        assert out["problem_env"] == "生产环境"


def test_split_test_env_to_ops_stage():
    out = apply_biz_env_stage_env_split({"biz_env": "已投产业务测试环境"})
    assert out["biz_env"] == "运维阶段"
    assert out["problem_env"] == "测试环境"


def test_keep_stage_values_and_existing_env():
    out = apply_biz_env_stage_env_split({"biz_env": "POC阶段"})
    assert out["biz_env"] == "POC阶段"
    assert "problem_env" not in out

    kept = apply_biz_env_stage_env_split({"biz_env": "生产环境", "problem_env": "测试环境"})
    assert kept["biz_env"] == "运维阶段"
    assert kept["problem_env"] == "测试环境"
