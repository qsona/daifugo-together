export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>大富豪ローカルルール — 運用ダッシュボード</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #0b1020; color: #f5f7ff; }
    body::before { content: ""; position: fixed; inset: 0; pointer-events: none; background: radial-gradient(circle at 85% 0%, rgba(109, 94, 252, .22), transparent 34%), radial-gradient(circle at 5% 100%, rgba(61, 214, 180, .13), transparent 30%); }
    main { position: relative; width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 52px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
    .eyebrow { margin: 0 0 7px; color: #7ee8cf; font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(25px, 4vw, 40px); letter-spacing: -.04em; }
    .subtitle, .updated { color: #9ba6c5; font-size: 13px; }
    .actions { display: flex; align-items: center; gap: 12px; }
    .status { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; color: #b9c4e3; font-size: 13px; }
    .status::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: #38d39f; box-shadow: 0 0 0 5px rgba(56, 211, 159, .12); }
    button { border: 1px solid #34405f; border-radius: 10px; padding: 10px 14px; background: #161d33; color: #f5f7ff; font-weight: 700; cursor: pointer; }
    button:hover { border-color: #6d5efc; }
    button:disabled { cursor: wait; opacity: .55; }
    .periods { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .period { border: 1px solid #222c47; border-radius: 18px; padding: 19px; background: rgba(19, 26, 47, .82); box-shadow: 0 18px 40px rgba(0, 0, 0, .18); }
    .period h2 { margin: 0 0 16px; font-size: 15px; color: #c5cdef; }
    .kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
    .kpi { min-height: 91px; border-radius: 13px; padding: 13px; background: #0e1529; border: 1px solid #202b48; }
    .kpi.primary { background: linear-gradient(145deg, rgba(109, 94, 252, .2), rgba(14, 21, 41, 1)); border-color: rgba(109, 94, 252, .48); }
    .kpi .label { color: #8f9aba; font-size: 12px; }
    .kpi .value { display: block; margin-top: 7px; font-size: 28px; font-weight: 800; letter-spacing: -.04em; }
    .kpi .unit { margin-left: 3px; color: #9ba6c5; font-size: 12px; font-weight: 600; }
    .detail { margin: 14px 0 0; padding-top: 13px; border-top: 1px solid #26304b; color: #aab4d0; font-size: 12px; line-height: 1.8; }
    .lower { display: grid; grid-template-columns: 1.2fr .8fr; gap: 14px; margin-top: 14px; }
    .panel { border: 1px solid #222c47; border-radius: 18px; padding: 19px; background: rgba(19, 26, 47, .82); }
    .panel h2 { margin: 0 0 15px; font-size: 15px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .summary > div { padding: 13px; border-radius: 12px; background: #0e1529; }
    .summary dt { color: #8f9aba; font-size: 12px; }
    .summary dd { margin: 7px 0 0; font-size: 24px; font-weight: 800; }
    .queue { display: grid; gap: 10px; }
    .queue-row { display: flex; justify-content: space-between; padding: 13px; border-radius: 12px; background: #0e1529; color: #aab4d0; font-size: 13px; }
    .queue-row strong { color: #f5f7ff; font-size: 18px; }
    .notice { margin: 15px 0 0; color: #7f8aa9; font-size: 12px; line-height: 1.7; }
    .error { display: none; margin-bottom: 16px; border: 1px solid #8a4051; border-radius: 12px; padding: 13px; background: rgba(138, 64, 81, .22); color: #ffd2da; }
    .loading .value, .loading dd, .loading .queue-row strong { color: transparent; border-radius: 6px; background: linear-gradient(90deg, #202945, #313d62, #202945); background-size: 200% 100%; animation: pulse 1.4s infinite; }
    @keyframes pulse { to { background-position: -200% 0; } }
    @media (max-width: 850px) { .periods, .lower { grid-template-columns: 1fr; } .summary { grid-template-columns: repeat(2, 1fr); } header { flex-direction: column; } }
    @media (max-width: 480px) { main { width: min(100% - 20px, 1180px); padding-top: 22px; } .kpis { grid-template-columns: 1fr 1fr; } .kpi { min-height: 84px; padding: 11px; } .kpi .value { font-size: 24px; } }
  </style>
</head>
<body class="loading">
  <main>
    <header>
      <div>
        <p class="eyebrow">LOCAL OPS / FLY.IO</p>
        <h1>大富豪ローカルルール</h1>
        <p class="subtitle">アクセスとプレイ状況を、約60秒ごとに確認します。</p>
      </div>
      <div class="actions">
        <span class="status" id="status">取得中</span>
        <button id="refresh" type="button">更新</button>
      </div>
    </header>
    <div class="error" id="error"></div>
    <section class="periods" id="periods"></section>
    <section class="lower">
      <article class="panel">
        <h2>本日の運用</h2>
        <dl class="summary">
          <div><dt>提案</dt><dd id="proposals">—</dd></div>
          <div><dt>稼働ルール</dt><dd id="rules">—</dd></div>
          <div><dt>評価</dt><dd id="evaluations">—</dd></div>
          <div><dt>ゲーム操作</dt><dd id="actions">—</dd></div>
        </dl>
        <p class="notice">「接続」はWebSocketの接続回数で、再接続を含みます。「新規」は初めてこの端末で接続したユーザー記録です。HTTP件数は静的ファイルやAPI通信を含むため、PVではありません。</p>
      </article>
      <article class="panel">
        <h2>処理待ち</h2>
        <div class="queue">
          <div class="queue-row"><span>審査待ち</span><strong id="screening">—</strong></div>
          <div class="queue-row"><span>実装待ち・実行中</span><strong id="implementation">—</strong></div>
        </div>
        <p class="updated" id="updated">まだ更新されていません</p>
      </article>
    </section>
  </main>
  <script>
    const periods = [
      ["last30m", "直近30分"],
      ["last3h", "直近3時間"],
      ["today", "本日（JST）"]
    ];
    const nf = new Intl.NumberFormat("ja-JP");
    const periodRoot = document.querySelector("#periods");
    const refreshButton = document.querySelector("#refresh");

    function metric(label, value, unit, primary) {
      return '<div class="kpi' + (primary ? ' primary' : '') + '"><span class="label">' + label + '</span><span class="value">' + nf.format(value) + '<span class="unit">' + unit + '</span></span></div>';
    }

    function render(data) {
      periodRoot.innerHTML = periods.map(function (entry) {
        const key = entry[0];
        const label = entry[1];
        const activity = data.database.windows[key];
        const traffic = data.traffic.windows[key];
        return '<article class="period"><h2>' + label + '</h2><div class="kpis">' +
          metric("接続", traffic.websocketConnections, "回", false) +
          metric("新規", activity.newUsers, "人", false) +
          metric("完走", activity.completedSets, "卓", true) +
          metric("プレイ", activity.gamesPlayed, "ゲーム", true) +
          '</div><p class="detail">開始 ' + nf.format(activity.setsStarted) + '卓 ・ 進行中/離脱 ' + nf.format(activity.ongoingSets) + '卓 ・ 途中終了 ' + nf.format(activity.partialSets) + '卓<br>HTTP ' + nf.format(traffic.responses) + '件 ・ 操作のあった卓 ' + nf.format(activity.actionSets) + '卓</p></article>';
      }).join("");
      document.querySelector("#proposals").textContent = nf.format(data.database.funnel.total);
      document.querySelector("#rules").textContent = nf.format(data.database.rules.active);
      document.querySelector("#evaluations").textContent = nf.format(data.database.windows.today.evaluations);
      document.querySelector("#actions").textContent = nf.format(data.database.windows.today.actions);
      document.querySelector("#screening").textContent = nf.format(data.database.queue.screening.total);
      document.querySelector("#implementation").textContent = nf.format(data.database.queue.implementation.total);
      document.querySelector("#status").textContent = "本番取得済み";
      document.querySelector("#updated").textContent = "更新: " + new Date(data.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      document.querySelector("#error").style.display = "none";
      document.body.classList.remove("loading");
    }

    async function refresh(force) {
      refreshButton.disabled = true;
      document.querySelector("#status").textContent = "取得中";
      try {
        const response = await fetch("/api/snapshot" + (force ? "?force=1" : ""), { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "取得に失敗しました");
        render(data);
      } catch (error) {
        const box = document.querySelector("#error");
        box.textContent = error instanceof Error ? error.message : String(error);
        box.style.display = "block";
        document.querySelector("#status").textContent = "取得失敗";
      } finally {
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener("click", function () { void refresh(true); });
    void refresh(false);
    setInterval(function () { void refresh(false); }, 60_000);
  </script>
</body>
</html>`;
