import React, { useCallback, useEffect, useMemo, useState } from "react";
import FormSelector from "./FormSelector.jsx";
import { loadDashboardConfig, saveDashboardConfig, makeWidgetId } from "./dashboardConfig.js";
import { getRecordsFromCache } from "../../app/state/recordsCache.js";
import BarPieChartWidget from "./widgets/BarPieChartWidget.jsx";
import TimeSeriesWidget from "./widgets/TimeSeriesWidget.jsx";
import PivotTableWidget from "./widgets/PivotTableWidget.jsx";
import DescriptiveStatsWidget from "./widgets/DescriptiveStatsWidget.jsx";
import CustomCodeCellWidget from "./widgets/CustomCodeCellWidget.jsx";

const WIDGET_TYPE_LABELS = {
  barPie: "棒/円グラフ",
  timeSeries: "時系列",
  pivot: "クロス集計",
  stats: "記述統計",
  customCode: "カスタムコード",
};

export default function DashboardLayout({ forms }) {
  const [selectedFormIds, setSelectedFormIds] = useState([]);
  const [recordsByForm, setRecordsByForm] = useState({});
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [widgets, setWidgets] = useState([]);
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const config = await loadDashboardConfig();
      if (!active) return;
      if (config) {
        if (Array.isArray(config.selectedFormIds)) {
          setSelectedFormIds(config.selectedFormIds);
        }
        if (Array.isArray(config.widgets)) {
          setWidgets(config.widgets);
        }
      }
      setConfigLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    void saveDashboardConfig({ selectedFormIds, widgets });
  }, [selectedFormIds, widgets, configLoaded]);

  useEffect(() => {
    if (selectedFormIds.length === 0) {
      setRecordsByForm({});
      return;
    }
    let active = true;
    setLoadingRecords(true);
    (async () => {
      const results = await Promise.all(
        selectedFormIds.map(async (formId) => {
          const data = await getRecordsFromCache(formId);
          return [formId, data];
        }),
      );
      if (!active) return;
      const next = {};
      results.forEach(([formId, data]) => {
        next[formId] = data;
      });
      setRecordsByForm(next);
      setLoadingRecords(false);
    })();
    return () => {
      active = false;
    };
  }, [selectedFormIds]);

  const formsById = useMemo(() => {
    const map = {};
    forms.forEach((form) => {
      map[form.id] = form;
    });
    return map;
  }, [forms]);

  const handleAddWidget = useCallback((type) => {
    setWidgets((prev) => [
      ...prev,
      {
        id: makeWidgetId(),
        type,
        formId: selectedFormIds[0] || "",
        config: {},
      },
    ]);
  }, [selectedFormIds]);

  const handleUpdateWidget = useCallback((widgetId, patch) => {
    setWidgets((prev) => prev.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)));
  }, []);

  const handleRemoveWidget = useCallback((widgetId) => {
    setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
  }, []);

  const handleMoveWidget = useCallback((widgetId, delta) => {
    setWidgets((prev) => {
      const idx = prev.findIndex((w) => w.id === widgetId);
      if (idx < 0) return prev;
      const target = idx + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  }, []);

  return (
    <div className="dashboard-root">
      <FormSelector
        forms={forms}
        selectedFormIds={selectedFormIds}
        onChange={setSelectedFormIds}
        recordsByForm={recordsByForm}
        loading={loadingRecords}
      />

      <div className="dashboard-add-bar nf-row nf-gap-6 nf-mt-12">
        <span className="nf-text-muted nf-text-13">ウィジェット追加:</span>
        {Object.entries(WIDGET_TYPE_LABELS).map(([type, label]) => (
          <button
            key={type}
            type="button"
            className="nf-btn-outline nf-text-13"
            onClick={() => handleAddWidget(type)}
            disabled={selectedFormIds.length === 0 && type !== "customCode"}
          >
            + {label}
          </button>
        ))}
      </div>

      <div className="dashboard-grid nf-mt-16">
        {widgets.length === 0 && (
          <p className="nf-text-subtle">
            上のボタンからウィジェットを追加してください。集計には少なくとも1つのフォームを選択してください。
          </p>
        )}
        {widgets.map((widget, index) => (
          <DashboardWidget
            key={widget.id}
            widget={widget}
            index={index}
            total={widgets.length}
            forms={forms}
            formsById={formsById}
            recordsByForm={recordsByForm}
            selectedFormIds={selectedFormIds}
            onUpdate={(patch) => handleUpdateWidget(widget.id, patch)}
            onRemove={() => handleRemoveWidget(widget.id)}
            onMove={(delta) => handleMoveWidget(widget.id, delta)}
          />
        ))}
      </div>
    </div>
  );
}

function DashboardWidget({
  widget,
  index,
  total,
  forms,
  formsById,
  recordsByForm,
  selectedFormIds,
  onUpdate,
  onRemove,
  onMove,
}) {
  const commonProps = {
    widget,
    forms,
    formsById,
    recordsByForm,
    selectedFormIds,
    onUpdate,
  };

  let body = null;
  switch (widget.type) {
    case "barPie":
      body = <BarPieChartWidget {...commonProps} />;
      break;
    case "timeSeries":
      body = <TimeSeriesWidget {...commonProps} />;
      break;
    case "pivot":
      body = <PivotTableWidget {...commonProps} />;
      break;
    case "stats":
      body = <DescriptiveStatsWidget {...commonProps} />;
      break;
    case "customCode":
      body = <CustomCodeCellWidget {...commonProps} />;
      break;
    default:
      body = <p className="nf-text-danger">未知のウィジェット種別: {widget.type}</p>;
  }

  return (
    <div className="dashboard-widget nf-card nf-mb-16">
      <div className="dashboard-widget-header nf-row nf-gap-6 nf-mb-8">
        <strong className="nf-text-13">{WIDGET_TYPE_LABELS[widget.type] || widget.type}</strong>
        <span className="nf-flex-1" />
        <button
          type="button"
          className="nf-btn-outline nf-text-12"
          onClick={() => onMove(-1)}
          disabled={index === 0}
        >
          ↑
        </button>
        <button
          type="button"
          className="nf-btn-outline nf-text-12"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
        >
          ↓
        </button>
        <button
          type="button"
          className="nf-btn-outline nf-text-12 admin-danger-btn"
          onClick={onRemove}
        >
          削除
        </button>
      </div>
      {body}
    </div>
  );
}
