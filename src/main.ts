import { boot } from "./app";
import "./ui/theme.css";
import { applyAppTheme, onAppTheme, watchSystemScheme } from "./ui/appTheme";

import { installUiScale } from "./ui/uiScale";

import { syncFavicon } from "./ui/brandIcon";
applyAppTheme(); onAppTheme(syncFavicon); syncFavicon(); watchSystemScheme(); installUiScale();
import { startOutputPage } from "./outputPage";
import { firstRun, fromHotReload, showSplash } from "./ui/splash";
import { isRemoteHash } from "./remote/protocol";
import { mountJoinLanding, wantsJoinScreen } from "./remote/landing";

const out = new URLSearchParams(location.search).get("output");
if (out !== null) startOutputPage(Number(out) || 0);
else if (isRemoteHash(location.hash)) void import("./remote/client").then((m) => m.mountRemote(document.getElementById("app")!));
else if (!location.hash && wantsJoinScreen()) mountJoinLanding(document.getElementById("app")!, {
  onJoin: (code) => { location.hash = `#/remote?code=${encodeURIComponent(code)}`; void import("./remote/client").then((m) => m.mountRemote(document.getElementById("app")!)); },
  onApp: startApp,
});
else startApp();
function startApp() { boot(document.getElementById("app")!).start(); if (!fromHotReload()) void showSplash(document.body, !firstRun()); }
