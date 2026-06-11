import React from "react";
import ReactDOM from "react-dom/client";
import App, { renderStandalonePrintableReportIfRequested } from "./App";
import { runDevSqliteRuntimeCheck } from "./lib/sqliteRuntime";
import "./styles.css";

if (!renderStandalonePrintableReportIfRequested()) {
  void runDevSqliteRuntimeCheck();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

