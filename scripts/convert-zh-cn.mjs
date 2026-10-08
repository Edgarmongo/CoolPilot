import * as OpenCC from "opencc-js";
import { readFileSync, writeFileSync } from "node:fs";

const converter = OpenCC.Converter({ from: "hk", to: "cn" });

const zhHk = JSON.parse(readFileSync("src/locales/zh-hk.json", "utf-8"));
const zhCn = {};

for (const [key, value] of Object.entries(zhHk)) {
  zhCn[key] = typeof value === "string" ? converter(value) : value;
}

writeFileSync("src/locales/zh-cn.json", JSON.stringify(zhCn, null, 2) + "\n", "utf-8");
console.log(`zh-cn.json generated with ${Object.keys(zhCn).length} keys`);
