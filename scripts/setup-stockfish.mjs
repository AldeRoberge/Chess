// Copies the single-threaded lite Stockfish build (no COOP/COEP headers needed) into public/.
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/stockfish", { recursive: true });
for (const f of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"])
  cpSync(`node_modules/stockfish/bin/${f}`, `public/stockfish/${f}`);
console.log("stockfish copied to public/stockfish/");
