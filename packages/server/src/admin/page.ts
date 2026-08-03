export function adminLoginHtml(
  error?: 'denied' | 'expired' | 'failed' | 'unavailable',
): string {
  const messages = {
    denied: 'このGoogleアカウントには管理権限がありません。',
    expired: 'ログインの有効時間が切れました。もう一度お試しください。',
    failed: 'Googleログインを完了できませんでした。',
    unavailable: '現在Googleログインを開始できません。設定を確認してください。',
  } as const;
  const message = error ? messages[error] : '';
  return String.raw`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>管理画面ログイン — 大富豪ローカルルール</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px; color: #f7f8ff; background: #0a0f1e; }
    body::before { content: ""; position: fixed; inset: 0; pointer-events: none; background: radial-gradient(circle at 80% 8%, rgba(116, 99, 255, .25), transparent 34%), radial-gradient(circle at 10% 95%, rgba(49, 209, 171, .15), transparent 31%); }
    main { position: relative; width: min(440px, 100%); border: 1px solid #28324d; border-radius: 24px; padding: 32px; background: rgba(18, 25, 45, .94); box-shadow: 0 28px 70px rgba(0, 0, 0, .35); }
    .mark { display: grid; place-items: center; width: 52px; height: 52px; margin-bottom: 24px; border-radius: 16px; color: #0b1220; background: #7ee8cf; font-size: 22px; font-weight: 900; }
    .eyebrow { margin: 0 0 8px; color: #7ee8cf; font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; }
    h1 { margin: 0; font-size: 28px; letter-spacing: -.035em; }
    .lead { margin: 14px 0 24px; color: #aeb8d2; font-size: 14px; line-height: 1.75; }
    .error { margin: 0 0 18px; border: 1px solid #8b4052; border-radius: 12px; padding: 12px; color: #ffd3dc; background: rgba(139, 64, 82, .22); font-size: 13px; line-height: 1.6; }
    button { width: 100%; border: 0; border-radius: 13px; padding: 14px 18px; color: #111827; background: #fff; font-size: 14px; font-weight: 800; cursor: pointer; }
    button:hover { background: #e9edff; }
    .note { margin: 18px 0 0; color: #7783a3; font-size: 12px; line-height: 1.7; }
  </style>
</head>
<body>
  <main>
    <div class="mark">管</div>
    <p class="eyebrow">DAIFUGO / ADMIN</p>
    <h1>管理画面</h1>
    <p class="lead">運用状況、提案、ユーザー情報を確認するには、許可されたGoogleアカウントでログインしてください。</p>
    ${message ? `<p class="error">${message}</p>` : ''}
    <form method="post" action="/admin/auth/google/begin">
      <button type="submit">Googleでログイン</button>
    </form>
    <p class="note">この画面はBasic認証とGoogleログインの両方で保護されています。</p>
  </main>
</body>
</html>`;
}

export const ADMIN_DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>管理画面 — 大富豪ローカルルール</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --bg:#0a0f1e; --panel:#12192d; --panel2:#0d1427; --line:#27314d; --muted:#95a1c1; --text:#f6f8ff; --accent:#7b6cff; --mint:#77e6cb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; color: var(--text); background: var(--bg); }
    body::before { content:""; position:fixed; inset:0; pointer-events:none; background:radial-gradient(circle at 92% 0%,rgba(123,108,255,.19),transparent 32%),radial-gradient(circle at 0% 100%,rgba(67,211,176,.1),transparent 28%); }
    button,input,select { font:inherit; }
    .shell { position:relative; display:grid; grid-template-columns:228px minmax(0,1fr); min-height:100vh; }
    aside { position:sticky; top:0; height:100vh; padding:26px 18px; border-right:1px solid var(--line); background:rgba(10,15,30,.88); backdrop-filter:blur(14px); }
    .brand { padding:0 10px 25px; }
    .brand small { color:var(--mint); font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.13em; }
    .brand strong { display:block; margin-top:7px; font-size:17px; }
    nav { display:grid; gap:7px; }
    .nav { width:100%; display:flex; align-items:center; gap:10px; border:1px solid transparent; border-radius:12px; padding:11px 12px; color:#aeb8d2; background:transparent; text-align:left; cursor:pointer; }
    .nav:hover { color:#fff; background:#11182b; }
    .nav.active { color:#fff; border-color:#39456a; background:#17203a; }
    .nav-icon { width:22px; color:var(--mint); font:800 12px ui-monospace,SFMono-Regular,Menlo,monospace; }
    .aside-foot { position:absolute; left:18px; right:18px; bottom:22px; }
    .logout { width:100%; border:1px solid var(--line); border-radius:11px; padding:10px; color:#9da8c6; background:#10172a; cursor:pointer; }
    main { min-width:0; padding:30px clamp(20px,4vw,48px) 60px; }
    header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:26px; }
    .eyebrow { margin:0 0 7px; color:var(--mint); font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.14em; }
    h1 { margin:0; font-size:clamp(27px,3vw,38px); letter-spacing:-.04em; }
    .subtitle,.updated { color:var(--muted); font-size:13px; }
    .header-actions { display:flex; align-items:center; gap:12px; }
    .live { display:inline-flex; align-items:center; gap:8px; color:#bbc5e0; font-size:12px; white-space:nowrap; }
    .live::before { content:""; width:8px; height:8px; border-radius:50%; background:#43d6aa; box-shadow:0 0 0 5px rgba(67,214,170,.11); }
    .refresh { border:1px solid #394566; border-radius:10px; padding:9px 13px; color:#fff; background:#151d33; cursor:pointer; font-weight:700; }
    .view { display:none; }
    .view.active { display:block; }
    .error { display:none; margin-bottom:16px; border:1px solid #884054; border-radius:12px; padding:12px 14px; color:#ffd3dc; background:rgba(136,64,84,.22); font-size:13px; }
    .periods { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
    .card,.panel { border:1px solid var(--line); border-radius:18px; background:rgba(18,25,45,.88); box-shadow:0 18px 40px rgba(0,0,0,.14); }
    .period { padding:18px; }
    .period h2,.panel h2 { margin:0 0 15px; font-size:14px; }
    .metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
    .metric { min-height:85px; border:1px solid #212c49; border-radius:12px; padding:12px; background:var(--panel2); }
    .metric.primary { border-color:rgba(123,108,255,.5); background:linear-gradient(145deg,rgba(123,108,255,.19),var(--panel2)); }
    .metric span { color:#8f9bbb; font-size:11px; }
    .metric strong { display:block; margin-top:7px; font-size:25px; letter-spacing:-.04em; }
    .metric em { margin-left:3px; color:#8f9bbb; font-size:11px; font-style:normal; }
    .detail { margin:13px 0 0; padding-top:12px; border-top:1px solid #26304b; color:#98a4c2; font-size:11px; line-height:1.8; }
    .overview-lower { display:grid; grid-template-columns:1.15fr .85fr; gap:14px; margin-top:14px; }
    .panel { padding:18px; }
    .summary { display:grid; grid-template-columns:repeat(4,1fr); gap:9px; margin:0; }
    .summary div { padding:13px; border-radius:12px; background:var(--panel2); }
    .summary dt { color:#8d99b8; font-size:11px; }
    .summary dd { margin:7px 0 0; font-size:23px; font-weight:800; }
    .status-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }
    .status-cell { padding:11px; border-radius:11px; background:var(--panel2); }
    .status-cell span { display:block; color:#8e9ab9; font-size:10px; }
    .status-cell strong { display:block; margin-top:5px; font-size:19px; }
    .toolbar { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px; }
    .toolbar input,.toolbar select { min-height:42px; border:1px solid #34405f; border-radius:11px; padding:0 12px; color:#fff; background:#11182b; outline:none; }
    .toolbar input { flex:1 1 260px; }
    .toolbar input:focus,.toolbar select:focus { border-color:var(--accent); }
    .result-meta { margin:0 0 11px; color:var(--muted); font-size:12px; }
    .list { display:grid; gap:10px; }
    .item { border:1px solid var(--line); border-radius:15px; padding:15px 16px; background:rgba(18,25,45,.88); }
    .item-top { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
    .item h3 { margin:0; font-size:15px; }
    .item-id { color:#7f8baa; font:11px ui-monospace,SFMono-Regular,Menlo,monospace; }
    .badge { display:inline-flex; align-items:center; border:1px solid #3a4565; border-radius:999px; padding:4px 8px; color:#bdc6df; background:#11182a; font-size:10px; white-space:nowrap; }
    .badge.screening { color:#f7d583; border-color:#655630; }
    .badge.implementing { color:#b9afff; border-color:#50478b; }
    .badge.released,.badge.registered { color:#8ee8d2; border-color:#2b6a5d; }
    .badge.rejected,.badge.failed,.badge.suspended { color:#ffb0bf; border-color:#7b4050; }
    .body { margin:10px 0; color:#c3cbe1; font-size:13px; line-height:1.65; white-space:pre-wrap; }
    .meta { display:flex; flex-wrap:wrap; gap:7px 13px; color:#8793b1; font-size:11px; }
    .reason { margin:10px 0 0; border-left:2px solid #7c5060; padding-left:10px; color:#dfb6c0; font-size:12px; line-height:1.6; }
    .user-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .user-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:7px; margin-top:12px; }
    .user-stats div { padding:9px; border-radius:9px; background:var(--panel2); text-align:center; }
    .user-stats strong { display:block; font-size:17px; }
    .user-stats span { color:#8490ad; font-size:9px; }
    .more { display:none; width:100%; margin-top:12px; border:1px solid #364260; border-radius:11px; padding:11px; color:#dfe4f5; background:#131b30; cursor:pointer; }
    .empty { padding:34px; color:#8995b3; text-align:center; }
    @media (max-width:960px) { .periods,.overview-lower { grid-template-columns:1fr; } .user-grid { grid-template-columns:1fr; } }
    @media (max-width:720px) { .shell { display:block; } aside { position:relative; height:auto; padding:14px; border-right:0; border-bottom:1px solid var(--line); } .brand { padding:3px 5px 12px; } nav { grid-template-columns:repeat(3,1fr); } .nav { justify-content:center; padding:9px 5px; font-size:12px; } .nav-icon { display:none; } .aside-foot { display:none; } main { padding:22px 14px 50px; } header { align-items:flex-end; } .header-actions .live { display:none; } .summary { grid-template-columns:repeat(2,1fr); } .status-grid { grid-template-columns:repeat(2,1fr); } }
    @media (max-width:430px) { .period { padding:14px; } .metric { min-height:78px; padding:10px; } .metric strong { font-size:22px; } .user-stats { grid-template-columns:repeat(2,1fr); } }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <div class="brand"><small>DAIFUGO / ADMIN</small><strong>管理コンソール</strong></div>
      <nav>
        <button class="nav active" data-view="overview"><span class="nav-icon">01</span>概要</button>
        <button class="nav" data-view="proposals"><span class="nav-icon">02</span>提案</button>
        <button class="nav" data-view="users"><span class="nav-icon">03</span>ユーザー</button>
      </nav>
      <div class="aside-foot"><form method="post" action="/admin/logout"><button class="logout">ログアウト</button></form></div>
    </aside>
    <main>
      <header>
        <div><p class="eyebrow">PRODUCTION / FLY.IO</p><h1 id="title">運用概要</h1><p class="subtitle" id="subtitle">本番の利用状況を確認します。</p></div>
        <div class="header-actions"><span class="live" id="live">本番接続中</span><button class="refresh" id="refresh">更新</button></div>
      </header>
      <div class="error" id="error"></div>
      <section class="view active" id="view-overview">
        <div class="periods" id="periods"></div>
        <div class="overview-lower">
          <article class="panel"><h2>本日の運用</h2><dl class="summary"><div><dt>提案</dt><dd id="today-proposals">—</dd></div><div><dt>新規ユーザー</dt><dd id="today-users">—</dd></div><div><dt>稼働ルール</dt><dd id="active-rules">—</dd></div><div><dt>評価</dt><dd id="today-evaluations">—</dd></div></dl><p class="updated" id="updated"></p></article>
          <article class="panel"><h2>提案ステータス</h2><div class="status-grid" id="status-grid"></div></article>
        </div>
      </section>
      <section class="view" id="view-proposals">
        <div class="toolbar"><input id="proposal-query" type="search" placeholder="番号・名前・本文・提案者で検索"><select id="proposal-status"><option value="">すべてのステータス</option><option value="screening">審査中</option><option value="implementing">実装中</option><option value="released">公開済み</option><option value="rejected">却下</option><option value="failed">実装失敗</option></select></div>
        <p class="result-meta" id="proposal-meta"></p><div class="list" id="proposal-list"></div><button class="more" id="proposal-more">さらに表示</button>
      </section>
      <section class="view" id="view-users">
        <div class="toolbar"><input id="user-query" type="search" placeholder="表示名・ユーザーIDで検索"><select id="user-registration"><option value="all">すべてのユーザー</option><option value="registered">Google登録済み</option><option value="guest">ゲスト</option></select></div>
        <p class="result-meta" id="user-meta"></p><div class="user-grid" id="user-list"></div><button class="more" id="user-more">さらに表示</button>
      </section>
    </main>
  </div>
  <script>
    const nf = new Intl.NumberFormat("ja-JP");
    const dt = new Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" });
    const labels = { screening:"審査中", implementing:"実装中", released:"公開済み", rejected:"却下", failed:"実装失敗" };
    const views = { overview:["運用概要","本番の利用状況を確認します。"], proposals:["提案","提案内容と処理状況を確認します。"], users:["ユーザー","登録・プレイ状況を確認します。"] };
    const state = { proposalOffset:0, userOffset:0, proposalTotal:0, userTotal:0, busy:false };
    const el = (id) => document.getElementById(id);
    const text = (tag, value, className) => { const node=document.createElement(tag); node.textContent=value; if(className) node.className=className; return node; };
    const date = (value) => value ? dt.format(new Date(value)) : "—";
    const shortId = (value) => value.length > 14 ? value.slice(0,8)+"…"+value.slice(-4) : value;

    async function api(path) {
      const response = await fetch(path, { cache:"no-store" });
      if (response.status === 401) { location.reload(); throw new Error("ログインが必要です"); }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "取得に失敗しました");
      return body;
    }
    function showError(error) { const box=el("error"); box.textContent=error instanceof Error?error.message:String(error); box.style.display="block"; }
    function clearError() { el("error").style.display="none"; }
    function metric(label,value,unit,primary) { return '<div class="metric'+(primary?' primary':'')+'"><span>'+label+'</span><strong>'+nf.format(value)+'<em>'+unit+'</em></strong></div>'; }

    async function loadOverview() {
      const data = await api("/admin/api/overview");
      const periods=[["last30m","直近30分"],["last3h","直近3時間"],["today","本日（JST）"]];
      el("periods").innerHTML=periods.map(([key,label])=>{ const a=data.database.windows[key]; const t=data.traffic?.windows?.[key]; return '<article class="card period"><h2>'+label+'</h2><div class="metrics">'+metric("接続",t?.websocketConnections??0,"回",false)+metric("新規",a.newUsers,"人",false)+metric("完走",a.completedSets,"卓",true)+metric("プレイ",a.gamesPlayed,"ゲーム",true)+'</div><p class="detail">開始 '+nf.format(a.setsStarted)+'卓 ・ 進行中/離脱 '+nf.format(a.ongoingSets)+'卓 ・ 途中終了 '+nf.format(a.partialSets)+'卓<br>'+(t?'HTTP '+nf.format(t.responses)+'件 ・ ':'Flyアクセス指標は取得できません ・ ')+'操作のあった卓 '+nf.format(a.actionSets)+'卓</p></article>'; }).join("");
      el("today-proposals").textContent=nf.format(data.database.proposals.today);
      el("today-users").textContent=nf.format(data.database.users.today);
      el("active-rules").textContent=nf.format(data.database.rules.active);
      el("today-evaluations").textContent=nf.format(data.database.windows.today.evaluations);
      el("status-grid").innerHTML=Object.entries(labels).map(([key,label])=>'<div class="status-cell"><span>'+label+'</span><strong>'+nf.format(data.database.proposals.byStatus[key])+'</strong></div>').join("");
      el("updated").textContent="更新: "+new Date(data.generatedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})+" ・ ユーザー合計 "+nf.format(data.database.users.total)+"人（Google登録 "+nf.format(data.database.users.registered)+"人）";
    }
    function proposalNode(item) {
      const root=text("article","","item"); const top=text("div","","item-top"); const heading=document.createElement("div");
      heading.append(text("h3",(item.number?"#"+item.number+" ":"")+item.name)); heading.append(text("span",shortId(item.id),"item-id"));
      top.append(heading,text("span",labels[item.status]||item.status,"badge "+item.status)); root.append(top,text("p",item.body,"body"));
      const meta=text("div","","meta"); [item.kind==="local"?"ご当地ルール":"オリジナル",item.author.displayName+(item.author.registered?"（登録済み）":"（ゲスト）"),"提案 "+date(item.createdAt),"更新 "+date(item.statusChangedAt),item.pipeline?"実装: "+item.pipeline.phase:null,item.ruleId?"ルール: "+item.ruleId:null].filter(Boolean).forEach(v=>meta.append(text("span",v))); root.append(meta);
      if(item.reasonText) root.append(text("p",(item.reasonCode?item.reasonCode+": ":"")+item.reasonText,"reason")); return root;
    }
    async function loadProposals(reset=true) {
      if(reset){state.proposalOffset=0;el("proposal-list").replaceChildren();}
      const q=new URLSearchParams({limit:"50",offset:String(state.proposalOffset)}); const query=el("proposal-query").value.trim(); const status=el("proposal-status").value; if(query)q.set("q",query);if(status)q.set("status",status);
      const data=await api("/admin/api/proposals?"+q); state.proposalTotal=data.total; data.items.forEach(item=>el("proposal-list").append(proposalNode(item))); state.proposalOffset+=data.items.length;
      el("proposal-meta").textContent=nf.format(data.total)+"件"; if(data.total===0)el("proposal-list").append(text("div","該当する提案はありません。","empty")); el("proposal-more").style.display=state.proposalOffset<data.total?"block":"none";
    }
    function userNode(item) {
      const root=text("article","","item"); const top=text("div","","item-top"); const heading=document.createElement("div"); heading.append(text("h3",item.displayName),text("span",shortId(item.id),"item-id")); top.append(heading,text("span",item.registered?"Google登録":"ゲスト","badge "+(item.registered?"registered":""))); root.append(top);
      const meta=text("div","","meta"); meta.style.marginTop="10px"; ["作成 "+date(item.createdAt),item.registeredAt?"登録 "+date(item.registeredAt):null,"最終プレイ "+date(item.lastPlayedAt)].filter(Boolean).forEach(v=>meta.append(text("span",v))); root.append(meta);
      if(item.suspendedUntil&&item.suspendedUntil>Date.now()) root.append(text("p","提案停止中: "+date(item.suspendedUntil),"reason"));
      const stats=text("div","","user-stats"); [[item.setCount,"参加卓"],[item.completedSetCount,"完走卓"],[item.proposalCount,"提案"],[item.evaluationCount,"評価"]].forEach(([value,label])=>{const cell=document.createElement("div");cell.append(text("strong",nf.format(value)),text("span",label));stats.append(cell);}); root.append(stats); return root;
    }
    async function loadUsers(reset=true) {
      if(reset){state.userOffset=0;el("user-list").replaceChildren();}
      const q=new URLSearchParams({limit:"50",offset:String(state.userOffset),registration:el("user-registration").value}); const query=el("user-query").value.trim();if(query)q.set("q",query);
      const data=await api("/admin/api/users?"+q);state.userTotal=data.total;data.items.forEach(item=>el("user-list").append(userNode(item)));state.userOffset+=data.items.length;
      el("user-meta").textContent=nf.format(data.total)+"人";if(data.total===0)el("user-list").append(text("div","該当するユーザーはいません。","empty"));el("user-more").style.display=state.userOffset<data.total?"block":"none";
    }
    async function run(task){if(state.busy)return;state.busy=true;el("refresh").disabled=true;clearError();try{await task();el("live").textContent="本番取得済み";}catch(error){showError(error);el("live").textContent="取得失敗";}finally{state.busy=false;el("refresh").disabled=false;}}
    function currentView(){return document.querySelector(".nav.active").dataset.view;}
    document.querySelectorAll(".nav").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll(".nav,.view").forEach(node=>node.classList.remove("active"));button.classList.add("active");el("view-"+button.dataset.view).classList.add("active");el("title").textContent=views[button.dataset.view][0];el("subtitle").textContent=views[button.dataset.view][1];if(button.dataset.view==="proposals"&&!el("proposal-list").children.length)void run(()=>loadProposals());if(button.dataset.view==="users"&&!el("user-list").children.length)void run(()=>loadUsers());}));
    let proposalTimer,userTimer;el("proposal-query").addEventListener("input",()=>{clearTimeout(proposalTimer);proposalTimer=setTimeout(()=>void run(()=>loadProposals()),300);});el("proposal-status").addEventListener("change",()=>void run(()=>loadProposals()));el("user-query").addEventListener("input",()=>{clearTimeout(userTimer);userTimer=setTimeout(()=>void run(()=>loadUsers()),300);});el("user-registration").addEventListener("change",()=>void run(()=>loadUsers()));el("proposal-more").addEventListener("click",()=>void run(()=>loadProposals(false)));el("user-more").addEventListener("click",()=>void run(()=>loadUsers(false)));el("refresh").addEventListener("click",()=>void run(()=>currentView()==="overview"?loadOverview():currentView()==="proposals"?loadProposals():loadUsers()));
    void run(loadOverview);setInterval(()=>{if(currentView()==="overview")void run(loadOverview);},60_000);
  </script>
</body>
</html>`;
