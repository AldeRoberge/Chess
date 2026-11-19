import { boot } from "./app";
import "./ui/theme.css";
import { applyAppTheme, watchSystemScheme } from "./ui/appTheme";

applyAppTheme(); watchSystemScheme();
import { startOutputPage } from "./outputPage";
import { firstRun, showSplash } from "./ui/splash";

const out = new URLSearchParams(location.search).get("output");
if (out !== null) startOutputPage(Number(out) || 0);
// Splash: once per browser session (a reload in the same tab skips it). Shown before boot so a slow or failing boot cannot hide it.
else {
  if (firstRun(sessionStorage)) void showSplash();
  boot(document.getElementById("app")!).start();
}
