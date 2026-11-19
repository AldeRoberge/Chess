import { boot } from "./app";
import "./ui/theme.css";
import { applyAppTheme, watchSystemScheme } from "./ui/appTheme";

applyAppTheme(); watchSystemScheme();
import { startOutputPage } from "./outputPage";
import { firstRun, showSplash } from "./ui/splash";
import { isRemoteHash } from "./remote/protocol";

const out = new URLSearchParams(location.search).get("output");
if (out !== null) startOutputPage(Number(out) || 0);
else if (isRemoteHash(location.hash)) void import("./remote/client").then((m) => m.mountRemote(document.getElementById("app")!));
else { boot(document.getElementById("app")!).start(); if (firstRun()) void showSplash(); }
