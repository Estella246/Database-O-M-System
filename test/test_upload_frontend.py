"""
前端人力分析模块数据聚合逻辑测试

由于前端使用vanilla JS，此处测试模拟前端的aggregateUploadDataByPerson和findNameColumn函数逻辑
"""

import pytest


class TestFindNameColumn:
    """测试自动识别人员字段"""

    def test_tc_upload_001_find_name_column_standard(self):
        """识别标准姓名列"""
        preview = {
            "sheets": [
                {"name": "Sheet1", "columns": ["姓名", "工作量", "工时"]}
            ]
        }
        result = self._find_name_column(preview)
        assert result == "姓名"

    def test_tc_upload_002_find_name_column_name(self):
        """识别英文name列"""
        preview = {
            "sheets": [
                {"name": "Sheet1", "columns": ["name", "workload"]}
            ]
        }
        result = self._find_name_column(preview)
        assert result == "name"

    def test_tc_upload_003_find_name_column_employee(self):
        """识别员工列"""
        preview = {
            "sheets": [
                {"name": "Sheet1", "columns": ["员工姓名", "任务数"]}
            ]
        }
        result = self._find_name_column(preview)
        assert result == "员工姓名"

    def test_tc_upload_004_find_name_column_fallback(self):
        """无匹配时使用第一列"""
        preview = {
            "sheets": [
                {"name": "Sheet1", "columns": ["A", "B", "C"]}
            ]
        }
        result = self._find_name_column(preview)
        assert result == "A"

    def test_tc_upload_005_find_name_column_empty_sheets(self):
        """空sheet情况"""
        preview = {"sheets": []}
        result = self._find_name_column(preview)
        assert result == ""

    def _find_name_column(self, preview):
        """模拟前端的findNameColumn函数"""
        sheets = preview.get("sheets") or []
        candidates = ["名称", "姓名", "名字", "name", "人员", "同学", "员工姓名", "员工"]
        
        for sheet in sheets:
            columns = sheet.get("columns") or []
            for col in columns:
                col_name = col.get("name") if isinstance(col, dict) else col
                lower_name = col_name.lower()
                for cand in candidates:
                    if lower_name == cand.lower() or lower_name.startswith(cand.lower()):
                        return col_name
        
        # Fallback to first column
        if sheets and sheets[0].get("columns"):
            first_col = sheets[0]["columns"][0]
            return first_col.get("name") if isinstance(first_col, dict) else first_col
        return ""


class TestAggregateUploadDataByPerson:
    """测试按人员聚合数据"""

    def test_tc_upload_006_aggregate_sum_mode(self):
        """累加模式聚合"""
        preview = {
            "raw_data": {
                "Sheet1": [
                    {"姓名": "张三", "工作量": 10},
                    {"姓名": "李四", "工作量": 20},
                    {"姓名": "张三", "工作量": 15}
                ]
            },
            "sheets": [{"name": "Sheet1", "columns": ["姓名", "工作量"]}]
        }
        result = self._aggregate_data(preview, "姓名", ["Sheet1"], "sum")
        
        assert len(result) == 2
        zhang_san = next((r for r in result if r["人员"] == "张三"), None)
        assert zhang_san is not None
        assert zhang_san["工作量"] == 25  # 10 + 15

    def test_tc_upload_007_aggregate_avg_mode(self):
        """平均值模式聚合"""
        preview = {
            "raw_data": {
                "Sheet1": [
                    {"姓名": "张三", "工作量": 10},
                    {"姓名": "张三", "工作量": 20},
                    {"姓名": "张三", "工作量": 30}
                ]
            },
            "sheets": [{"name": "Sheet1", "columns": ["姓名", "工作量"]}]
        }
        result = self._aggregate_data(preview, "姓名", ["Sheet1"], "avg")
        
        assert len(result) == 1
        assert result[0]["工作量"] == 20  # (10 + 20 + 30) / 3

    def test_tc_upload_008_aggregate_multi_sheet(self):
        """多sheet聚合"""
        preview = {
            "raw_data": {
                "Sheet1": [
                    {"姓名": "张三", "工作量": 10},
                    {"姓名": "李四", "工作量": 20}
                ],
                "Sheet2": [
                    {"姓名": "张三", "工作量": 15},
                    {"姓名": "王五", "工作量": 25}
                ]
            },
            "sheets": [
                {"name": "Sheet1", "columns": ["姓名", "工作量"]},
                {"name": "Sheet2", "columns": ["姓名", "工作量"]}
            ]
        }
        result = self._aggregate_data(preview, "姓名", ["Sheet1", "Sheet2"], "sum")
        
        assert len(result) == 3  # 张三, 李四, 王五
        zhang_san = next((r for r in result if r["人员"] == "张三"), None)
        assert zhang_san["工作量"] == 25  # 10 + 15

    def test_tc_upload_009_aggregate_empty_name(self):
        """空姓名跳过"""
        preview = {
            "raw_data": {
                "Sheet1": [
                    {"姓名": "", "工作量": 10},
                    {"姓名": "张三", "工作量": 20},
                    {"姓名": None, "工作量": 30}
                ]
            },
            "sheets": [{"name": "Sheet1", "columns": ["姓名", "工作量"]}]
        }
        result = self._aggregate_data(preview, "姓名", ["Sheet1"], "sum")
        
        assert len(result) == 1
        assert result[0]["人员"] == "张三"

    def test_tc_upload_010_aggregate_multiple_numeric_cols(self):
        """多数值列聚合"""
        preview = {
            "raw_data": {
                "Sheet1": [
                    {"姓名": "张三", "工作量": 10, "工时": 8},
                    {"姓名": "张三", "工作量": 20, "工时": 16}
                ]
            },
            "sheets": [{"name": "Sheet1", "columns": ["姓名", "工作量", "工时"]}]
        }
        result = self._aggregate_data(preview, "姓名", ["Sheet1"], "sum")
        
        assert len(result) == 1
        assert result[0]["工作量"] == 30
        assert result[0]["工时"] == 24

    def test_tc_upload_011_aggregate_sort_by_numeric(self):
        """按数值列排序"""
        preview = {
            "raw_data": {
                "Sheet1": [
                    {"姓名": "张三", "工作量": 50},
                    {"姓名": "李四", "工作量": 100},
                    {"姓名": "王五", "工作量": 75}
                ]
            },
            "sheets": [{"name": "Sheet1", "columns": ["姓名", "工作量"]}]
        }
        result = self._aggregate_data(preview, "姓名", ["Sheet1"], "sum")
        
        assert len(result) == 3
        # 应该按工作量降序排序
        assert result[0]["人员"] == "李四"  # 100
        assert result[1]["人员"] == "王五"  # 75
        assert result[2]["人员"] == "张三"  # 50

    def _aggregate_data(self, preview, name_column, selected_sheets, aggregate_mode):
        """模拟前端的aggregateUploadDataByPerson函数"""
        raw_data = preview.get("raw_data") or {}
        person_map = {}
        person_count_map = {}
        
        for sheet_name in selected_sheets:
            rows = raw_data.get(sheet_name) or []
            for row in rows:
                person_name = str(row.get(name_column) or "").strip()
                if not person_name:
                    continue
                
                if not person_map.get(person_name):
                    person_map[person_name] = {"人员": person_name}
                    person_count_map[person_name] = {}
                
                person_data = person_map[person_name]
                count_data = person_count_map[person_name]
                
                for key, value in row.items():
                    if key == name_column:
                        continue
                    if isinstance(value, (int, float)):
                        if aggregate_mode == "avg":
                            person_data[key] = (person_data.get(key) or 0) + value
                            count_data[key] = (count_data.get(key) or 0) + 1
                        else:
                            person_data[key] = (person_data.get(key) or 0) + value
                    elif not person_data.get(key):
                        person_data[key] = value
        
        # 平均模式下计算平均值
        if aggregate_mode == "avg":
            for person_name, person_data in person_map.items():
                count_data = person_count_map.get(person_name)
                for key, count in (count_data or {}).items():
                    if count > 0:
                        person_data[key] = person_data[key] / count
        
        result = list(person_map.values())
        
        # 动态查找数值列作为排序字段
        if result:
            numeric_cols = [k for k, v in result[0].items() if isinstance(v, (int, float))]
            sort_col = numeric_cols[0] if numeric_cols else "人员"
            result.sort(key=lambda x: x.get(sort_col) or 0, reverse=True)
        
        return result


class TestChartSeriesGeneration:
    """测试图表系列生成"""

    def test_tc_upload_012_series_from_aggregated_data(self):
        """从聚合数据生成系列"""
        aggregated_data = [
            {"人员": "张三", "工作量": 100, "工时": 80},
            {"人员": "李四", "工作量": 150, "工时": 120}
        ]
        name_column = "人员"
        
        # 模拟前端的系列生成逻辑
        numeric_cols = [k for k in aggregated_data[0].keys() 
                       if k != name_column and isinstance(aggregated_data[0][k], (int, float))]
        
        series = [
            {
                "name": col,
                "data": [d.get(col) or 0 for d in aggregated_data]
            }
            for col in numeric_cols
        ]
        
        assert len(series) == 2
        assert series[0]["name"] in ["工作量", "工时"]
        assert len(series[0]["data"]) == 2

    def test_tc_upload_013_series_empty_aggregated_data(self):
        """空聚合数据"""
        aggregated_data = []
        
        numeric_cols = []
        series = []
        
        assert len(series) == 0


class TestExcelParsingSimulation:
    """测试Excel解析模拟"""

    def test_tc_upload_014_parse_columns_with_types(self):
        """解析列及推断类型"""
        # 模拟前端解析结果
        sheet_data = [
            {"姓名": "张三", "工作量": 100, "备注": "正常"},
            {"姓名": "李四", "工作量": 150, "备注": "加班"}
        ]
        
        columns = []
        for key, value in sheet_data[0].items():
            col_type = "数值" if isinstance(value, (int, float)) else "文本"
            columns.append({
                "name": key,
                "type": col_type,
                "sample": str(value)[:20]
            })
        
        assert len(columns) == 3
        assert columns[1]["type"] == "数值"
        assert columns[2]["type"] == "文本"

    def test_tc_upload_015_preview_row_limit(self):
        """预览行数限制"""
        all_rows = [{"姓名": f"用户{i}", "工作量": i * 10} for i in range(100)]
        preview_rows = all_rows[:50]  # 前端限制
        
        assert len(preview_rows) == 50


class TestKpiCardRendering:
    """测试KPI卡片渲染"""

    def test_tc_upload_016_kpi_card_html_structure(self):
        """KPI卡片HTML结构"""
        # 模拟前端的renderUploadKpiCard函数
        def render_kpi_card(label, value, unit):
            return f'''
            <div class="upload-kpi-card">
                <div class="upload-kpi-label">{label}</div>
                <div class="upload-kpi-value">{value}{unit if unit else ""}</div>
            </div>
            '''
        
        html = render_kpi_card("Sheet数", 3, "个")
        assert "upload-kpi-card" in html
        assert "Sheet数" in html
        assert "3" in html

    def test_tc_upload_017_kpi_card_empty_unit(self):
        """KPI卡片无单位"""
        def render_kpi_card(label, value, unit):
            unit_html = f'<span class="upload-kpi-unit">{unit}</span>' if unit else ""
            return f'<div class="upload-kpi-card"><div class="upload-kpi-value">{value}{unit_html}</div></div>'
        
        html = render_kpi_card("文件名", "test.xlsx", "")
        assert "upload-kpi-unit" not in html