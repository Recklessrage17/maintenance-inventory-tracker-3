import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { runDevSqliteRuntimeCheck } from "./lib/sqliteRuntime";
import "./styles.css";

void runDevSqliteRuntimeCheck();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

