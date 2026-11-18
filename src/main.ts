import { boot } from "./app";
import "./ui/theme.css";
import { applyAppTheme, watchSystemScheme } from "./ui/appTheme";

applyAppTheme(); watchSystemScheme();
import { startOutputPage } from "./outputPage";

const out = new URLSearchParams(location.search).get("output");
if (out !== null) startOutputPage(Number(out) || 0);
else boot(document.getElementById("app")!).start();
