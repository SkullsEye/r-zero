
/* ------------------------------------------------------------- model page */
const EXAMPLE_CSV = `timestamp,amount,card,address,email,device,isFraud
3600,249.00,4032,204,gmail.com,SM-G930V,0
7200,88.50,7781,325,yahoo.com,Windows,0
10800,19.99,9143,881,anonymous.com,Trident/7.0,1
11040,19.99,9207,881,anonymous.com,Trident/7.0,1
11280,24.50,9366,881,anonymous.com,Trident/7.0,1
11520,19.99,9143,881,anonymous.com,Trident/7.0,1
90000,64.20,4032,204,gmail.com,SM-G930V,0
176400,120.00,7781,325,yahoo.com,Windows,0
262800,31.00,5510,118,hotmail.com,MacOS,0
349200,74.00,4032,204,gmail.com,SM-G930V,0
435600,58.00,5510,118,hotmail.com,MacOS,0
522000,143.00,7781,325,yahoo.com,Windows,0
608400,92.00,4032,204,gmail.com,SM-G930V,0
619200,340.00,8815,325,yahoo.com,Windows,0
619800,320.00,6602,881,anonymous.com,Trident/7.0,1
702000,41.00,4032,204,gmail.com,SM-G930V,0`;

const LABELS = { timestamp: "Time", amount: "Amount", card: "Card", address: "Address",
                 email: "Email", device: "Device", label: "Outcome" };
let source = "sample", table = null, mapping = null, rawText = "";

function describe() {
  if (!table) { el("src-note").textContent = "your CSV"; return; }
  const known = FIELDS.filter(f => mapping[f] >= 0).length;
  el("src-note").textContent = `${fmtInt(table.rows.length)} rows · ${known} of 7 columns matched`;
}

function renderMapping() {
  const grid = el("map-grid");
  if (!table) { el("map-wrap").hidden = true; return; }
  el("map-wrap").hidden = false;
  el("has-header").checked = table.hasHeader;
  grid.innerHTML = FIELDS.map(f => `
    <div class="map-row ${mapping[f] < 0 ? "unset" : ""}">
      <label for="map-${f}">${LABELS[f]}</label>
      <select id="map-${f}" data-field="${f}">
        <option value="-1"${mapping[f] < 0 ? " selected" : ""}>not in my file</option>
        ${table.header.map((h, i) => `<option value="${i}"${mapping[f] === i ? " selected" : ""}>${esc(h)}</option>`).join("")}
      </select></div>`).join("");
  grid.querySelectorAll("select").forEach(sel => sel.addEventListener("change", () => {
    mapping[sel.dataset.field] = Number(sel.value);
    sel.closest(".map-row").classList.toggle("unset", Number(sel.value) < 0);
    describe();
  }));
  describe();
}

function load(text, name, forceHeader) {
  rawText = text;
  const parsed = sniff(text, forceHeader);
  if (parsed.error) {
    table = null; mapping = null;
    el("map-wrap").hidden = true; el("loaded").hidden = true;
    el("csv-err").textContent = parsed.error; el("csv-err").hidden = false;
    describe(); return false;
  }
  el("csv-err").hidden = true;
  table = parsed;
  mapping = guessMapping(parsed.header, !parsed.hasHeader);
  el("loaded").hidden = !name;
  if (name) {
    el("loaded-name").textContent = name;
    el("loaded-rows").textContent = parsed.truncated
      ? `${fmtInt(parsed.total)} rows, first ${fmtInt(MAX_ROWS)} used` : `${fmtInt(parsed.rows.length)} rows`;
  }
  renderMapping();
  return true;
}

function readFile(f) {
  if (f.size > 80 * 1024 * 1024) {
    el("csv-err").textContent = "That file is over 80 MB. Try a slice of it.";
    el("csv-err").hidden = false; return;
  }
  const reader = new FileReader();
  reader.onload = () => load(String(reader.result), f.name);
  reader.onerror = () => {
    el("csv-err").textContent = "Could not read that file.";
    el("csv-err").hidden = false;
  };
  reader.readAsText(f);
}

function initModelInputs() {
  document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
    source = b.dataset.src;
    document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    ["sample", "simulate", "paste"].forEach(p => el("pane-" + p).hidden = p !== source);
    el("lag-field").hidden = source === "sample";
    if (source === "paste") describe();
    else el("src-note").textContent = source === "sample" ? "83,571 real transactions" : "synthetic stream";
  }));
  const syncLabels = () => {
    el("v-n").textContent = fmtInt(Number(el("s-n").value));
    el("v-rate").textContent = (Number(el("s-rate").value) / 10).toFixed(1) + "%";
    const r = Number(el("s-ring").value);
    el("v-ring").textContent = r === 1 ? "1 card (lone)" : r + " cards";
    const b = Number(el("s-burst").value);
    el("v-burst").textContent = b >= 60 ? (b / 60).toFixed(1) + " h" : b + " min";
  };
  ["s-n", "s-rate", "s-ring", "s-burst"].forEach(i => el(i).addEventListener("input", syncLabels));
  syncLabels();
  const LAGTEXT = { "0.0417": "1 hour", "0.25": "6 hours", "1": "1 day", "3": "3 days", "7": "7 days", "21": "21 days" };
  const syncLag = () => {
    const t = LAGTEXT[el("s-lag").value] || el("s-lag").value + " days";
    el("v-lag").textContent = t;
    el("lag-note").innerHTML = `Confirmed frauds enter the contagion state <b>${t}</b> after they occur.
      Nothing inside that window can influence a score.`;
  };
  el("s-lag").addEventListener("change", syncLag); syncLag();
  const LATTEXT = ["15 minutes", "1 hour", "4 hours", "12 hours", "1 day", "3 days", "1 week", "never (an automatic block)"];
  const syncDesk = () => {
    el("v-cap").textContent = el("s-cap").value + " / day";
    el("v-lat").textContent = LATTEXT[Number(el("s-lat").value)];
  };
  el("s-cap").addEventListener("input", syncDesk);
  el("s-lat").addEventListener("input", syncDesk);
  syncDesk();

  el("s-csv").value = EXAMPLE_CSV;
  load(EXAMPLE_CSV, null);
  let typing = null;
  el("s-csv").addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => { el("loaded").hidden = true; load(el("s-csv").value, null); }, 250);
  });
  el("pick").addEventListener("click", () => el("file").click());
  el("file").addEventListener("change", e => {
    const f = e.target.files && e.target.files[0]; if (f) readFile(f); e.target.value = "";
  });
  el("has-header").addEventListener("change", e =>
    load(rawText, el("loaded").hidden ? null : el("loaded-name").textContent, e.target.checked));
  el("clear-file").addEventListener("click", () => {
    el("s-csv").value = EXAMPLE_CSV; el("loaded").hidden = true; load(EXAMPLE_CSV, null);
  });
  const drop = el("drop");
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) readFile(f);
  });
  el("run").addEventListener("click", run);
}

function tiles(list) {
  el("tiles").innerHTML = list.map(t => `
    <div class="tile ${t.accent ? "hot" : ""}">
      <div class="k">${t.k}</div><div class="v num">${t.v}</div><div class="n">${t.n}</div></div>`).join("");
}

function stepState(n, state, note) {
  const box = el("step-" + n);
  box.className = "stepbox" + (state === "on" ? " on" : state === "done" ? " done" : "");
  el("s" + n).textContent = note;
}

function customerKeys(ds) {
  for (const j of [0, 1, 3, 2]) {
    let named = 0;
    for (let i = 0; i < ds.n; i++) if (ds.code[j][i] > 0) named++;
    if (named > ds.n * 0.5) {
      const out = new Array(ds.n);
      for (let i = 0; i < ds.n; i++) out[i] = ds.code[j][i] > 0 ? j + ":" + ds.code[j][i] : "row:" + i;
      return { keys: out, family: ENTS[j] };
    }
  }
  return { keys: Array.from({ length: ds.n }, (_, i) => "row:" + i), family: null };
}
