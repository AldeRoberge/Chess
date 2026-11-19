import { boot } from "./app";
import "./ui/theme.css";
import { applyAppTheme, watchSystemScheme } from "./ui/appTheme";

import { installUiScale } from "./ui/uiScale";

applyAppTheme(); watchSystemScheme(); installUiScale();
import { startOutputPage } from "./outputPage";
import { firstRun, showSplash } from "./ui/splash";

const out = new URLSearchParams(location.search).get("output");
if (out !== null) startOutputPage(Number(out) || 0);
else { boot(document.getElementById("app")!).start(); if (firstRun()) void showSplash(); }
