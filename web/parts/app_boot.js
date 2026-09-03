
/* ------------------------------------------------------------------- boot */
onShow.model = () => { /* charts draw on run */ };
initModelInputs();
initBranching();
initDecay();
initPopularity();
initGraph();
initLag();
initCalibration();
initPareto();
initQueue();

(function showcase() {
  const ds = datasetFromPayload();
  const engine = makeEngine(ds);
  const v = new Float64Array(MODEL.features.length);
  const rows = [];
  const want = new Set([400, 900, 1500, 2600, 4200, 6000]);
  const stop = 6100;
  for (let i = 0; i < stop && i < ds.n; i++) {
    engine.step(i, v);
    const sc = evalTrees(MODEL.trees, v);
    if (want.has(i)) rows.push({ i, v: Float64Array.from(v), score: sc });
    if (ds.y[i] === 1) engine.confirm(i);
  }
  SHOWCASE = rows;
})();
initTree();

show(location.hash.slice(1) || "home");
