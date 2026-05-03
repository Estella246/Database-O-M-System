import pytest

pytestmark = pytest.mark.e2e


class TestModuleImportIntegrity:

    def test_tc_e2e_016_no_failed_module_loads(self, page, backend_server, collect_js_errors):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        failed_modules = []
        for e in collect_js_errors:
            msg = str(e) if not hasattr(e, "text") else e.text
            if "ERR_ABORTED" in msg and ".js" in msg:
                failed_modules.append(msg)
        assert failed_modules == [], f"发现 {len(failed_modules)} 个模块加载失败:\n" + "\n".join(failed_modules)

    def test_tc_e2e_017_core_functions_accessible(self, page, backend_server):
        page.goto(f"{backend_server}/")
        page.wait_for_selector("#root", timeout=10000)
        page.wait_for_timeout(3000)
        checks = page.evaluate("""() => {
            const results = {};
            try { results.documentReady = document.readyState === 'complete' || document.readyState === 'interactive'; } catch(e) { results.documentReady = false; }
            try { results.rootElement = !!document.getElementById('root'); } catch(e) { results.rootElement = false; }
            try { results.hasContent = document.getElementById('root')?.children?.length > 0; } catch(e) { results.hasContent = false; }
            return results;
        }""")
        assert checks["documentReady"], "页面 document 未就绪"
        assert checks["rootElement"], "#root 元素不存在"
        assert checks["hasContent"], "#root 元素无子节点，页面可能未渲染"
