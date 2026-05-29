"""生成「老平台」历史工单库（GaussDB 模拟），用于验证新平台「迁入」功能。

表结构严格按 origin_orders（历史运维问题单核心业务表）设计文档建出全部 8 张表：
  1. t_work_flow_info          流程模板表
  2. t_work_flow_node          流程节点表（设计文档第 2 节，FK 命名 T_WORK_FLOW_NODE）
  3. t_work_flow_instance      工单基本信息表（状态/当前节点/各阶段耗时…）
  4. t_work_flow_task          流程任务表 = 节点流转「日志流」（每流转一次一条，含 form_data）
  5. t_work_flow_field_config  字段配置表
  6. t_work_flow_field_config_option  配置选项表
  7. t_work_flow_task_parse    工单信息映射表（column1..column64 固定列）
  8. t_work_flow_file_info     附件表

做三件事：
  1. 在当前 PG 实例创建独立数据库 legacy_orders（已存在则复用）；
  2. 建上述 8 张表（每次重建，DROP 后 CREATE）；
  3. 生成 2000 条「全部审核关闭终态」历史工单（status=关闭、当前节点=审核关闭），instance.id
     使用高位段（200001 起）避开测试夹具(1001-1004)。流转「日志流」分两类：
       - 完整链路：问题填写→问题审核→运维分析→开发分析→开发闭环→运维闭环→审核关闭→关闭；
       - 独立闭环（约 LEGACY_INDEPENDENT_RATIO，默认 35%）：运维分析后直接进入运维闭环、不经开发分析
         （问题填写→问题审核→运维分析→运维闭环→审核关闭→关闭），用于产出新平台「独立闭环率」非 0 样本。

连接凭据复用 backend/.env 的 DATABASE_URL（仅替换库名），不在脚本里硬编码口令。

用法：
    backend/.venv/bin/python db/legacy_mock/gen_legacy_orders.py
    # 可选：自定义条数 / 库名
    LEGACY_DB_NAME=legacy_orders LEGACY_ROWS=2000 backend/.venv/bin/python db/legacy_mock/gen_legacy_orders.py
"""
from __future__ import annotations

import json
import os
import random
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "backend" / ".env")

DB_NAME = os.getenv("LEGACY_DB_NAME", "legacy_orders")
ROWS = int(os.getenv("LEGACY_ROWS", "2000"))
ID_START = 200001  # 高位段，避开测试夹具 1001-1004
SEED = 20260528

# 节点顺序（老平台节点名），与新平台 LEGACY_NODE_NAME_TO_KEY 对应
NODES = ["问题填写", "问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭"]
NODE_ID = {name: i + 1 for i, name in enumerate(NODES)}  # 节点表主键 1..7

# 全部统一为「审核关闭」终态：status=关闭（映射到新平台 closed），当前节点停在「审核关闭」
CLOSED_STATUS = "关闭"

# 流转路径：FULL_PATH 走完整 7 节点；INDEP_PATH 跳过开发分析/开发闭环（运维分析后直接闭环）。
FULL_PATH = NODES
INDEP_PATH = ["问题填写", "问题审核", "运维分析", "运维闭环", "审核关闭"]
# 走 INDEP_PATH（独立闭环、不经开发分析）的工单占比，可由环境变量覆盖。
INDEPENDENT_NO_DEV_RATIO = float(os.getenv("LEGACY_INDEPENDENT_RATIO", "0.35"))

# 人员池：(姓名, 账号)。账号格式贴近老库（首字母+5位）
PEOPLE = [
    ("申宇", "s00001"), ("李潇雨", "l00002"), ("李长军", "l00003"), ("董海俊", "d00004"),
    ("刘宗超", "l00005"), ("徐齐刚", "x00006"), ("宋康", "s00007"), ("李博闻", "l00008"),
    ("王凯", "w00011"), ("张磊", "z00012"), ("陈思远", "c00013"), ("赵云鹏", "z00014"),
    ("周婷", "z00015"), ("吴佳", "w00016"), ("郑浩然", "z00017"), ("孙立", "s00018"),
    ("钱多多", "q00019"), ("冯晓", "f00020"), ("褚明", "c00021"), ("卫国强", "w00022"),
]

BANKS = [
    ("农行", "ABC"), ("工行", "ICBC"), ("建行", "CCB"), ("中行", "BOC"), ("交行", "BCM"),
    ("招行", "CMB"), ("邮储", "PSBC"), ("民生", "CMBC"), ("浦发", "SPDB"), ("兴业", "CIB"),
    ("中信", "CITIC"), ("光大", "CEB"), ("平安", "PAB"), ("广发", "CGB"), ("华夏", "HXB"),
]
PRODUCT_LINES = ["公有云", "私有云", "混合云", "专属云"]
BIZ_ENVS = ["生产环境（运维）", "生产环境（影响业务）", "准生产环境", "测试环境"]
SEVERITIES = ["致命", "严重", "一般", "一般", "提示"]  # 偏向一般
ISSUE_TYPES = ["内核类", "网络类", "存储类", "性能类", "配置类", "安全类"]
COMPONENTS = ["内核问题", "备份问题", "网络问题", "存储问题", "调度问题", "升级问题"]
SYMPTOMS = [
    "实例频繁重启", "备份任务超时", "主备切换失败", "连接数突增", "查询性能下降",
    "进程 coredump", "磁盘 IO 飙高", "疑似内存泄漏", "锁等待超时", "复制延迟过大",
]
ERROR_TEXTS = [
    "ERROR: out of memory", "FATAL: the database system is shutting down",
    "ERROR: canceling statement due to statement timeout", "SIGSEGV in xact_commit",
    "ERROR: deadlock detected", "WARNING: replication lag exceeds threshold",
    "PANIC: could not write to file", "ERROR: too many connections",
]
CLOSE_REASONS = ["已定位并修复，正常关闭", "非问题，配置调整后关闭", "版本升级解决并验证", "临时规避后闭环"]
IMPACT_LEVELS = ["高", "中", "低"]
WORKAROUNDS = ["重启实例临时恢复", "切换主备节点", "扩容连接池并限流", "清理长事务后恢复"]
RECOVERY_METHODS = ["回滚最近变更", "扩容并重启", "主备倒换后恢复", "热补丁修复"]
ROOT_CAUSES = [
    "备份调度线程被长事务阻塞", "内核内存回收策略缺陷导致泄漏", "网络分区引发主备脑裂",
    "并发场景下锁升级触发死锁", "慢查询拖垮共享缓冲区", "磁盘子系统抖动导致 IO 堆积",
]
ROOT_CAUSE_CATEGORIES = ["代码缺陷", "配置错误", "环境问题", "设计缺陷", "第三方组件"]
GAUSS_VERSIONS = ["GaussDB 503.1", "GaussDB 505.2", "GaussDB 506.0", "GaussDB 8.0.0"]
DEPLOY_FORMS = ["集中式", "分布式", "主备", "一主多备"]
HCS_VERSIONS = ["HCS 8.3.0", "HCS 8.5.0", "HCS 23.0.0", "HCS 24.0.0"]


def base_dsn() -> str:
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        raise SystemExit("未找到 DATABASE_URL（请确认 backend/.env 已配置）")
    return dsn


def load_user_account_people(dsn: str) -> list[tuple[str, str]]:
    """从新平台 user_account 读取活跃用户 (姓名, 账号)，供「运维分析/开发分析」阶段随机指派。"""
    with psycopg.connect(dsn) as conn:
        rows = conn.execute(
            "SELECT user_name, account FROM user_account WHERE is_active = TRUE ORDER BY account"
        ).fetchall()
    people = [(str(r[0] or r[1]), str(r[1])) for r in rows if r[1]]
    if len(people) < 2:
        raise SystemExit("user_account 活跃用户不足 2 个，无法为运维分析/开发分析指派不同的真实用户")
    return people


def with_dbname(dsn: str, dbname: str) -> str:
    parts = urlsplit(dsn)
    return urlunsplit((parts.scheme, parts.netloc, f"/{dbname}", parts.query, parts.fragment))


def ensure_database(dsn: str, dbname: str) -> None:
    admin = with_dbname(dsn, "postgres")
    with psycopg.connect(admin, autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (dbname,)
        ).fetchone()
        if exists:
            print(f"[INFO] 数据库 {dbname} 已存在，复用")
        else:
            conn.execute(f'CREATE DATABASE "{dbname}"')
            print(f"[INFO] 已创建数据库 {dbname}")


# ============ 全部 8 张表的建表语句（严格按 origin_orders 设计文档） ============
DDL = """
DROP TABLE IF EXISTS t_work_flow_file_info CASCADE;
DROP TABLE IF EXISTS t_work_flow_field_config_option CASCADE;
DROP TABLE IF EXISTS t_work_flow_field_config CASCADE;
DROP TABLE IF EXISTS t_work_flow_task_parse CASCADE;
DROP TABLE IF EXISTS t_work_flow_task CASCADE;
DROP TABLE IF EXISTS t_work_flow_instance CASCADE;
DROP TABLE IF EXISTS t_work_flow_node CASCADE;
DROP TABLE IF EXISTS t_work_flow_info CASCADE;

-- 1. 流程模板表
CREATE TABLE t_work_flow_info (
  id            BIGINT PRIMARY KEY,
  work_flow_name VARCHAR(128),
  start_node_id BIGINT,
  creator_name  VARCHAR(128),
  creator_id    VARCHAR(64),
  create_time   TIMESTAMP,
  deleted       VARCHAR(8) DEFAULT '0',
  auth          VARCHAR(64)
);

-- 2. 流程节点表（设计文档第 2 节，FK 命名 T_WORK_FLOW_NODE）
CREATE TABLE t_work_flow_node (
  id              BIGINT PRIMARY KEY,
  node_name       VARCHAR(128),
  parent_id       BIGINT,
  jump_node_id    VARCHAR(64),
  position_weight VARCHAR(32)
);

-- 3. 工单基本信息表
CREATE TABLE t_work_flow_instance (
  id                                   BIGINT PRIMARY KEY,
  work_flow_info_id                    BIGINT,
  work_flow_info_name                  VARCHAR(128),
  current_work_flow_node_id            BIGINT,
  current_work_flow_node_name          VARCHAR(128),
  current_assignee                     VARCHAR(128),
  current_assignee_id                  VARCHAR(64),
  status                               VARCHAR(32),
  description                          VARCHAR(2000),
  issue_severity                       VARCHAR(32),
  accepted_group                       VARCHAR(255),
  accepted_group_type                  VARCHAR(64),
  process_id                           VARCHAR(64),
  process_overall                      VARCHAR(255),
  stop_duration                        BIGINT,
  issue_review_node_total_time         BIGINT,
  om_analysis_node_total_time          BIGINT,
  developer_analysis_node_total_time   BIGINT,
  developer_closed_node_total_time     BIGINT,
  om_closed_node_total_time            BIGINT,
  issue_review_closure_node_toal_time  BIGINT,
  annotation_module_data               TEXT,
  creator_time                         VARCHAR(128),
  creator_id                           VARCHAR(64),
  create_time                          TIMESTAMP,
  update_time                          TIMESTAMP,
  deleted                              VARCHAR(8) DEFAULT '0'
);

-- 4. 流程任务表 = 节点流转「日志流」
CREATE TABLE t_work_flow_task (
  id                          BIGINT PRIMARY KEY,
  work_flow_instance_id       BIGINT,
  current_work_flow_node_id   BIGINT,
  current_work_flow_node_name VARCHAR(128),
  next_work_flow_node_id      BIGINT,
  next_work_flow_node_name    VARCHAR(128),
  next_assignee               VARCHAR(128),
  next_assignee_id            VARCHAR(64),
  form_data                   TEXT,
  status                      VARCHAR(32),
  version                     VARCHAR(32),
  instance_process_id         VARCHAR(64),
  duration                    BIGINT,
  accept_group_type           VARCHAR(64),
  point                       VARCHAR(8),
  creator_name                VARCHAR(128),
  creator_id                  VARCHAR(64),
  create_time                 TIMESTAMP,
  update_time                 TIMESTAMP,
  deleted                     VARCHAR(8) DEFAULT '0'
);

-- 5. 字段配置表
CREATE TABLE t_work_flow_field_config (
  id                BIGINT PRIMARY KEY,
  work_flow_node_id BIGINT,
  en_field_name     VARCHAR(128),
  cn_field_name     VARCHAR(128),
  placeholder       VARCHAR(255),
  tip_info          VARCHAR(255),
  required          VARCHAR(8),
  is_show           VARCHAR(8),
  is_show_homepage  VARCHAR(8),
  field_type        VARCHAR(32),
  weight            VARCHAR(32),
  parent_id         BIGINT,
  parse_column_name VARCHAR(32),
  creator_name      VARCHAR(128),
  creator_id        VARCHAR(64),
  create_time       TIMESTAMP,
  delete_time       TIMESTAMP,
  deleted           VARCHAR(8) DEFAULT '0'
);

-- 6. 配置选项表
CREATE TABLE t_work_flow_field_config_option (
  id           BIGINT PRIMARY KEY,
  field_id     BIGINT,
  option_value VARCHAR(255),
  sort_order   INTEGER,
  parent_id    VARCHAR(64)
);

-- 7. 工单信息映射表（column1..column64）
CREATE TABLE t_work_flow_task_parse (
  id          BIGINT PRIMARY KEY,
  instance_id BIGINT,
""" + ",\n".join(f"  column{i} VARCHAR(2000)" for i in range(1, 65)) + """
);

-- 8. 附件表
CREATE TABLE t_work_flow_file_info (
  id                        BIGINT PRIMARY KEY,
  work_flow_instance_id     BIGINT,
  current_work_flow_node_id BIGINT,
  file_name                 VARCHAR(255),
  file_path                 VARCHAR(512),
  upload_user               VARCHAR(128),
  upload_time               TIMESTAMP,
  deleted                   INTEGER DEFAULT 0
);
"""

PARSE_COLS = ["id", "instance_id"] + [f"column{i}" for i in range(1, 65)]
INSTANCE_COLS = [
    "id", "work_flow_info_id", "work_flow_info_name", "current_work_flow_node_id",
    "current_work_flow_node_name", "current_assignee", "current_assignee_id", "status",
    "description", "issue_severity", "accepted_group", "accepted_group_type",
    "stop_duration", "issue_review_node_total_time", "om_analysis_node_total_time",
    "developer_analysis_node_total_time", "developer_closed_node_total_time",
    "om_closed_node_total_time", "issue_review_closure_node_toal_time",
    "creator_time", "creator_id", "create_time", "update_time", "deleted",
]
TASK_COLS = [
    "id", "work_flow_instance_id", "current_work_flow_node_id", "current_work_flow_node_name",
    "next_work_flow_node_id", "next_work_flow_node_name", "next_assignee", "next_assignee_id",
    "form_data", "status", "version", "duration", "point", "creator_name", "creator_id",
    "create_time", "update_time", "deleted",
]


def build_parse_row(rid: int, instance_id: int, vals: dict[str, str]) -> list:
    row = [rid, instance_id] + [None] * 64
    idx = {name: i for i, name in enumerate(PARSE_COLS)}
    for col, v in vals.items():
        row[idx[col]] = v
    return row


def seed_info_and_nodes(conn: psycopg.Connection) -> None:
    """灌入 1 条流程模板 + 7 个流程节点（其余配置表保持空表）。"""
    conn.execute(
        "INSERT INTO t_work_flow_info (id, work_flow_name, start_node_id, creator_name, creator_id, create_time, deleted, auth) "
        "VALUES (1, 'HCS问题处理', %s, %s, %s, %s, '0', 'tac提单')",
        (NODE_ID["问题填写"], "申宇", "s00001", datetime(2024, 1, 1, 9, 0)),
    )
    for i, name in enumerate(NODES):
        nid = NODE_ID[name]
        conn.execute(
            "INSERT INTO t_work_flow_node (id, node_name, parent_id, jump_node_id, position_weight) "
            "VALUES (%s, %s, %s, %s, %s)",
            (nid, name, (nid - 1) if nid > 1 else None, "", str(i + 1)),
        )


def main() -> None:
    rng = random.Random(SEED)
    dsn = base_dsn()
    real_users = load_user_account_people(dsn)  # 运维分析/开发分析 用真实用户
    print(f"[INFO] 从 user_account 读取活跃用户 {len(real_users)} 人，用于运维分析/开发分析阶段")
    ensure_database(dsn, DB_NAME)
    target = with_dbname(dsn, DB_NAME)

    instances: list[list] = []
    parses: list[list] = []
    tasks: list[list] = []
    task_id = 1
    parse_id = 1
    no_dev_cnt = 0  # 走独立闭环路径（不经开发分析）的工单数

    day_start = date(2024, 1, 1)
    day_span = 730  # 约两年，约 14 单/天，远低于 YW 每日 1000 号上限

    for n in range(ROWS):
        inst_id = ID_START + n
        bank_name, bank_code = rng.choice(BANKS)
        product = rng.choice(PRODUCT_LINES)
        env = rng.choice(BIZ_ENVS)
        severity = rng.choice(SEVERITIES)
        itype = rng.choice(ISSUE_TYPES)
        component = rng.choice(COMPONENTS)
        symptom = rng.choice(SYMPTOMS)
        err = rng.choice(ERROR_TEXTS)
        desc = f"{bank_name}{env}{symptom}"
        status_legacy = CLOSED_STATUS  # 全部统一「审核关闭」终态

        # 创建时间：在两年区间内均匀散布
        d0 = day_start + timedelta(days=rng.randint(0, day_span))
        created = datetime(d0.year, d0.month, d0.day, rng.randint(8, 18), rng.randint(0, 59))

        # 选路径：约 INDEPENDENT_NO_DEV_RATIO 的工单走独立闭环路径（运维分析后直接闭环、不经开发分析）。
        no_dev = rng.random() < INDEPENDENT_NO_DEV_RATIO
        path = INDEP_PATH if no_dev else FULL_PATH
        no_dev_cnt += int(no_dev)
        # 各阶段处理人两两不同（rng.sample 去重，PEOPLE=20 充足）；提单人=首节点处理人。
        people_seq = rng.sample(PEOPLE, len(path))
        handlers_by_node = {node: people_seq[i] for i, node in enumerate(path)}
        # 运维分析/开发分析（存在时）阶段改用 user_account 真实用户（随机、两两不同）
        ru = rng.sample(real_users, 2)
        handlers_by_node["运维分析"] = ru[0]
        if "开发分析" in handlers_by_node:
            handlers_by_node["开发分析"] = ru[1]
        creator = handlers_by_node[path[0]]
        closer = handlers_by_node[path[-1]]

        # parse 解析列：closed 工单填充较完整的字段集
        vals: dict[str, str] = {
            "column1": d0.isoformat(),
            "column2": bank_name,
            "column3": product,
            "column4": env,
            "column5": f"{bank_code}-INS-{n % 1000:03d}",
            "column6": rng.choice(GAUSS_VERSIONS),
            "column7": rng.choice(DEPLOY_FORMS),
            "column8": desc + "，需尽快定位",
            "column9": err,
            "column10": severity,
            "column11": itype,
            "column12": rng.choice(ROOT_CAUSE_CATEGORIES),
            "column17": rng.choice(CLOSE_REASONS),
            "column22": rng.choice(["是", "否"]),
            "column23": f"DTS{d0.strftime('%Y%m%d')}{inst_id % 100000:05d}",
            "column29": rng.choice(WORKAROUNDS),
            "column30": rng.choice(RECOVERY_METHODS),
            "column31": rng.choice(ROOT_CAUSES),
            "column47": itype,
            "column50": component,
            "column51": rng.choice(HCS_VERSIONS),
            "column53": f"eCare-{bank_code}-{d0.strftime('%Y%m%d')}",
            "column54": f"{creator[1]} {creator[0]}",  # hcs_owner: 账号 姓名
            "column60": rng.choice(IMPACT_LEVELS),
        }
        parses.append(build_parse_row(parse_id, inst_id, vals))
        parse_id += 1

        # 流转「日志流」：沿 path 逐节点提交 + 末节点（审核关闭）关闭
        time_by_node: dict[str, int] = {}
        t = created
        for i in range(len(path) - 1):  # transitions path[i] -> path[i+1]
            cur_node = path[i]
            nxt_node = path[i + 1]
            cur_handler = handlers_by_node[cur_node]
            nxt_handler = handlers_by_node[nxt_node]
            gap_h = rng.randint(2, 72)
            t = t + timedelta(hours=gap_h)
            time_by_node[cur_node] = gap_h * 60
            form_data = json.dumps(
                {"node": cur_node, "submit_by": cur_handler[0], "next": nxt_node},
                ensure_ascii=False,
            )
            tasks.append([
                task_id, inst_id, NODE_ID[cur_node], cur_node, NODE_ID[nxt_node], nxt_node,
                nxt_handler[0], nxt_handler[1], form_data, "提交", "1", gap_h * 60, "0",
                cur_handler[0], cur_handler[1], t, t, "0",
            ])
            task_id += 1
        # 末节点（审核关闭）提交「关闭」，无下一节点
        close_node = path[-1]
        gap_h = rng.randint(2, 72)
        t = t + timedelta(hours=gap_h)
        time_by_node[close_node] = gap_h * 60
        close_form = json.dumps(
            {"node": close_node, "close_by": closer[0], "reason": vals["column17"]},
            ensure_ascii=False,
        )
        tasks.append([
            task_id, inst_id, NODE_ID[close_node], close_node, None, "", "", "",
            close_form, "关闭", "1", gap_h * 60, "0", closer[0], closer[1], t, t, "0",
        ])
        task_id += 1

        # 工单实例：停在「审核关闭」、状态 closed；各阶段耗时取对应节点停留时长（缺省阶段为 0）
        instances.append([
            inst_id, 1, "HCS问题处理", NODE_ID["审核关闭"], "审核关闭",
            closer[0], closer[1], status_legacy, desc, severity,
            f"{severity}级受理", "运维受理组", 0,
            time_by_node.get("问题审核", 0), time_by_node.get("运维分析", 0),
            time_by_node.get("开发分析", 0), time_by_node.get("开发闭环", 0),
            time_by_node.get("运维闭环", 0), time_by_node.get("审核关闭", 0),
            creator[0], creator[1], created, t, "0",
        ])

    print(
        f"[INFO] 生成内存数据：{len(instances)} 实例 / {len(parses)} 解析 / {len(tasks)} 任务(日志流)"
        f"；其中独立闭环(不经开发分析) {no_dev_cnt} 条 / 完整链路 {len(instances) - no_dev_cnt} 条"
    )

    with psycopg.connect(target, autocommit=False) as conn:
        conn.execute(DDL)
        conn.commit()

        seed_info_and_nodes(conn)
        conn.commit()

        with conn.cursor().copy(
            f"COPY t_work_flow_instance ({', '.join(INSTANCE_COLS)}) FROM STDIN"
        ) as cp:
            for r in instances:
                cp.write_row(r)
        with conn.cursor().copy(
            f"COPY t_work_flow_task_parse ({', '.join(PARSE_COLS)}) FROM STDIN"
        ) as cp:
            for r in parses:
                cp.write_row(r)
        with conn.cursor().copy(
            f"COPY t_work_flow_task ({', '.join(TASK_COLS)}) FROM STDIN"
        ) as cp:
            for r in tasks:
                cp.write_row(r)
        conn.commit()

        inst_cnt = conn.execute("SELECT COUNT(*) FROM t_work_flow_instance").fetchone()[0]
        task_cnt = conn.execute("SELECT COUNT(*) FROM t_work_flow_task").fetchone()[0]
        closed_cnt = conn.execute(
            "SELECT COUNT(*) FROM t_work_flow_instance WHERE status = %s", (CLOSED_STATUS,)
        ).fetchone()[0]
        tables = conn.execute(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 't_work_flow_%'"
        ).fetchone()[0]
        print(f"[DONE] {DB_NAME}: 表 {tables} 张 / 工单 {inst_cnt} 条（closed {closed_cnt}）/ 日志流 {task_cnt} 条")
        print(f"[DONE] 连接串：{with_dbname('postgresql://USER:PWD@HOST:PORT/db', DB_NAME)}")


if __name__ == "__main__":
    main()
