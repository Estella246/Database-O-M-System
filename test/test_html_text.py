"""html_text 工具单元测试。"""
from utils.html_text import strip_html_plain


def test_strip_html_plain_removes_tags():
    assert strip_html_plain("<p>数据库<strong>异常</strong>中断</p>") == "数据库 异常 中断"


def test_strip_html_plain_decodes_entities():
    assert strip_html_plain("<p>foo&nbsp;bar&amp;baz</p>") == "foo bar&baz"
