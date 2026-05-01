const UPLOAD_CHART_COLORS = [
  "#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de",
  "#3ba272", "#fc8452", "#9a60b4", "#ea7ccc", "#48b8d0"
];

export { UPLOAD_CHART_COLORS };

export function findNameColumn(preview) {
  const sheets = preview?.sheets || [];
  const candidates = ["名称", "姓名", "名字", "name", "人员", "同学", "员工姓名", "员工"];

  for (const sheet of sheets) {
    const columns = sheet.columns || [];
    for (const col of columns) {
      const colName = col.name || col;
      const lowerName = colName.toLowerCase();
      for (const cand of candidates) {
        if (lowerName.includes(cand.toLowerCase())) {
          return colName;
        }
      }
    }
  }

  if (sheets.length > 0 && sheets[0].columns && sheets[0].columns.length > 0) {
    return sheets[0].columns[0].name || sheets[0].columns[0];
  }
  return "";
}
