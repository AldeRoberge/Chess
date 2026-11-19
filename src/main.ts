import "./style.css";
import "./ui/theme.css";
import { applyAppTheme, onAppTheme, watchSystemScheme } from "./ui/appTheme";

import { installUiScale } from "./ui/uiScale";

import { syncFavicon } from "./ui/brandIcon";
applyAppTheme(); onAppTheme(syncFavicon); syncFavicon(); watchSystemScheme(); installUiScale();
import { isRemoteHash } from "./remote/protocol";
import { mountJoinLanding, wantsJoinScreen } from "./remote/landing";

const out = new URLSearchParams(location.search).get("output");
if (out !== null) void import("./outputPage").then((m) => m.startOutputPage(Number(out) || 0)).catch(showStartupError);
else if (isRemoteHash(location.hash)) startRemote();
else if (!location.hash && wantsJoinScreen()) mountJoinLanding(document.getElementById("app")!, {
  onJoin: (code) => { location.hash = `#/remote?code=${encodeURIComponent(code)}`; startRemote(); },
  onApp: startApp,
});
else startApp();
function startRemote() {
  document.getElementById("app")!.textContent = "Connecting to the game…";
  void import("./remote/client").then((m) => m.mountRemote(document.getElementById("app")!)).catch(showStartupError);
}
function startApp() {
  void Promise.all([import("./app"), import("./ui/splash")]).then(([{ boot }, { firstRun, fromHotReload, showSplash }]) => {
    boot(document.getElementById("app")!).start();
    if (!fromHotReload()) void showSplash(document.body, !firstRun());
  }).catch(showStartupError);
}
function showStartupError(error: unknown) {
  console.error("Page startup failed", error);
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = `Unable to open the page. ${error instanceof Error ? error.message : String(error)}`;
  const retry = document.createElement("button"); retry.textContent = "Try again"; retry.onclick = () => location.reload();
  document.getElementById("app")!.replaceChildren(message, retry);
}
