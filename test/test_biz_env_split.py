"""历史「问题阶段」混排值拆成阶段 + 环境。"""

from legacy_migration import apply_biz_env_stage_env_split, infer_problem_env_from_biz_env


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


def test_stage_values_imply_test_env():
    for raw in ("POC阶段", "交付阶段", "在研版本试点"):
        out = apply_biz_env_stage_env_split({"biz_env": raw})
        assert out["biz_env"] == raw
        assert out["problem_env"] == "测试环境"


def test_keep_existing_env_and_skip_uninferable():
    kept = apply_biz_env_stage_env_split({"biz_env": "生产环境", "problem_env": "测试环境"})
    assert kept["biz_env"] == "运维阶段"
    assert kept["problem_env"] == "测试环境"

    empty = apply_biz_env_stage_env_split({"biz_env": ""})
    assert empty.get("problem_env") in (None, "")

    ops = apply_biz_env_stage_env_split({"biz_env": "运维阶段"})
    assert ops["biz_env"] == "运维阶段"
    assert ops.get("problem_env") in (None, "")


def test_infer_problem_env_from_biz_env():
    assert infer_problem_env_from_biz_env("POC阶段") == "测试环境"
    assert infer_problem_env_from_biz_env("生产环境") == "生产环境"
    assert infer_problem_env_from_biz_env("运维阶段") == ""
    assert infer_problem_env_from_biz_env("") == ""
    assert infer_problem_env_from_biz_env("POC阶段", "生产环境") == "生产环境"
