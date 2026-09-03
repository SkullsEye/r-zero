const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const html = fs.readFileSync(path.join(HERE, "index.html"), "utf8");
const grab = id => {
  const m = html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`));
  if (!m) throw new Error("missing payload: " + id);
  return m[1];
};

const stubs = {};
const blank = id => (stubs[id] = stubs[id] || {
  textContent: /-json$/.test(id) ? grab(id) : "",
  style: {}, classList: { toggle() {}, add() {}, remove() {} }, dataset: {}, value: "0",
  addEventListener() {}, hidden: false, innerHTML: "", checked: false,
  querySelectorAll: () => [], closest: () => null, click() {}, setAttribute() {},
  getAttribute: () => null, files: null, focus() {}, scrollIntoView() {},
});
global.document = { getElementById: blank, querySelectorAll: () => [], title: "" };
global.window = global;
global.requestAnimationFrame = () => {};
global.setTimeout = (fn) => fn && fn();
global.performance = { now: () => 0 };
global.location = { hash: "" };
global.atob = s => Buffer.from(s, "base64").toString("binary");
global.addEventListener = () => {};
global.scrollTo = () => {};

let body = html.match(/<script>\n\(function \(\) \{([\s\S]*)\}\)\(\);\n<\/script>/)[1];
body = body.split("/* ------------------------------------------------------------------- boot */")[0];
body += "\nglobal.__api = { MODEL, datasetFromPayload, makeEngine, evalTrees, plainIdx, NP, calibrate, applyTest };";
new Function(body)();
const { MODEL, datasetFromPayload, makeEngine, evalTrees, plainIdx, NP, calibrate, applyTest } = global.__api;

const ds = datasetFromPayload();
const engine = makeEngine(ds);
const v = new Float64Array(MODEL.features.length);
const pv = new Float64Array(NP);
const full = new Float64Array(ds.n);
const plain = new Float64Array(ds.n);

const started = Date.now();
for (let i = 0; i < ds.n; i++) {
  engine.step(i, v);
  full[i] = evalTrees(MODEL.trees, v);
  for (let q = 0; q < NP; q++) pv[q] = v[plainIdx[q]];
  plain[i] = evalTrees(MODEL.plainTrees, pv);
  if (ds.y[i] === 1) engine.confirm(i);
}

const order = arr => Array.from({ length: ds.n }, (_, i) => i).sort((a, b) => arr[b] - arr[a]);
const total = ds.y.reduce((a, b) => a + (b === 1 ? 1 : 0), 0);
const prAuc = o => { let h = 0, s = 0; o.forEach((k, r) => { if (ds.y[k] === 1) { h++; s += h / (r + 1); } }); return s / total; };
const precision = (o, d) => o.slice(0, d).reduce((a, k) => a + (ds.y[k] === 1 ? 1 : 0), 0) / d;

const oF = order(full), oP = order(plain);
const ref = ds.ref.full, refP = ds.ref.noContagion;
const row = (name, a, b) => {
  const ok = Math.abs(a - b) < 5e-4;
  console.log(`  ${name.padEnd(22)}browser ${a.toFixed(4).padStart(8)}   python ${b.toFixed(4).padStart(8)}   ${ok ? "ok" : "MISMATCH"}`);
  return ok;
};

console.log(`${ds.n.toLocaleString()} transactions, ${total.toLocaleString()} fraudulent, scored in ${Date.now() - started} ms\n`);
console.log("with contagion");
let pass = [row("PR-AUC", prAuc(oF), ref.pr), row("precision@50", precision(oF, 50), ref.p50),
            row("precision@100", precision(oF, 100), ref.p100), row("precision@1000", precision(oF, 1000), ref.p1000)];
console.log("\ncontagion removed");
pass = pass.concat([row("PR-AUC", prAuc(oP), refP.pr), row("precision@50", precision(oP, 50), refP.p50),
                    row("precision@100", precision(oP, 100), refP.p100), row("precision@1000", precision(oP, 1000), refP.p1000)]);

const scores = path.join(HERE, "reference_scores.npy");
if (fs.existsSync(scores)) {
  const buf = fs.readFileSync(scores);
  const off = buf.indexOf("\n", 8) + 1;
  const ref2 = new Float64Array(buf.buffer, buf.byteOffset + off, ds.n * 2);
  let worst = 0;
  for (let i = 0; i < ds.n; i++)
    worst = Math.max(worst, Math.abs(full[i] - ref2[i * 2]), Math.abs(plain[i] - ref2[i * 2 + 1]));
  console.log(`\nlargest per-transaction disagreement with LightGBM: ${worst.toExponential(2)}`);
  pass.push(worst < 1e-12);
}

const keys = new Array(ds.n);
for (let i = 0; i < ds.n; i++) keys[i] = ds.code[0][i] > 0 ? "c" + ds.code[0][i] : "r" + i;
const half = Math.floor(ds.n * 0.55);
const c = calibrate([...full.slice(0, half)], [...ds.y.slice(0, half)], keys.slice(0, half), 0.01);
const applied = applyTest(c, [...full.slice(half)], [...ds.y.slice(half)], keys.slice(half));
console.log(`\ncalibration: boundary ${c.upper.toFixed(2)} fitted on the first ${half.toLocaleString()} rows`);
console.log(`  target 1.00%   achieved on held-out rows ${(100 * applied.customerFalse).toFixed(2)}% per customer`);
const calOk = applied.customerFalse < 0.04 && applied.customerFalse > 0;
console.log(`  ${calOk ? "ok" : "OUT OF RANGE"}`);
pass.push(calOk);

console.log(pass.every(Boolean) ? "\nPASS" : "\nFAIL");
process.exit(pass.every(Boolean) ? 0 : 1);
