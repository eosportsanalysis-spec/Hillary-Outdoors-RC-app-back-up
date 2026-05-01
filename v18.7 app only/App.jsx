// Hillary Outdoors GMS v12 — built 2026-04-22 — Supabase persistence, edit everywhere, workflow ordering
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { supabase, hasSupabase, sbGet, sbInsert, sbUpdate, sbDelete } from "./supabase.js";

// ═══ TOKENS ═══════════════════════════════════════════════════════════════════
const T = {bg:"#0d1a0d",card:"rgba(255,255,255,0.06)",border:"rgba(255,255,255,0.10)",g1:"#1a3a1a",g2:"#2d5a2d",accent:"#e8621a",text:"#e8f0e8",muted:"#6a8a6a",white:"#ffffff"};
const SC = {Red:{bg:"#c0392b",lt:"rgba(192,57,43,0.15)",meaning:"Replace immediately — do not use"},Orange:{bg:"#e67e22",lt:"rgba(230,126,34,0.15)",meaning:"Replace within 3 months"},Yellow:{bg:"#c9a800",lt:"rgba(212,172,13,0.15)",meaning:"Purchase within 5 months"},YellowRepair:{bg:"#9b7c0c",lt:"rgba(155,124,12,0.15)",meaning:"Repairable — excluded from ROY%"},Green:{bg:"#27ae60",lt:"rgba(39,174,96,0.15)",meaning:"All clear — safe to use"}};
const STGC = {pending:{label:"Pending",color:"#6a8a6a"},quoted:{label:"Quoted",color:"#4a80c8"},grant_applied:{label:"Grant Applied",color:"#9b59b6"},grant_approved:{label:"Grant Approved",color:"#27ae60"},ordered:{label:"Ordered",color:"#e8621a"},arrived:{label:"Arrived",color:"#7ab0ff"},entered:{label:"Entered",color:"#27ae60"}};
const BHC = {signable:{label:"Signable",color:"#27ae60"},sized_pool:{label:"Sized",color:"#e67e22"},monitored_only:{label:"Monitored",color:"#4a80c8"},fuel:{label:"Fuel",color:"#9b59b6"},catalogue:{label:"Catalogue",color:"#6a8a6a"}};

// ═══ HELPERS ══════════════════════════════════════════════════════════════════
function calcStatus(g){if(g.status==="YellowRepair")return "YellowRepair";const d=g.expiry?Math.floor((new Date(g.expiry)-new Date())/86400000):9999;const r=g.usage_limit?g.usage_limit-g.number_of_uses:9999;if((g.usage_limit&&g.number_of_uses>=g.usage_limit)||d<0)return "Red";if(r<=60||d<=90)return "Orange";if(r<=120||d<=150)return "Yellow";return "Green";}

// Count units a row represents:
//   pool bucket → pool_count (the actual stock in that size)
//   regular row → 1
function unitsOf(g){
  if(g.is_pool_bucket){
    return Number(g.pool_count)||0;
  }
  return 1;
}

function calcROY(catId,gear){
  const it = gear.filter(g=>g.category_id===catId && g.status!=="YellowRepair");
  if(!it.length) return {total:0,red:0,orange:0,yellow:0,roy:0,pct:0};
  // total = sum of units (treats pool buckets as their stock count)
  const sum = (arr) => arr.reduce((a,g)=>a+unitsOf(g),0);
  const total  = sum(it);
  const red    = sum(it.filter(g=>g.status==="Red"));
  const orange = sum(it.filter(g=>g.status==="Orange"));
  const yellow = sum(it.filter(g=>g.status==="Yellow"));
  const roy = red+orange+yellow;
  return {total, red, orange, yellow, roy, pct: total>0 ? (roy/total)*100 : 0};
}

function calcFuturePurchases(cats,gear){
  // Only categories whose budget falls on us (`resource`) are candidates for
  // purchase recommendations. Externally-funded categories like vehicles, fuel,
  // trailers and "high ropes other" don't come out of our budget so they get
  // skipped entirely. Categories with an empty budget_owner default to inclusion
  // so newly-created categories aren't silently hidden until tagged.
  const inBudget = (c) => !c.budget_owner || c.budget_owner === 'resource';
  return cats.filter(inBudget).map(c=>{
    const s = calcROY(c.cat_id, gear);
    const priority = s.red>0?1 : s.orange>0?2 : s.yellow>0?3 : 4;
    const w = c.life_safety?1.5:1;
    const score = +(((s.red*3 + s.orange*2 + s.yellow)/Math.max(s.total,1))*w).toFixed(2);
    // For sized_pool buckets, "current" is total units, not row count.
    // For pool buckets we also factor in capacity vs count — if we're below
    // 80% of capacity in any bucket, the category is "below stock".
    let belowCapacity = false;
    if(c.behaviour==="sized_pool" && c.sized_pool_style==="bucket"){
      const buckets = gear.filter(g=>g.category_id===c.cat_id && g.is_pool_bucket && g.status!=="YellowRepair");
      const totCap = buckets.reduce((a,g)=>a+(Number(g.pool_capacity)||0),0);
      const totCnt = buckets.reduce((a,g)=>a+(Number(g.pool_count)||0),0);
      if(totCap>0 && totCnt < totCap*0.8) belowCapacity = true;
    }
    const effectiveTarget = c.target_stock>0 ? c.target_stock : null;
    const belowTarget = effectiveTarget && s.total < effectiveTarget*0.8;
    return {...c, ...s, priority, score, effectiveTarget, belowCapacity, belowTarget};
  }).filter(c=>
    // Show in Future Purchases only when there's a real reason:
    //   - any Red/Orange/Yellow status, OR
    //   - behaviour=signable/sized_pool AND below 80% of target stock, OR
    //   - sized_pool bucket AND any individual bucket is below 80% capacity
    c.priority<4 ||
    c.belowTarget ||
    c.belowCapacity
  ).sort((a,b)=>a.priority-b.priority || b.score-a.score);
}
function fmtDT(dt){return dt?new Date(dt).toLocaleString("en-NZ",{dateStyle:"medium",timeStyle:"short"}):"—";}
function fmtD(d){return d?new Date(d).toLocaleDateString("en-NZ",{dateStyle:"medium"}):"—";}
function nzd(n){return n!=null?"$"+Number(n).toLocaleString("en-NZ",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";}
function sq(list,q,fields){if(!q)return list;const l=q.toLowerCase();return list.filter(r=>fields.some(f=>{const v=r[f];return v&&String(v).toLowerCase().includes(l);}));}
function dlCSV(name,rows){if(!rows.length)return;const k=Object.keys(rows[0]);const e=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"';const csv=[k.map(e).join(","),...rows.map(r=>k.map(x=>e(r[x])).join(","))].join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=name+"_"+new Date().toISOString().slice(0,10)+".csv";a.click();}
function getType(id,types){return types.find(t=>t.type_id===id);}
function behaviourOf(g,cats){
  if(!g)return "signable";
  if(!cats||cats.length===0)return "signable";
  const cat=cats.find(c=>c.cat_id===g.category_id);
  return cat?.behaviour||"signable";
}
function budgetOwnerOf(g,cats){
  const cat=(cats||[]).find(c=>c.cat_id===g.category_id);
  return cat?.budget_owner||null;
}

// Canonical size ordering: clothing (3XS → 6XL), then footwear (numeric).
// Anything unknown sorts last. Used for size pickers and pool grids.
const SIZE_ORDER = {
  "6XS":10, "5XS":20, "4XS":30, "3XS":40, "2XS":50,
  "XS":60, "S":70, "M":80, "L":90, "XL":100,
  "2XL":110,"3XL":120,"4XL":130,"5XL":140,"6XL":150,
};
function sizeSortKey(sz){
  if(!sz) return 9999;
  const u = String(sz).trim().toUpperCase();
  if(SIZE_ORDER[u] != null) return SIZE_ORDER[u];
  // Footwear: leading number e.g. "10", "10.5", "11 (EU 45)"
  const m = u.match(/^(\d+(?:\.\d+)?)/);
  if(m) return 200 + parseFloat(m[1])*10;
  return 9999;
}
function sortSizes(arr){
  return [...arr].sort((a,b)=>sizeSortKey(a)-sizeSortKey(b));
}

// ═══ MOCK DATA ════════════════════════════════════════════════════════════════
const INIT_LOCATIONS = [
  {loc_id:"L01",name:"High Ropes Store",type:"room",active:true},
  {loc_id:"L02",name:"Climbing Room",type:"room",active:true},
  {loc_id:"L03",name:"Tech Room",type:"room",active:true},
  {loc_id:"L04",name:"Clothes Room Main",type:"room",active:true},
  {loc_id:"L05",name:"Container 4",type:"container",active:true},
  {loc_id:"L06",name:"Lockers",type:"room",active:true},
  {loc_id:"L07",name:"Chem Shed",type:"building",active:true},
  {loc_id:"L08",name:"Vehicle Shed",type:"building",active:true},
  {loc_id:"L09",name:"Pool",type:"room",active:true},
  {loc_id:"L10",name:"Cage 2",type:"cage",active:true},
];
const INIT_CATEGORIES = [];
const INIT_TYPES = [];
const INIT_GEAR = [];
const INIT_LISTS = [];
const INIT_USAGE = [];
const INIT_REPORTS = [];
const INIT_REPAIRS = [];
const INIT_WORKFLOW = [];
const INIT_PREV = [];
const INIT_RETIRED = [];
const INIT_FUEL_LOG = [];
const INIT_INSTRUCTORS = [];

// ═══ CSS ══════════════════════════════════════════════════════════════════════
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;600&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#0d1a0d;color:#e8f0e8;font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.6;}
  ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-thumb{background:#2d5a2d;border-radius:3px;}
  input,textarea,select{background:rgba(255,255,255,0.07)!important;border:1px solid rgba(255,255,255,0.14)!important;color:#e8f0e8!important;border-radius:8px;padding:9px 13px;font-family:'DM Sans',sans-serif;font-size:14px;outline:none;width:100%;}
  input:focus,textarea:focus,select:focus{border-color:#e8621a!important;}
  select option{background:#1a2a1a;}
  button{cursor:pointer;font-family:'DM Sans',sans-serif;}
  table{border-collapse:collapse;width:100%;}
  th{text-align:left;padding:9px 13px;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#6a8a6a;border-bottom:1px solid rgba(255,255,255,0.10);white-space:nowrap;}
  td{padding:10px 13px;font-size:14px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:middle;}
  tr:last-child td{border-bottom:none;}
  tr.cl:hover td{background:rgba(255,255,255,0.04);cursor:pointer;}
  .toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1a3a1a;border:1px solid #e8621a;color:#e8f0e8;padding:11px 22px;border-radius:12px;font-size:14px;z-index:9999;white-space:nowrap;}
  .mbg{position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:800;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;}
  .mbox{background:#141f14;border:1px solid rgba(255,255,255,0.10);border-radius:18px;padding:26px;width:100%;max-width:620px;margin:auto;}
  .sx{overflow-x:auto;}
  .sb{transition:width .22s ease;overflow:hidden;flex-shrink:0;}
  @keyframes sr{0%{transform:scale(.8);opacity:.8;}100%{transform:scale(1.5);opacity:0;}}
  @keyframes pl{0%,100%{opacity:.6;transform:scale(1);}50%{opacity:1;transform:scale(1.06);}}
`;

// ═══ ATOMS ════════════════════════════════════════════════════════════════════
function Card({children,style}){return <div style={{background:T.card,border:"1px solid "+T.border,borderRadius:14,padding:20,...style}}>{children}</div>;}
function SBadge({status,small}){const c=SC[status]||SC.Green;const lbl=status==="YellowRepair"?"REPAIR":status;return <span style={{background:c.bg,color:"#fff",padding:small?"3px 8px":"4px 12px",borderRadius:20,fontSize:small?11:13,fontWeight:700,textTransform:"uppercase",whiteSpace:"nowrap"}}>{lbl}</span>;}
function BhBadge({behaviour,small}){const c=BHC[behaviour]||BHC.signable;return <span style={{background:c.color+"22",color:c.color,border:"1px solid "+c.color+"44",padding:small?"2px 7px":"3px 9px",borderRadius:20,fontSize:small?10:11,fontWeight:700,textTransform:"uppercase",whiteSpace:"nowrap"}}>{c.label}</span>;}
function StgBadge({stage}){const c=STGC[stage]||STGC.pending;return <span style={{background:c.color+"22",color:c.color,border:"1px solid "+c.color+"44",padding:"3px 9px",borderRadius:20,fontSize:11,fontWeight:700,textTransform:"uppercase"}}>{c.label}</span>;}
function FL({children}){return <div style={{fontSize:11,letterSpacing:1.3,textTransform:"uppercase",color:T.muted,marginBottom:6,marginTop:14}}>{children}</div>;}
function PT({title,sub}){return <div style={{marginBottom:22}}><h2 style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:T.white}}>{title}</h2>{sub&&<p style={{fontSize:14,color:T.muted,marginTop:5,lineHeight:1.6}}>{sub}</p>}</div>;}
function Btn({children,onClick,color,style,disabled,small,outline}){const col=color||T.accent;return <button disabled={disabled} onClick={onClick} style={{background:outline?"transparent":disabled?"rgba(255,255,255,0.08)":col,color:outline?col:disabled?T.muted:"#fff",border:outline?"1px solid "+col:"none",borderRadius:8,padding:small?"6px 12px":"10px 18px",fontSize:small?13:15,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1,...style}}>{children}</button>;}
function Divider(){return <div style={{borderTop:"1px solid "+T.border,margin:"16px 0"}}/>;}
function Mdl({children,onClose}){return <div className="mbg" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="mbox">{children}</div></div>;}
function Toast({msg}){return msg?<div className="toast">{msg}</div>:null;}
function KV({label,value}){return <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.05)",gap:16}}><span style={{color:T.muted,fontSize:14,flexShrink:0}}>{label}</span><span style={{fontSize:14,fontWeight:500,textAlign:"right"}}>{value}</span></div>;}
function SBar({value,onChange,ph}){return <input placeholder={"🔍  "+(ph||"Search…")} value={value} onChange={e=>onChange(e.target.value)} style={{marginBottom:12}}/>;}
function DonutChart({data}){const tot=Object.values(data).reduce((a,b)=>a+b,0)||1;const cols={Red:"#c0392b",Orange:"#e67e22",Yellow:"#c9a800",YellowRepair:"#9b7c0c",Green:"#27ae60"};const r=40,cx=50,cy=50,sw=16;let cum=0;const segs=["Red","Orange","Yellow","YellowRepair","Green"].map(k=>{const p=(data[k]||0)/tot;const s=cum;cum+=p;return{k,p,s};}).filter(x=>x.p>0);function arc(s,e){const sa=s*2*Math.PI-Math.PI/2,ea=e*2*Math.PI-Math.PI/2;return "M "+(cx+r*Math.cos(sa))+" "+(cy+r*Math.sin(sa))+" A "+r+" "+r+" 0 "+((e-s)>.5?1:0)+" 1 "+(cx+r*Math.cos(ea))+" "+(cy+r*Math.sin(ea));}return <svg width="96" height="96" viewBox="0 0 100 100"><circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw}/>{segs.map(x=><path key={x.k} d={arc(x.s,x.s+x.p)} fill="none" stroke={cols[x.k]} strokeWidth={sw}/>)}</svg>;}

// ═══ LOGIN ════════════════════════════════════════════════════════════════════
function LoginScreen({onLogin}) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [mode,     setMode]     = useState("login");

  async function handleLogin() {
    if (!email || !password) { setError("Enter your email and password."); return; }
    setLoading(true); setError("");
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) { setError(err.message); setLoading(false); return; }
      const { data: profile } = await supabase
        .from("profiles").select("role,name").eq("id", data.user.id).single();
      const role = profile?.role || "instructor";
      const name = profile?.name || email.split("@")[0];
      onLogin(role, { id: data.user.id, name, email, role });
    } catch(e) { setError("Login failed — check your credentials."); }
    setLoading(false);
  }

  async function handleReset() {
    if (!email) { setError("Enter your email address first."); return; }
    setLoading(true); setError("");
    const { error: err } = await supabase.auth.resetPasswordForEmail(email,
      { redirectTo: window.location.origin });
    setError(err ? err.message : "✅ Reset email sent — check your inbox.");
    setLoading(false);
  }

  return (
    <div style={{minHeight:"100vh",background:"radial-gradient(ellipse at 20% 0%, #1a3a1a 0%, "+T.bg+" 60%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,gap:20}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:48,fontWeight:900,color:T.white,letterSpacing:-2}}>HILLARY</div>
        <div style={{fontSize:11,letterSpacing:8,color:T.muted,textTransform:"uppercase"}}>OUTDOORS</div>
        <div style={{fontSize:14,color:T.muted,marginTop:6}}>Gear Management System</div>
      </div>
      <div style={{width:"100%",maxWidth:380}}>
        <Card>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white,marginBottom:18,textAlign:"center"}}>
            {mode==="login"?"Sign In":"Reset Password"}
          </div>
          {error&&(
            <div style={{background:error.startsWith("✅")?"rgba(39,174,96,0.12)":"rgba(192,57,43,0.12)",border:"1px solid "+(error.startsWith("✅")?"rgba(39,174,96,0.3)":"rgba(192,57,43,0.3)"),borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:13,color:error.startsWith("✅")?"#7adf9a":"#ff8a7a",lineHeight:1.5}}>
              {error}
            </div>
          )}
          <FL>Email</FL>
          <input id="login-email" type="email" placeholder="you@hillaryoutdoors.co.nz"
            value={email} onChange={e=>{setEmail(e.target.value);setError("");}}
            onKeyDown={e=>e.key==="Enter"&&mode==="login"&&handleLogin()}
            autoComplete="email"/>
          {mode==="login"&&<>
            <FL>Password</FL>
            <input id="login-password" type="password" placeholder="Your password"
              value={password} onChange={e=>{setPassword(e.target.value);setError("");}}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              autoComplete="current-password"/>
          </>}
          <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:8}}>
            {mode==="login"
              ?<Btn onClick={handleLogin} disabled={loading} style={{width:"100%"}}>{loading?"Signing in…":"Sign In"}</Btn>
              :<Btn onClick={handleReset} disabled={loading} style={{width:"100%"}}>{loading?"Sending…":"Send Reset Email"}</Btn>}
            <button onClick={()=>{setMode(m=>m==="login"?"reset":"login");setError("");}}
              style={{background:"none",border:"none",color:T.muted,fontSize:13,cursor:"pointer",textDecoration:"underline"}}>
              {mode==="login"?"Forgot password?":"← Back to sign in"}
            </button>
          </div>
        </Card>
        <p style={{fontSize:12,color:T.muted,textAlign:"center",marginTop:12,lineHeight:1.7}}>
          First time? Ask your manager to add you in Supabase Auth,<br/>then set your role in the Instructors tab.
        </p>
      </div>
    </div>
  );
}

// ═══ QR / NFC SCANNER ═════════════════════════════════════════════════════════

// Resolve a raw scanned string to { kind, payload }
function resolveTag(raw, gear, types, lists) {
  const s = (raw || '').trim();
  if (!s) return null;
  // 1. Gear by NFC / QR / numeric ID / serial
  const byNfc = gear.find(g => g.nfc_tag === s);
  if (byNfc) return { kind: 'gear', payload: byNfc.gear_id };
  const byQr = gear.find(g => g.qr_code === s);
  if (byQr) return { kind: 'gear', payload: byQr.gear_id };
  const bySerial = gear.find(g => g.physical_serial === s);
  if (bySerial) return { kind: 'gear', payload: bySerial.gear_id };
  const n = parseInt(s);
  if (!isNaN(n) && gear.find(g => g.gear_id === n)) return { kind: 'gear', payload: n };
  // 2. List by NFC / QR / list_id (LST prefix or exact match)
  if (lists) {
    const byList = lists.find(l => l.nfc_tag === s || l.qr_code === s || l.list_id === s);
    if (byList) return { kind: 'list', payload: byList.list_id };
  }
  if (s.startsWith('LST')) return { kind: 'list', payload: s.toUpperCase() };
  // 3. Category (sized pool or any tagged category)
  const byType = types.find(t => t.nfc_tag === s || t.qr_code === s);
  if (byType) return { kind: 'type', payload: byType.cat_id||byType.type_id };
  // 4. Fallback: numeric → assume gear ID
  const n2 = parseInt(s);
  if (!isNaN(n2)) return { kind: 'gear', payload: n2 };
  return null;
}

// ─── ScannerOverlay ─── QR camera with one-tap NFC switch + manual fallback
// Pass onSwitchToNFC to enable the switch button (used in ScanScreen).
function ScannerOverlay({ onResult, onClose, onSwitchToNFC, title, hint }) {
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const rafRef     = useRef(null);
  const doneRef    = useRef(false);
  const canvasRef  = useRef(null);

  const [err,        setErr]        = useState(null);
  const [detected,   setDetected]   = useState(false);
  const [torch,      setTorch]      = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualVal,  setManualVal]  = useState('');

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const handleResult = useCallback((raw) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDetected(true);
    cleanup();
    setTimeout(() => onResult(raw.trim()), 300);
  }, [cleanup, onResult]);

  function scanLoop() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || doneRef.current) return;
    if (video.readyState < 2) { rafRef.current = requestAnimationFrame(scanLoop); return; }
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    if ('BarcodeDetector' in window) {
      const bd = new window.BarcodeDetector({ formats: ['qr_code','data_matrix','code_128','code_39','ean_13'] });
      bd.detect(canvas)
        .then(codes => {
          if (codes.length > 0 && !doneRef.current) { handleResult(codes[0].rawValue); return; }
          if (!doneRef.current) rafRef.current = requestAnimationFrame(scanLoop);
        })
        .catch(() => { if (!doneRef.current) rafRef.current = requestAnimationFrame(scanLoop); });
    } else {
      if (!doneRef.current) rafRef.current = requestAnimationFrame(scanLoop);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.play().then(() => { if (!cancelled) scanLoop(); }).catch(() => {});
        }
      } catch (e) {
        if (!cancelled) setErr('Camera access denied — use manual entry or switch to NFC.');
      }
    }
    init();
    return () => { cancelled = true; cleanup(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track?.getCapabilities().torch) {
      const next = !torch;
      track.applyConstraints({ advanced: [{ torch: next }] }).catch(() => {});
      setTorch(next);
    }
  }

  function handleSwitchNFC() { cleanup(); if (onSwitchToNFC) onSwitchToNFC(); }
  function submitManual() { const v = manualVal.trim(); if (v) handleResult(v); }
  const hasBD = 'BarcodeDetector' in window;
  const nfcAvail = 'NDEFReader' in window;

  return (
    <div style={{position:'fixed',inset:0,background:'#000',zIndex:9000,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
      {/* Header */}
      <div style={{position:'absolute',top:0,left:0,right:0,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',background:'linear-gradient(#000c,transparent)',zIndex:10}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:'#fff'}}>{title||'Scan QR Code'}</div>
          <div style={{fontSize:12,color:'rgba(255,255,255,0.6)',marginTop:2}}>{hint||'Point camera at QR label on gear'}</div>
        </div>
        {/* NFC toggle — one tap to switch */}
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {onSwitchToNFC && (
            <button onClick={handleSwitchNFC} title="Switch to NFC" style={{background:nfcAvail?'rgba(74,128,200,0.25)':'rgba(255,255,255,0.1)',border:`1px solid ${nfcAvail?'rgba(74,128,200,0.6)':'rgba(255,255,255,0.2)'}`,color:nfcAvail?'#7ab0ff':'rgba(255,255,255,0.4)',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:16}}>📡</span> NFC
            </button>
          )}
          <button onClick={()=>{cleanup();onClose();}} style={{background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',borderRadius:'50%',width:38,height:38,fontSize:22,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
        </div>
      </div>

      {err ? (
        <div style={{textAlign:'center',padding:28}}>
          <div style={{fontSize:44,marginBottom:12}}>📷</div>
          <p style={{color:'#ff8a7a',fontSize:15,marginBottom:16,lineHeight:1.6}}>{err}</p>
          {onSwitchToNFC && (
            <button onClick={handleSwitchNFC} style={{background:'rgba(74,128,200,0.2)',border:'1px solid rgba(74,128,200,0.5)',color:'#7ab0ff',borderRadius:10,padding:'10px 20px',fontSize:14,fontWeight:600,cursor:'pointer'}}>
              📡 Switch to NFC instead
            </button>
          )}
        </div>
      ) : (
        <div style={{position:'relative',width:'100%',maxWidth:480,aspectRatio:'1',overflow:'hidden'}}>
          <video ref={videoRef} playsInline muted style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
          <canvas ref={canvasRef} style={{display:'none'}}/>
          <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
            <div style={{width:'62%',aspectRatio:'1',position:'relative',boxShadow:'0 0 0 9999px rgba(0,0,0,0.55)',borderRadius:10}}>
              {[['top','left'],['top','right'],['bottom','left'],['bottom','right']].map(([v,h])=>(
                <div key={v+h} style={{position:'absolute',[v]:-2,[h]:-2,width:20,height:20,
                  borderTop:   v==='top'   ?'3px solid #e8621a':'none',
                  borderBottom:v==='bottom'?'3px solid #e8621a':'none',
                  borderLeft:  h==='left'  ?'3px solid #e8621a':'none',
                  borderRight: h==='right' ?'3px solid #e8621a':'none',
                  borderRadius:h==='left'?(v==='top'?'4px 0 0 0':'0 0 0 4px'):(v==='top'?'0 4px 0 0':'0 0 4px 0')
                }}/>
              ))}
              {detected && (
                <div style={{position:'absolute',inset:0,background:'rgba(39,174,96,0.35)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <span style={{fontSize:44}}>✅</span>
                </div>
              )}
            </div>
          </div>
          {!detected && hasBD && (
            <div style={{position:'absolute',left:'19%',right:'19%',height:2,background:'linear-gradient(90deg,transparent,#e8621a,transparent)',animation:'scanline 2s ease-in-out infinite',pointerEvents:'none'}}/>
          )}
        </div>
      )}

      {/* Bottom controls */}
      <div style={{position:'absolute',bottom:0,left:0,right:0,padding:'16px 18px 32px',background:'linear-gradient(transparent,#000b)',display:'flex',flexDirection:'column',gap:10,alignItems:'center'}}>
        {!hasBD && !err && (
          <p style={{fontSize:12,color:'rgba(255,255,255,0.55)',textAlign:'center',lineHeight:1.6,maxWidth:320,margin:0}}>
            Auto QR detect requires Chrome on Android/desktop. Use NFC or manual entry on this device.
          </p>
        )}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
          <button onClick={toggleTorch} style={{background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.2)',color:'#fff',borderRadius:8,padding:'8px 14px',fontSize:13,cursor:'pointer'}}>
            {torch?'🔦 Off':'🔦 Torch'}
          </button>
          <button onClick={()=>setShowManual(m=>!m)} style={{background:showManual?'rgba(232,98,26,0.3)':'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.2)',color:'#fff',borderRadius:8,padding:'8px 14px',fontSize:13,cursor:'pointer'}}>
            ⌨ Manual
          </button>
        </div>
        {showManual && (
          <div style={{display:'flex',gap:6,width:'100%',maxWidth:340}}>
            <input value={manualVal} onChange={e=>setManualVal(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submitManual()}
              placeholder="Gear ID, serial, NFC or QR code" id="scanner-manual-input" autoFocus
              style={{flex:1,background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.35)',color:'#fff',borderRadius:8,padding:'10px 12px',fontSize:14,outline:'none'}}/>
            <button onClick={submitManual} disabled={!manualVal.trim()} style={{background:'#e8621a',border:'none',color:'#fff',borderRadius:8,padding:'10px 16px',fontWeight:700,fontSize:14,cursor:manualVal.trim()?'pointer':'not-allowed',opacity:manualVal.trim()?1:0.4}}>Go</button>
          </div>
        )}
      </div>
      <style>{`@keyframes scanline{0%{top:19%}50%{top:81%}100%{top:19%}}`}</style>
    </div>
  );
}

// ─── NFCOverlay ─── Web NFC API (Chrome + Android only)
function NFCOverlay({ onResult, onClose, onSwitchToQR, title, hint }) {
  const readerRef = useRef(null);
  const doneRef   = useRef(false);
  const [status,    setStatus]    = useState('starting'); // starting|scanning|error|success
  const [msg,       setMsg]       = useState('');
  const [manualVal, setManualVal] = useState('');

  function stopNFC() { readerRef.current = null; }

  const handleResult = useCallback((raw) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setStatus('success');
    stopNFC();
    setTimeout(() => onResult(raw.trim()), 300);
  }, [onResult]);

  useEffect(() => {
    if (!('NDEFReader' in window)) {
      setStatus('error');
      setMsg('Web NFC requires Chrome on Android. Use manual entry or switch to QR scanner.');
      return;
    }
    async function start() {
      try {
        const reader = new window.NDEFReader();
        readerRef.current = reader;
        await reader.scan();
        setStatus('scanning');
        setMsg('Hold device near the NFC sticker…');
        reader.onreading = (event) => {
          let decoded = '';
          for (const record of event.message.records) {
            try {
              const td = new TextDecoder(record.encoding || 'utf-8');
              decoded = td.decode(record.data).trim();
              if (decoded) break;
            } catch {}
          }
          if (decoded) handleResult(decoded);
          else setMsg('Tag read but empty — try again or use manual entry.');
        };
        reader.onreadingerror = () => setMsg('Could not read tag — try again.');
      } catch (e) {
        setStatus('error');
        setMsg('NFC error: ' + (e.message || 'Could not start scanner.'));
      }
    }
    start();
    return () => stopNFC();
  }, [handleResult]);

  function submitManual() {
    const v = manualVal.trim();
    if (v) handleResult(v);
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.93)',zIndex:9000,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{position:'absolute',top:0,left:0,right:0,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:'#fff'}}>{title||'NFC Scan'}</div>
          <div style={{fontSize:12,color:'rgba(255,255,255,0.6)',marginTop:2}}>{hint||'Hold device near NFC sticker'}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {onSwitchToQR && (
            <button onClick={()=>{stopNFC();onSwitchToQR();}} style={{background:'rgba(39,174,96,0.2)',border:'1px solid rgba(39,174,96,0.5)',color:'#7adf9a',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:16}}>📷</span> QR
            </button>
          )}
          <button onClick={()=>{stopNFC();onClose();}} style={{background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',borderRadius:'50%',width:38,height:38,fontSize:22,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
        </div>
      </div>

      <div style={{textAlign:'center',marginBottom:28}}>
        {status==='scanning' && (
          <div style={{position:'relative',width:140,height:140,margin:'0 auto 20px'}}>
            {[0,1,2].map(i=>(
              <div key={i} style={{position:'absolute',inset:0,border:'2px solid #e8621a',borderRadius:'50%',animation:`sr 1.8s ease-out ${i*0.5}s infinite`}}/>
            ))}
            <div style={{width:140,height:140,borderRadius:'50%',background:'radial-gradient(circle,rgba(232,98,26,0.15),#0d1a0d)',border:'3px solid #e8621a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:56}}>📡</div>
          </div>
        )}
        {status==='error'   && <div style={{fontSize:52,marginBottom:14}}>⚠️</div>}
        {status==='success' && <div style={{fontSize:52,marginBottom:14}}>✅</div>}
        {status==='starting'&& <div style={{fontSize:52,marginBottom:14}}>📡</div>}
        <p style={{color:status==='error'?'#ff8a7a':status==='success'?'#27ae60':'rgba(255,255,255,0.9)',fontSize:15,lineHeight:1.65,maxWidth:300,margin:'0 auto'}}>{msg}</p>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:8,width:'100%',maxWidth:340}}>
        <p style={{fontSize:12,color:'rgba(255,255,255,0.5)',textAlign:'center',margin:0}}>Or enter the tag ID manually:</p>
        <div style={{display:'flex',gap:6}}>
          <input
            id="nfc-manual-input"
            value={manualVal}
            onChange={e=>setManualVal(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&submitManual()}
            placeholder="NFC tag ID, gear ID or serial"
            style={{flex:1,background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.28)',color:'#fff',borderRadius:8,padding:'10px 12px',fontSize:14,outline:'none'}}
          />
          <button onClick={submitManual} disabled={!manualVal.trim()} style={{background:'#e8621a',border:'none',color:'#fff',borderRadius:8,padding:'10px 16px',fontWeight:700,fontSize:14,cursor:manualVal.trim()?'pointer':'not-allowed',opacity:manualVal.trim()?1:0.4}}>Go</button>
        </div>
      </div>
    </div>
  );
}


// ═══ INSTRUCTOR — SCAN ════════════════════════════════════════════════════════
function ScanScreen({gear,types,lists,usage,currentUser,onScanResult,onQuickSignIn}){
  // Opens directly on QR. Single tap on "📡 NFC" badge switches mode.
  const [scanner,setScanner]=useState(null); // null | 'qr' | 'nfc'
  // Count outstanding sign-outs for the banner. Two cases:
  //   - Individual gear: the gear row's signed_in_out flag flips to 'OUT'
  //     when checked out, so we cross-check it against the open usage row.
  //   - Bucket sign-outs: the bucket gear row stays 'IN' (it's a stock
  //     counter, not a thing-that-goes-out), so for buckets we trust the
  //     open usage row alone and don't gate on the gear flag.
  // Without this distinction, sized-pool sign-outs were invisible to the
  // home-screen banner — the button only appeared after an unrelated
  // individual sign-out forced this useMemo to recompute.
  const myOutCount = useMemo(() => {
    const open = usage.filter(u =>
      u.instructor === currentUser.name &&
      u.gear_id &&
      u.signed_in_out === "OUT" &&
      !u.time_in
    );
    let count = 0;
    const seenIndivIds = new Set();
    for (const u of open) {
      const g = gear.find(x => x.gear_id === u.gear_id);
      if (!g) continue;
      if (g.is_pool_bucket) {
        // Bucket: each open usage row counts as 1 outstanding "checkout"
        // (regardless of how many physical items the row represents).
        count += 1;
      } else {
        // Individual: only count if the gear row really is OUT,
        // and dedupe (an item can have multiple historical usage rows).
        if (g.signed_in_out === "OUT" && !seenIndivIds.has(g.gear_id)) {
          seenIndivIds.add(g.gear_id);
          count += 1;
        }
      }
    }
    return count;
  }, [gear, usage, currentUser]);

  function handleRaw(raw){
    setScanner(null);
    const res = resolveTag(raw, gear, types, lists);
    if(res) onScanResult(res.kind, res.payload);
    else    onScanResult("notfound", raw);
  }

  return <>
    {scanner==="qr"&&<ScannerOverlay
      title="Scan QR Code" hint="Point camera at QR label on gear"
      onResult={handleRaw} onClose={()=>setScanner(null)}
      onSwitchToNFC={()=>setScanner("nfc")}
    />}
    {scanner==="nfc"&&<NFCOverlay
      title="Scan NFC Tag" hint="Hold device near NFC sticker on gear"
      onResult={handleRaw} onClose={()=>setScanner(null)}
      onSwitchToQR={()=>setScanner("qr")}
    />}
    {/* Full-height phone layout */}
    <div style={{
      display:"flex",flexDirection:"column",
      minHeight:"100dvh",
      maxWidth:480,margin:"0 auto",
      padding:"max(env(safe-area-inset-top),16px) 20px max(env(safe-area-inset-bottom),24px)",
      boxSizing:"border-box",
      background:"radial-gradient(ellipse at 30% 0%, #1a3a1a 0%, "+T.bg+" 55%)",
    }}>

      {/* ── Header ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,flexShrink:0}}>
        <div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:900,color:T.white,letterSpacing:-1,lineHeight:1}}>HILLARY</div>
          <div style={{fontSize:9,letterSpacing:6,color:T.muted,textTransform:"uppercase",marginTop:1}}>OUTDOORS</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:14,color:T.white,fontWeight:600}}>Hi, {currentUser.name}</div>
          <div style={{fontSize:11,color:T.muted,marginTop:1}}>Instructor</div>
        </div>
      </div>

      {/* ── Gear-out banner ── */}
      {myOutCount>0
        ? <button onClick={onQuickSignIn} style={{
            width:"100%",background:"rgba(39,174,96,0.12)",
            border:"1px solid rgba(39,174,96,0.4)",borderRadius:14,
            padding:"13px 16px",cursor:"pointer",marginBottom:20,
            display:"flex",alignItems:"center",gap:12,textAlign:"left",
            WebkitTapHighlightColor:"transparent",flexShrink:0,
          }}>
            <div style={{width:40,height:40,borderRadius:"50%",background:"#27ae60",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:"#fff",fontSize:16,fontWeight:800}}>{myOutCount}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700,color:"#27ae60"}}>{myOutCount} item{myOutCount>1?"s":""} still signed out</div>
              <div style={{fontSize:12,color:T.muted,marginTop:2}}>Tap to sign back in →</div>
            </div>
            <div style={{fontSize:20,color:"#27ae60"}}>›</div>
          </button>
        : <div style={{height:20,flexShrink:0}}/>
      }

      {/* ── Main scan area ── */}
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:0}}>

        {/* Instruction text */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:18,fontWeight:700,color:T.white,marginBottom:6}}>Scan Gear</div>
          <div style={{fontSize:13,color:T.muted,lineHeight:1.6}}>Point camera at the QR label<br/>or tap NFC to read a sticker</div>
        </div>

        {/* Scan button */}
        <button onClick={()=>setScanner("qr")} style={{
            width:160,height:160,borderRadius:"50%",
            background:"radial-gradient(circle at 40% 35%, #2d5a2d, #0d1a0d)",
            border:"3px solid #2d5a2d",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,
            cursor:"pointer",outline:"none",
            boxShadow:"0 8px 32px rgba(0,0,0,0.4), 0 0 48px rgba(232,98,26,0.12)",
            WebkitTapHighlightColor:"transparent",
            transition:"transform .1s,box-shadow .15s,border-color .15s",
            marginBottom:18,
          }}
          onTouchStart={e=>{e.currentTarget.style.transform="scale(0.96)";e.currentTarget.style.borderColor=T.accent;}}
          onTouchEnd={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.borderColor="#2d5a2d";}}
          onMouseDown={e=>e.currentTarget.style.transform="scale(0.97)"}
          onMouseUp={e=>e.currentTarget.style.transform="scale(1)"}>
          <span style={{fontSize:44,lineHeight:1}}>📷</span>
          <span style={{fontSize:13,color:"#e8f0e8",fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>SCAN</span>
        </button>

        {/* NFC pill */}
        <button onClick={()=>setScanner("nfc")} style={{
          background:"rgba(74,128,200,0.10)",
          border:"1px solid rgba(74,128,200,0.3)",
          color:"#7ab0ff",borderRadius:24,
          padding:"8px 20px",fontSize:13,fontWeight:600,
          cursor:"pointer",display:"flex",alignItems:"center",gap:8,
          WebkitTapHighlightColor:"transparent",
        }}>
          <span style={{fontSize:15}}>📡</span> Use NFC instead
        </button>
      </div>

      {/* ── Footer hint ── */}
      <div style={{textAlign:"center",flexShrink:0,paddingTop:12}}>
        <div style={{fontSize:11,color:"rgba(106,138,106,0.6)",lineHeight:1.6}}>
          NFC requires Android + Chrome
        </div>
      </div>
    </div>
  </>;
}

// ═══ INSTRUCTOR — GEAR DETAIL (signable) ══════════════════════════════════════
function GearDetailScreen({item,gear,onBack,onSignOut,onSignIn,onReport,lastAct}){
  const live=gear.find(g=>g.gear_id===item.gear_id)||item;
  const isRed=live.status==="Red",isRepair=live.status==="YellowRepair",isOut=live.signed_in_out==="OUT";
  const cool=lastAct&&(Date.now()-lastAct)<3000;
  return <div style={{padding:24,maxWidth:440,margin:"0 auto"}}>
    <button onClick={onBack} style={{background:"none",border:"none",color:T.muted,fontSize:14,marginBottom:20}}>← Back</button>
    <div style={{textAlign:"center",marginBottom:22}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:T.white}}>Gear Details</div></div>
    <Card style={{marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}><div><div style={{fontSize:19,fontWeight:700,color:T.white}}>{live.item}</div><div style={{fontSize:12,color:T.muted,marginTop:3}}>ID {live.gear_id}{live.physical_serial?" · "+live.physical_serial:""}</div></div><SBadge status={live.status}/></div>
      <KV label="Location" value={live.location}/>
      {live.usage_limit&&<KV label="Uses" value={live.number_of_uses+" / "+live.usage_limit}/>}
      {live.expiry&&<KV label="Expiry" value={fmtD(live.expiry)}/>}
      <KV label="State" value={<span style={{color:isOut?T.accent:"#27ae60",fontWeight:600}}>{isOut?"⬆ Signed Out":"⬇ Signed In"}</span>}/>
      {live.notes&&<KV label="Notes" value={live.notes}/>}
      {isRed&&<div style={{marginTop:12,background:"rgba(192,57,43,0.17)",border:"1px solid rgba(192,57,43,0.4)",borderRadius:9,padding:"10px 14px",fontSize:14,color:"#ff8a7a"}}>⛔ Red — cannot sign out. Report only.</div>}
      {isRepair&&<div style={{marginTop:12,background:"rgba(155,124,12,0.17)",border:"1px solid rgba(155,124,12,0.4)",borderRadius:9,padding:"10px 14px",fontSize:14,color:"#e0c060"}}>🔧 Awaiting repair — cannot sign out until fixed.</div>}
      {cool&&<div style={{marginTop:10,background:"rgba(232,98,26,0.12)",border:"1px solid rgba(232,98,26,0.3)",borderRadius:9,padding:"10px 14px",fontSize:14,color:T.accent}}>⏳ Please wait 3s.</div>}
    </Card>
    <div style={{display:"flex",flexDirection:"column",gap:9}}>
      {!isRed&&!isRepair&&!isOut&&<Btn onClick={onSignOut} disabled={cool} color={T.accent}>Sign Out</Btn>}
      {!isRed&&!isRepair&&isOut&&<Btn onClick={onSignIn} disabled={cool} color="#27ae60">Sign In</Btn>}
      <Btn onClick={onReport} color="#3a4a3a" style={{border:"1px solid "+T.border}}>Report Issue</Btn>
    </div>
  </div>;
}

// ═══ INSTRUCTOR — LIST DETAIL ═════════════════════════════════════════════════
function ListDetailScreen({list,gear,types,cats,onBack,onSignOutAll,onSignInAll,onReportItem}){
  const items=list.gear_ids.map(id=>gear.find(g=>g.gear_id===id)).filter(Boolean);
  const allMon=items.length>0&&items.every(g=>behaviourOf(g,cats)==="monitored_only");
  const avail=items.filter(g=>g.status!=="Red"&&g.status!=="YellowRepair"&&g.signed_in_out==="IN");
  const unavail=items.filter(g=>g.status==="Red"||g.status==="YellowRepair"||g.signed_in_out==="OUT");
  const allOut=items.length>0&&items.every(g=>g.signed_in_out==="OUT");
  return <div style={{padding:24,maxWidth:460,margin:"0 auto"}}>
    <button onClick={onBack} style={{background:"none",border:"none",color:T.muted,fontSize:14,marginBottom:20}}>← Back</button>
    <div style={{textAlign:"center",marginBottom:16}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:T.white}}>{list.name}</div><div style={{fontSize:13,color:T.muted,marginTop:4}}>{items.length} item{items.length!==1?"s":""}</div></div>
    {allMon&&<Card style={{marginBottom:12,border:"1px solid rgba(74,128,200,0.3)"}}><p style={{fontSize:13,color:"#7ab0ff",lineHeight:1.6}}>📍 Monitored list — items stay in place. Tap to report an issue.</p></Card>}
    {!allMon&&unavail.length>0&&(
      <Card style={{marginBottom:12,border:"1px solid rgba(230,126,34,0.4)",background:"rgba(230,126,34,0.08)"}}>
        <p style={{fontSize:14,fontWeight:600,color:"#ffaa7a",marginBottom:8}}>⚠ {unavail.length} item{unavail.length!==1?"s":""} unavailable</p>
        {unavail.map(g=><div key={g.gear_id} style={{fontSize:13,color:T.text,padding:"4px 0",display:"flex",justifyContent:"space-between"}}><span>{g.item} #{g.gear_id}</span><span style={{color:T.muted}}>{g.status==="Red"?"🚫 Red":g.status==="YellowRepair"?"🔧 Repair":"⬆ Out"}</span></div>)}
        <p style={{fontSize:12,color:T.muted,marginTop:8}}>You can proceed with the {avail.length} available.</p>
      </Card>
    )}
    <Card style={{marginBottom:12}}>
      {items.map(g=><div key={g.gear_id} className="cl" onClick={()=>onReportItem(g)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}><SBadge status={g.status} small/><div style={{flex:1,minWidth:0}}><div style={{fontSize:13,color:T.white}}>{g.item}</div><div style={{fontSize:11,color:T.muted}}>#{g.gear_id} · {g.location}</div></div><span style={{fontSize:11,color:T.muted}}>{g.signed_in_out==="OUT"?"⬆":"⬇"}</span></div>)}
    </Card>
    {!allMon&&(allOut?<Btn onClick={onSignInAll} color="#27ae60" style={{width:"100%"}}>Sign All Back In</Btn>:<Btn onClick={()=>onSignOutAll(avail.map(g=>g.gear_id))} disabled={avail.length===0} color={T.accent} style={{width:"100%"}}>{avail.length===0?"None available":"Sign Out "+avail.length+" Item"+(avail.length!==1?"s":"")}</Btn>)}
  </div>;
}

// ═══ INSTRUCTOR — REPORT ══════════════════════════════════════════════════════
function ReportScreen({item,onBack,onSubmit,saving}){
  const [status,setStatus]=useState("Yellow");const [notes,setNotes]=useState("");
  return <div style={{padding:24,maxWidth:440,margin:"0 auto"}}>
    <button onClick={onBack} style={{background:"none",border:"none",color:T.muted,fontSize:14,marginBottom:20}}>← Back</button>
    <div style={{textAlign:"center",marginBottom:20}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:T.white}}>Report Issue</div><div style={{fontSize:13,color:T.muted,marginTop:3}}>{item.item} — ID {item.gear_id}</div></div>
    <Card style={{marginBottom:14}}>
      <FL>Condition Status</FL>
      {["Red","Orange","Yellow","YellowRepair","Green"].map(s=>(
        <label key={s} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"9px 11px",borderRadius:9,background:status===s?SC[s].lt:"transparent",border:"1px solid "+(status===s?SC[s].bg:"transparent"),marginBottom:5}}>
          <input type="radio" name="rs" checked={status===s} onChange={()=>setStatus(s)} style={{width:"auto"}}/>
          <div style={{width:10,height:10,borderRadius:"50%",background:SC[s].bg,flexShrink:0}}/>
          <div style={{flex:1}}><span style={{fontSize:14,fontWeight:status===s?700:500,color:T.white}}>{s==="YellowRepair"?"Yellow Repair":s}</span><div style={{fontSize:12,color:T.muted,marginTop:1,lineHeight:1.4}}>{SC[s].meaning}</div></div>
        </label>
      ))}
      <FL>Notes</FL>
      <textarea rows={3} placeholder="What did you observe…" value={notes} onChange={e=>setNotes(e.target.value)}/>
    </Card>
    <Btn onClick={()=>onSubmit(status,notes)} disabled={saving} color="#c0392b" style={{width:"100%"}}>{saving?"Submitting…":"Submit Report"}</Btn>
  </div>;
}

// ═══ INSTRUCTOR — SIZED POOL ══════════════════════════════════════════════════
function SizedPoolScreen({type,gear,onBack,onSubmit,onReportDamage}){
  // Detect which style this category is. Default to individual when missing.
  const isBucket = type.sized_pool_style === "bucket";
  // Mode: 'signout' (default — sign N items out for use, returnable)
  //       'damage'  (reduce capacity — lost or damaged beyond repair)
  const [mode, setMode] = useState('signout');

  // Sizes: prefer the type's pre-computed list (canonical order); else derive
  // from gear, sorted canonically.
  const sizes = useMemo(()=>{
    if(type.sizes && type.sizes.length>0) return type.sizes;
    return sortSizes([...new Set(
      gear.filter(g=>g.category_id===type.cat_id && g.size).map(g=>g.size)
    )]);
  },[type, gear]);

  // Available counts per size — different math depending on style.
  const avail = useMemo(()=>{
    const b={}; sizes.forEach(s=>b[s]=0);
    if(isBucket){
      gear.forEach(g=>{
        if(g.category_id!==type.cat_id || !g.is_pool_bucket) return;
        if(g.status==="Red"||g.status==="YellowRepair") return;
        if(b[g.size]!=null) b[g.size] += Number(g.pool_count)||0;
      });
    } else {
      gear.forEach(g=>{
        if(g.category_id!==type.cat_id) return;
        if(g.signed_in_out!=="IN") return;
        if(g.status==="Red"||g.status==="YellowRepair") return;
        if(b[g.size]!=null) b[g.size]++;
      });
    }
    return b;
  },[type,gear,sizes,isBucket]);

  const [qty,setQty]=useState(()=>{const q={}; sizes.forEach(s=>q[s]=0); return q;});
  // Reset qty if sizes change (e.g. after adding a new bucket).
  useEffect(()=>{const q={}; sizes.forEach(s=>q[s]=qty[s]||0); setQty(q);},[sizes.length]); // eslint-disable-line
  const total=Object.values(qty).reduce((a,b)=>a+b,0);
  function adj(s,d){setQty(q=>({...q,[s]:Math.max(0,Math.min(avail[s]||0,(q[s]||0)+d))}));}

  return <div style={{padding:24,maxWidth:440,margin:"0 auto"}}>
    <button onClick={onBack} style={{background:"none",border:"none",color:T.muted,fontSize:14,marginBottom:20}}>← Back</button>
    <div style={{textAlign:"center",marginBottom:14}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:T.white}}>{type.name}</div>
      <div style={{fontSize:13,color:T.muted,marginTop:3}}>pick quantity per size</div>
      <div style={{marginTop:6,display:"flex",justifyContent:"center",gap:6}}>
        <BhBadge behaviour="sized_pool"/>
        <span style={{fontSize:10,padding:"2px 8px",borderRadius:8,background:isBucket?"rgba(232,98,26,0.15)":"rgba(74,128,200,0.15)",color:isBucket?T.accent:"#7ab0ff",fontWeight:700,letterSpacing:0.5}}>{isBucket?"BUCKET":"INDIVIDUAL"}</span>
      </div>
    </div>
    {sizes.length===0 ? (
      <Card><p style={{fontSize:13,color:T.muted,textAlign:"center",padding:8}}>No sizes recorded for {type.name}. Add stock in the Sized Pool tab first.</p></Card>
    ) : (
      <Card style={{marginBottom:14}}>
        {sizes.map(s=>(
          <div key={s} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 4px",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
            <div style={{flex:1}}>
              <div style={{fontSize:15,fontWeight:700,color:T.white}}>Size {s}</div>
              <div style={{fontSize:12,color:(avail[s]||0)===0?"#ff8a7a":T.muted,marginTop:2}}>{avail[s]||0} available</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <button onClick={()=>adj(s,-1)} disabled={(qty[s]||0)===0} style={{width:34,height:34,borderRadius:"50%",background:(qty[s]||0)===0?"rgba(255,255,255,0.05)":T.g2,border:"none",color:(qty[s]||0)===0?T.muted:"#fff",fontSize:17,fontWeight:700}}>−</button>
              <div style={{width:38,textAlign:"center",fontSize:18,fontWeight:700,color:(qty[s]||0)>0?T.accent:T.muted}}>{qty[s]||0}</div>
              <button onClick={()=>adj(s,1)} disabled={(qty[s]||0)>=(avail[s]||0)} style={{width:34,height:34,borderRadius:"50%",background:(qty[s]||0)>=(avail[s]||0)?"rgba(255,255,255,0.05)":T.accent,border:"none",color:(qty[s]||0)>=(avail[s]||0)?T.muted:"#fff",fontSize:17,fontWeight:700}}>+</button>
            </div>
          </div>
        ))}
      </Card>
    )}
    {/* Mode toggle — choose between signing out (returnable) or reporting damage (permanent). */}
    {isBucket && (
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        <button type="button" onClick={()=>setMode('signout')} style={{flex:1,background:mode==='signout'?"rgba(232,98,26,0.15)":"rgba(255,255,255,0.04)",border:"1px solid "+(mode==='signout'?T.accent:T.border),color:mode==='signout'?T.white:T.muted,borderRadius:8,padding:"9px 12px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Sign Out (returnable)</button>
        <button type="button" onClick={()=>setMode('damage')} style={{flex:1,background:mode==='damage'?"rgba(192,57,43,0.18)":"rgba(255,255,255,0.04)",border:"1px solid "+(mode==='damage'?"#c0392b":T.border),color:mode==='damage'?T.white:T.muted,borderRadius:8,padding:"9px 12px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Report Damaged / Lost</button>
      </div>
    )}
    <Btn
      onClick={()=> mode==='damage' && isBucket
        ? onReportDamage(qty)
        : onSubmit(qty)
      }
      disabled={total===0}
      color={mode==='damage'?"#c0392b":T.accent}
      style={{width:"100%"}}
    >
      {total===0
        ? "Select quantities"
        : mode==='damage'
          ? `Report ${total} Damaged / Lost`
          : `Sign Out ${total} item${total!==1?"s":""}`
      }
    </Btn>
    <p style={{fontSize:11,color:T.muted,marginTop:10,textAlign:"center",lineHeight:1.6}}>
      {mode==='damage'
        ? "Reduces both stock count AND capacity. Item is gone for good. A report row is created."
        : isBucket
          ? "Bucket-style — decreases the size's pool count. Returnable via My Signed-Out Gear."
          : "Individual-style — picks next available item IDs"}
    </p>
  </div>;
}

// ═══ INSTRUCTOR — MONITORED ═══════════════════════════════════════════════════
function MonitoredDetailScreen({item,gear,onBack,onReport}){
  const live=gear.find(g=>g.gear_id===item.gear_id)||item;
  return <div style={{padding:24,maxWidth:440,margin:"0 auto"}}>
    <button onClick={onBack} style={{background:"none",border:"none",color:T.muted,fontSize:14,marginBottom:20}}>← Back</button>
    <div style={{textAlign:"center",marginBottom:18}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:T.white}}>Item Details</div><div style={{marginTop:6}}><BhBadge behaviour="monitored_only"/></div></div>
    <Card style={{marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}><div><div style={{fontSize:19,fontWeight:700,color:T.white}}>{live.item}</div><div style={{fontSize:12,color:T.muted,marginTop:3}}>ID {live.gear_id}{live.physical_serial?" · "+live.physical_serial:""}</div></div><SBadge status={live.status}/></div>
      <KV label="Location" value={live.location}/>
      {live.expiry&&<KV label="Expiry" value={fmtD(live.expiry)}/>}
      {live.notes&&<KV label="Notes" value={live.notes}/>}
      <div style={{marginTop:12,background:"rgba(74,128,200,0.12)",border:"1px solid rgba(74,128,200,0.3)",borderRadius:9,padding:"10px 14px",fontSize:13,color:"#7ab0ff",lineHeight:1.6}}>📍 Monitored only — stays in place. Report issues only.</div>
    </Card>
    <Btn onClick={onReport} color="#c0392b" style={{width:"100%"}}>Report Issue</Btn>
  </div>;
}

// ═══ INSTRUCTOR — FUEL LOG ════════════════════════════════════════════════════
function FuelLogScreen({tank,gear,cats,fuelLog,onBack,onSubmit}){
  // Vehicles are gear in any category whose budget_owner contains "vehicle" OR
  // whose category name contains "vehicle" / "van" / "trailer". Failing those,
  // fall back to item-name detection. This is more robust than name-prefix.
  const vehicles = useMemo(()=>{
    const isVehicleCat = (cat) => {
      if(!cat) return false;
      const n = (cat.name||'').toLowerCase();
      return n.includes('vehicle') || n.includes('van') || n.includes('trailer') || cat.cat_id==='vehicles' || cat.cat_id==='trailers';
    };
    const byCat = gear.filter(g=>{
      const c = (cats||[]).find(c=>c.cat_id===g.category_id);
      return isVehicleCat(c);
    });
    if(byCat.length>0) return byCat;
    return gear.filter(g => /^(van |trailer)/i.test(g.item||""));
  },[gear,cats]);

  const [vehicleId,setVehicleId]=useState(vehicles[0]?vehicles[0].gear_id:null);
  const [litres,setLitres]=useState("");
  const [total,setTotal]=useState("");
  const canSubmit = vehicleId && litres && total && Number(litres)>0 && Number(total)>=0;
  const lastReading = useMemo(()=>{
    if(!fuelLog||fuelLog.length===0) return null;
    return [...fuelLog].sort((a,b)=>new Date(b.time)-new Date(a.time))[0];
  },[fuelLog]);

  return <div style={{padding:24,maxWidth:440,margin:"0 auto"}}>
    <button onClick={onBack} style={{background:"none",border:"none",color:T.muted,fontSize:14,marginBottom:20}}>← Back</button>
    <div style={{textAlign:"center",marginBottom:14}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:T.white}}>Fuel Log</div><div style={{fontSize:13,color:T.muted,marginTop:3}}>{tank?.item||"Tank"} · {tank?.location||""}</div><div style={{marginTop:6}}><BhBadge behaviour="fuel"/></div></div>
    {lastReading&&(
      <Card style={{marginBottom:12,background:"rgba(155,89,182,0.08)",border:"1px solid rgba(155,89,182,0.22)"}}>
        <p style={{fontSize:12,color:T.muted,marginBottom:3}}>Last pump reading</p>
        <p style={{fontSize:18,fontWeight:700,color:"#b47fd1"}}>{Number(lastReading.pump_gauge_reading).toFixed(1)}L <span style={{fontSize:12,fontWeight:400,color:T.muted}}>· {lastReading.vehicle_name} · {fmtDT(lastReading.time)}</span></p>
      </Card>
    )}
    <Card style={{marginBottom:14}}>
      <FL>Vehicle</FL>
      {vehicles.length===0
        ? <p style={{fontSize:12,color:"#ffaa7a",lineHeight:1.6}}>No vehicles found. Add a category with the word "vehicle" / "van" / "trailer" in its name, then add gear to it.</p>
        : <select value={vehicleId||""} onChange={e=>setVehicleId(Number(e.target.value))}>{vehicles.map(v=><option key={v.gear_id} value={v.gear_id}>{v.item}</option>)}</select>
      }
      <FL>Litres added</FL>
      <input type="number" step="0.1" placeholder="e.g. 45.2" value={litres} onChange={e=>setLitres(e.target.value)}/>
      <FL>Total reading on pump gauge after fill</FL>
      <input type="number" step="0.1" placeholder={lastReading?"e.g. "+(Number(lastReading.pump_gauge_reading)+Number(litres||0)).toFixed(1):"e.g. 1348.2"} value={total} onChange={e=>setTotal(e.target.value)}/>
      <p style={{fontSize:11,color:T.muted,marginTop:12,lineHeight:1.6}}>Read the cumulative total on the tank's pump display. Instructor, time and date auto-recorded.</p>
    </Card>
    <Btn onClick={()=>onSubmit({vehicle_gear_id:vehicleId,litres_added:Number(litres),pump_gauge_reading:Number(total)})} disabled={!canSubmit} color={T.accent} style={{width:"100%"}}>Record Fill</Btn>
  </div>;
}

// ═══ INSTRUCTOR — QUICK SIGN IN ═══════════════════════════════════════════════
function QuickSignInScreen({gear,usage,currentUser,onSignIn,onReport,onSignAll,onBucketSignIn,onBucketReport,onBack}){
  // Two kinds of outstanding usage rows for this instructor:
  //   1. INDIVIDUAL items — usage row references a gear row that is currently
  //      signed_in_out='OUT'. We pair each open usage row with its gear row.
  //   2. BUCKET sign-outs — usage row references a gear row that's a pool
  //      bucket (gear.is_pool_bucket=true). Bucket rows always say IN since
  //      they're counters; the usage row is the only record of "out". We show
  //      these with quantity (use_number_on_item) and size (parsed from item).
  const myOpen = useMemo(()=>{
    return usage
      .filter(u => u.instructor === currentUser.name && u.signed_in_out === "OUT" && !u.time_in && u.gear_id)
      .map(u => ({u, g: gear.find(g => g.gear_id === u.gear_id)}))
      .filter(x => x.g);  // skip orphans
  }, [usage, gear, currentUser]);

  const individuals = myOpen.filter(x => !x.g.is_pool_bucket && x.g.signed_in_out === "OUT");
  const buckets     = myOpen.filter(x =>  x.g.is_pool_bucket);

  const total = individuals.length + buckets.reduce((a,b)=>a+(Number(b.u.use_number_on_item)||1), 0);

  return <div style={{padding:24,maxWidth:520,margin:"0 auto"}}>
    <button onClick={onBack} style={{background:"none",border:"none",color:T.muted,fontSize:14,marginBottom:20}}>← Back</button>
    <div style={{textAlign:"center",marginBottom:18}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:T.white}}>My Signed-Out Gear</div></div>
    {individuals.length===0 && buckets.length===0
      ? <Card><p style={{color:T.muted,fontSize:14,textAlign:"center",padding:18}}>✅ All clear. Nothing outstanding.</p></Card>
      : (
      <div>
        {individuals.length>0 && (
          <Btn onClick={()=>onSignAll(individuals)} color="#27ae60" style={{width:"100%",marginBottom:12}}>
            ✅ Sign All {individuals.length} Individual Item{individuals.length!==1?"s":""} Back In
          </Btn>
        )}

        {/* Individual items */}
        {individuals.map(({u,g})=>(
          <Card key={u.usage_id} style={{padding:13,marginBottom:9}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:T.white}}>{g.item}</div>
                <div style={{fontSize:12,color:T.muted,marginTop:2}}>#{g.gear_id} · {g.location}</div>
                <div style={{fontSize:11,color:T.muted}}>Out since {fmtDT(u.time_out)}</div>
              </div>
              <SBadge status={g.status} small/>
            </div>
            <div style={{display:"flex",gap:7}}>
              <Btn small color="#27ae60" onClick={()=>onSignIn(g)} style={{flex:1}}>Sign In</Btn>
              <Btn small outline color="#e67e22" onClick={()=>onReport(g)} style={{flex:1}}>Report</Btn>
            </div>
          </Card>
        ))}

        {/* Bucket sign-outs */}
        {buckets.length>0 && (
          <div style={{marginTop:individuals.length>0?14:0}}>
            {individuals.length>0 && <div style={{fontSize:11,color:T.muted,textTransform:"uppercase",letterSpacing:0.6,marginBottom:6}}>Pool / sized items</div>}
            {buckets.map(({u,g})=>{
              const qty = Number(u.use_number_on_item)||1;
              return (
                <Card key={u.usage_id} style={{padding:13,marginBottom:9,borderColor:"rgba(232,98,26,0.3)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:600,color:T.white}}>{u.item}</div>
                      <div style={{fontSize:12,color:T.muted,marginTop:2}}>{qty} item{qty!==1?"s":""} from pool · size {g.size||"?"}</div>
                      <div style={{fontSize:11,color:T.muted}}>Out since {fmtDT(u.time_out)}</div>
                    </div>
                    <span style={{fontSize:18,fontWeight:800,color:T.accent}}>{qty}</span>
                  </div>
                  <div style={{display:"flex",gap:7}}>
                    <Btn small color="#27ae60" onClick={()=>onBucketSignIn(u, g, qty)} style={{flex:1}}>Sign {qty} Back In</Btn>
                    <Btn small outline color="#e67e22" onClick={()=>onBucketReport(u, g, qty)} style={{flex:1}}>Damaged / Lost</Btn>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    )}
  </div>;
}

// ═══ MANAGER — OVERVIEW ═══════════════════════════════════════════════════════
function OverviewTab({gear,cats,reports,openDetail,onOpenGearFiltered}){
  const sc={Red:0,Orange:0,Yellow:0,YellowRepair:0,Green:0};gear.forEach(g=>{if(sc[g.status]!=null)sc[g.status]++;});
  const fp=calcFuturePurchases(cats,gear);const recent=[...reports].filter(r=>!r.resolved).sort((a,b)=>new Date(b.time_reported)-new Date(a.time_reported)).slice(0,5);
  const tiles=[["Total",gear.length,"#7ab0ff",null],["Out",gear.filter(g=>g.signed_in_out==="OUT").length,T.accent,"OUT"],["Red",sc.Red,"#c0392b","Red"],["Orange",sc.Orange,"#e67e22","Orange"],["Yellow",sc.Yellow,"#c9a800","Yellow"],["Repair",sc.YellowRepair,"#9b7c0c","YellowRepair"],["Green",sc.Green,"#27ae60","Green"]];
  return <div>
    <PT title="Dashboard" sub="Tap any status tile to open Gear List filtered to that status"/>
    <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
      {tiles.map(([l,v,c,fv])=>(
        <div key={l} onClick={()=>fv&&onOpenGearFiltered&&onOpenGearFiltered(fv)}
          style={{background:T.card,border:"1px solid "+(fv?T.border:T.border),borderRadius:12,padding:"10px 16px",minWidth:90,cursor:fv?"pointer":"default",transition:"background .12s"}}
          onMouseEnter={e=>{if(fv)e.currentTarget.style.background="rgba(255,255,255,0.09)";}}
          onMouseLeave={e=>{e.currentTarget.style.background=T.card;}}>
          <div style={{fontSize:22,fontWeight:700,color:c}}>{v}</div>
          <div style={{fontSize:12,color:T.muted,marginTop:2}}>{l}</div>
        </div>
      ))}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:14}}>
      <Card>
        <p style={{fontSize:15,fontWeight:600,color:T.white,marginBottom:12}}>Status Breakdown</p>
        <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
          <DonutChart data={sc}/>
          <div style={{flex:1,minWidth:160}}>
            {["Red","Orange","Yellow","YellowRepair","Green"].map(s=>(<div key={s} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0"}}><div style={{width:9,height:9,borderRadius:"50%",background:SC[s].bg,flexShrink:0}}/><span style={{flex:1,fontSize:13,color:T.white}}>{s==="YellowRepair"?"Yellow Repair":s}</span><span style={{fontSize:13,fontWeight:700,color:T.white}}>{sc[s]}</span></div>))}
          </div>
        </div>
      </Card>
      <Card>
        <p style={{fontSize:15,fontWeight:600,color:T.white,marginBottom:10}}>Upcoming Purchases</p>
        {fp.slice(0,5).map(c=>(
          <div key={c.cat_id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,color:T.white}}>{c.name}</div><div style={{fontSize:11,color:T.muted}}>{c.red} Red · {c.orange} Orange · {c.yellow} Yellow</div></div>
            <span style={{fontSize:11,fontWeight:700,color:c.priority===1?"#ff8a7a":c.priority===2?T.accent:c.priority===3?"#c9a800":T.muted}}>{["","CRITICAL","HIGH","MEDIUM","LOW"][c.priority]}</span>
          </div>
        ))}
        {fp.length===0&&<p style={{fontSize:13,color:T.muted,padding:6}}>No categories above 10% ROY.</p>}
      </Card>
    </div>
    <Card style={{marginTop:14}}>
      <p style={{fontSize:15,fontWeight:600,color:T.white,marginBottom:10}}>Recent Reports</p>
      {recent.map(r=>(
        <div key={r.report_id} className="cl" onClick={()=>openDetail("report",r)} style={{display:"flex",alignItems:"flex-start",gap:9,padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <SBadge status={r.status} small/>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,color:T.white}}>{r.item}<span style={{fontSize:12,color:T.muted}}> · {r.instructor}</span></div><div style={{fontSize:12,color:T.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.notes}</div></div>
          <div style={{fontSize:11,color:T.muted,whiteSpace:"nowrap"}}>{new Date(r.time_reported).toLocaleDateString("en-NZ",{day:"numeric",month:"short"})}</div>
        </div>
      ))}
    </Card>
  </div>;
}

// ═══ MANAGER — GEAR LIST ══════════════════════════════════════════════════════
function GearListTab({gear,setGear,cats,types,openDetail,showToast,initialFilter}){
  const [q,setQ]=useState("");
  const [bfilt,setBfilt]=useState("all");
  const [sfilt,setSfilt]=useState(initialFilter||"all");
  const [editG,setEditG]=useState(null);
  const [gScanField,setGScanField]=useState(null);

  useEffect(()=>{if(initialFilter)setSfilt(initialFilter);},[initialFilter]);

  const filtered=useMemo(()=>{
    let r=gear;
    if(bfilt!=="all")r=r.filter(g=>behaviourOf(g,cats)===bfilt);
    if(sfilt!=="all")r=r.filter(g=>sfilt==="OUT"?g.signed_in_out==="OUT":g.status===sfilt);
    return sq(r,q,["item","gear_id","physical_serial","location","status","notes","nfc_tag","qr_code"]);
  },[gear,cats,q,bfilt,sfilt]);

  async function saveGear(updated){
    const patched={...updated,status:calcStatus(updated)};
    setGear(g=>g.map(x=>x.gear_id===patched.gear_id?patched:x));
    if(hasSupabase()){
      // Only send writable fields. Avoid sending `created_at`, derived fields,
      // or constraint-coupled pool-bucket columns when they didn't change.
      const dbPatch = {
        item: patched.item,
        category_id: patched.category_id || null,
        status: patched.status,
        expiry: patched.expiry || null,
        number_of_uses: patched.number_of_uses ?? 0,
        usage_limit: patched.usage_limit || null,
        signed_in_out: patched.signed_in_out || "IN",
        notes: patched.notes || "",
        location: patched.location || null,
        physical_serial: patched.physical_serial || null,
        size: patched.size || null,
        nfc_tag: patched.nfc_tag || null,
        qr_code: patched.qr_code || null,
      };
      const r = await sbUpdate("gear",{gear_id:patched.gear_id},dbPatch);
      if(!r){showToast("❌ DB rejected the update — see console");return;}
    }
    showToast("✅ Gear updated");setEditG(null);
  }

  return <div>
    {gScanField==="qr"&&<ScannerOverlay title="Scan QR Code" hint="Point camera at QR label to assign" onResult={raw=>{setEditG(g=>({...g,qr_code:raw.trim()}));setGScanField(null);}} onClose={()=>setGScanField(null)}/>}
    {gScanField==="nfc"&&<NFCOverlay title="Scan NFC Tag" hint="Hold device near NFC sticker to assign" onResult={raw=>{setEditG(g=>({...g,nfc_tag:raw.trim()}));setGScanField(null);}} onClose={()=>setGScanField(null)} onSwitchToQR={()=>setGScanField("qr")}/>}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:10}}>
      <PT title="Gear List" sub={gear.length+" items · "+filtered.length+" shown — tap Edit on any row"}/>
      <Btn small color="#27ae60" onClick={()=>dlCSV("GearList",gear)}>⬇ Export CSV</Btn>
    </div>
    <div style={{display:"flex",gap:5,marginBottom:7,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:11,color:T.muted}}>Behaviour:</span>
      {["all","signable","sized_pool","monitored_only","fuel","catalogue"].map(b=>(
        <button key={b} onClick={()=>setBfilt(b)} style={{background:bfilt===b?T.accent:"rgba(255,255,255,0.06)",border:"none",color:"#fff",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:bfilt===b?700:400,cursor:"pointer"}}>{b==="all"?"All":BHC[b]?.label||b}</button>
      ))}
    </div>
    <div style={{display:"flex",gap:5,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:11,color:T.muted}}>Status:</span>
      {["all","Green","Yellow","Orange","Red","YellowRepair","OUT"].map(s=>(
        <button key={s} onClick={()=>setSfilt(s)} style={{background:sfilt===s?(SC[s]?.bg||T.accent):"rgba(255,255,255,0.06)",border:"none",color:"#fff",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:sfilt===s?700:400,cursor:"pointer"}}>{s}</button>
      ))}
    </div>
    <SBar value={q} onChange={setQ} ph="Search name, ID, serial, location, NFC, QR…"/>
    <Card><div className="sx"><table>
      <thead><tr><th>ID</th><th>Serial</th><th>Item</th><th>Category</th><th>Status</th><th>Location</th><th>Uses</th><th>Expiry</th><th>State</th><th>QR/NFC</th><th>Edit</th></tr></thead>
      <tbody>{filtered.map(g=>{
        const cat=(cats||[]).find(c=>c.cat_id===g.category_id);
        return (
        <tr key={g.gear_id}>
          <td style={{color:T.muted,fontSize:12}}>{g.gear_id}</td>
          <td style={{color:T.muted,fontFamily:"monospace",fontSize:11}}>{g.physical_serial||"—"}</td>
          <td style={{fontWeight:500,cursor:"pointer"}} onClick={()=>openDetail("gear",g)}>{g.item}</td>
          <td style={{fontSize:12,color:cat?T.text:"#ff8a7a"}}>{cat?cat.name:(g.category_id?<span title={"Unknown category: "+g.category_id} style={{color:"#ff8a7a"}}>⚠ {g.category_id}</span>:"—")}</td>
          <td><SBadge status={g.status} small/></td>
          <td style={{color:T.muted,fontSize:13}}>{g.location||"—"}</td>
          <td style={{fontSize:13}}>{g.usage_limit?g.number_of_uses+"/"+g.usage_limit:"—"}</td>
          <td style={{fontSize:12,color:T.muted,whiteSpace:"nowrap"}}>{fmtD(g.expiry)}</td>
          <td><span style={{fontSize:12,color:g.signed_in_out==="OUT"?T.accent:"#27ae60",fontWeight:600}}>{g.signed_in_out}</span></td>
          <td style={{fontSize:11,color:g.qr_code||g.nfc_tag?"#27ae60":T.muted}}>{g.qr_code||g.nfc_tag?"✅":"—"}</td>
          <td><button onClick={()=>setEditG({...g})} style={{background:"rgba(255,255,255,0.07)",border:"1px solid "+T.border,color:T.text,borderRadius:6,padding:"3px 9px",fontSize:11,cursor:"pointer"}}>Edit</button></td>
        </tr>
      );})}</tbody>
    </table></div></Card>

    {editG&&<Mdl onClose={()=>setEditG(null)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>Edit Gear — #{editG.gear_id}</div>
        <button onClick={()=>setEditG(null)} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button>
      </div>
      <FL>Item Name</FL><input id="editg-item" name="item" value={editG.item||""} onChange={e=>setEditG(g=>({...g,item:e.target.value}))}/>
      <FL>Category</FL>
      <select id="editg-cat" name="category_id" value={editG.category_id||""} onChange={e=>setEditG(g=>({...g,category_id:e.target.value||null}))}>
        <option value="">— none —</option>
        {[...(cats||[])].sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(c=>(
          <option key={c.cat_id} value={c.cat_id}>{c.name} · {c.behaviour}</option>
        ))}
      </select>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
        <div><FL>Location</FL><input id="editg-loc" name="location" value={editG.location||""} onChange={e=>setEditG(g=>({...g,location:e.target.value}))}/></div>
        <div><FL>Physical Serial</FL><input name="physical_serial" value={editG.physical_serial||""} onChange={e=>setEditG(g=>({...g,physical_serial:e.target.value}))}/></div>
        <div><FL>Expiry</FL><input type="date" name="expiry" value={editG.expiry||""} onChange={e=>setEditG(g=>({...g,expiry:e.target.value}))}/></div>
        <div><FL>Usage Limit</FL><input type="number" name="usage_limit" value={editG.usage_limit||""} onChange={e=>setEditG(g=>({...g,usage_limit:Number(e.target.value)}))}/></div>
        <div><FL>Current Uses</FL><input type="number" name="number_of_uses" value={editG.number_of_uses||0} onChange={e=>setEditG(g=>({...g,number_of_uses:Number(e.target.value)}))}/></div>
        <div><FL>Status</FL><select name="status" value={editG.status||"Green"} onChange={e=>setEditG(g=>({...g,status:e.target.value}))}>{["Green","Yellow","Orange","Red","YellowRepair"].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
        <div><FL>Signed</FL><select name="signed_in_out" value={editG.signed_in_out||"IN"} onChange={e=>setEditG(g=>({...g,signed_in_out:e.target.value}))}><option value="IN">IN</option><option value="OUT">OUT</option></select></div>
      </div>
      <FL>QR Code</FL>
      <div style={{display:"flex",gap:6,marginBottom:4}}>
        <input value={editG.qr_code||""} onChange={e=>setEditG(g=>({...g,qr_code:e.target.value}))} placeholder="Leave blank = auto-generated" style={{flex:1}}/>
        <button type="button" onClick={()=>setGScanField("qr")} style={{background:"rgba(39,174,96,0.15)",border:"1px solid rgba(39,174,96,0.4)",color:"#27ae60",borderRadius:8,padding:"8px 11px",fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>📷 Scan</button>
      </div>
      <FL>NFC Tag</FL>
      <div style={{display:"flex",gap:6}}>
        <input value={editG.nfc_tag||""} onChange={e=>setEditG(g=>({...g,nfc_tag:e.target.value}))} placeholder="Leave blank = auto-generated" style={{flex:1}}/>
        <button type="button" onClick={()=>setGScanField("nfc")} style={{background:"rgba(74,128,200,0.15)",border:"1px solid rgba(74,128,200,0.4)",color:"#7ab0ff",borderRadius:8,padding:"8px 11px",fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>📡 NFC</button>
      </div>
      <FL>Notes</FL><textarea rows={2} value={editG.notes||""} onChange={e=>setEditG(g=>({...g,notes:e.target.value}))}/>
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn onClick={()=>saveGear(editG)} color={T.accent}>Save Changes</Btn>
        <Btn onClick={()=>setEditG(null)} outline color={T.muted}>Cancel</Btn>
      </div>
    </Mdl>}
  </div>;
}

// ═══ MANAGER — ADD GEAR ═══════════════════════════════════════════════════════
function GearEntry({types,cats,locations,gear,onAdd,showToast,prefilledTypeId,onPrefillConsumed}){
  const [mode,setMode]=useState("batch");

  // If a type was prefilled from SizedPool quick-add, switch to batch and set it
  const [selectedTypeId,setSelectedTypeId]=useState("");
  const [qty,setQty]=useState(1);
  const [serialPrefix,setSerialPrefix]=useState("");
  const [serialStart,setSerialStart]=useState(1);
  const [qrPrefix,setQrPrefix]=useState("");
  const [nfcPrefix,setNfcPrefix]=useState("");
  const [location,setLocation]=useState("");
  const [expiry,setExpiry]=useState("");
  const [notes,setNotes]=useState("");
  const [sizeDistribution,setSizeDistribution]=useState({});
  const [preview,setPreview]=useState(null);
  const selType=types.find(t=>t.type_id===selectedTypeId||t.cat_id===selectedTypeId);

  // Single-entry state
  const [single,setSingle]=useState({item:"",category_id:"",physical_serial:"",location:"",size:"",expiry:"",usage_limit:"",notes:"",nfc_tag:"",qr_code:""});
  const [cloneQ,setCloneQ]=useState("");
  const [showClone,setShowClone]=useState(false);
  const [scanTarget,setScanTarget]=useState(null); // null | 'nfc_tag' | 'qr_code'

  // Respond to prefill from sized pool quick-add
  if(prefilledTypeId && prefilledTypeId !== selectedTypeId){
    onTypeChange(prefilledTypeId);
    if(onPrefillConsumed) onPrefillConsumed();
  }

  function onTypeChange(v){
    setSelectedTypeId(v);
    const t=types.find(x=>x.cat_id===v||x.type_id===v);
    if(t){
      setLocation(t.home_location||"");
      const cleaned=t.name.replace(/[()]/g,"").split(/\s+/).map(w=>w.charAt(0).toUpperCase()).join("").slice(0,3);
      setSerialPrefix(cleaned||"GEAR");
      setQrPrefix("QR-"+cleaned);
      setNfcPrefix("NFC-"+cleaned);
      const existing=gear.filter(g=>g.category_id===v).map(g=>{const m=(g.physical_serial||"").match(/(\d+)$/);return m?parseInt(m[1]):0;});
      setSerialStart(existing.length>0?Math.max(...existing)+1:1);
      if(t.behaviour==="sized_pool"&&t.sizes&&t.sizes.length>0){
        const d={};t.sizes.forEach(s=>d[s]=0);setSizeDistribution(d);
      } else setSizeDistribution({});
      if(t.expiry_months){
        const d=new Date();d.setMonth(d.getMonth()+t.expiry_months);
        setExpiry(d.toISOString().slice(0,10));
      } else setExpiry("");
    } else {
      setSerialPrefix("");setQrPrefix("");setNfcPrefix("");
    }
    setPreview(null);
  }

  function buildPreview(){
    if(!selType){showToast("⚠ Pick a kind of gear first");return;}
    if(!location){showToast("⚠ Pick a location");return;}
    const isSized = selType.behaviour==="sized_pool";
    const isBucket= isSized && selType.sized_pool_style==="bucket";
    const isIndiv = isSized && selType.sized_pool_style!=="bucket"; // default individual
    if(isSized && (!selType.sizes || selType.sizes.length===0)){
      showToast("⚠ This sized-pool category has no sizes yet — add the first item with a size in Single mode, then come back");return;
    }
    const totalSized = isSized ? Object.values(sizeDistribution).reduce((a,b)=>a+b,0) : qty;
    if(isSized && totalSized===0){showToast("⚠ Set at least one size quantity");return;}

    const items=[];
    let serialN=serialStart;
    const maxId=gear.reduce((m,g)=>Math.max(m,g.gear_id||0),1000);
    let nextId=maxId+1;

    if(isBucket){
      // ── BUCKET STYLE ── one row per non-zero size, with pool_count/capacity.
      // The "qty" here is interpreted as both initial count AND capacity.
      // Edit later in the Sized Pool tab to change capacity vs count separately.
      Object.entries(sizeDistribution).forEach(([s,n])=>{
        if(n<=0) return;
        const id = nextId++;
        items.push({
          gear_id:id, physical_serial:"",
          item: selType.name+" — "+s,
          category_id: selType.cat_id,
          status:"Green",
          expiry: expiry||null,
          number_of_uses:0, usage_limit:null,
          signed_in_out:"IN",
          location, size:s,
          nfc_tag: nfcPrefix?nfcPrefix+"-"+s:"",
          qr_code:  qrPrefix?qrPrefix+"-"+s:"",
          notes,
          is_pool_bucket:true, pool_count:n, pool_capacity:n,
          set_size:null,
        });
      });
    } else {
      // ── INDIVIDUAL STYLE ── one row per physical item.
      const sizeRows=[];
      if(isIndiv){
        selType.sizes.forEach(s=>{ for(let i=0;i<(sizeDistribution[s]||0);i++) sizeRows.push(s); });
      } else {
        for(let i=0;i<qty;i++) sizeRows.push(null);
      }
      sizeRows.forEach(size=>{
        const id=nextId++;
        const serial=serialPrefix?serialPrefix+"-"+String(serialN).padStart(3,"0"):"";
        const qr=(qrPrefix||"QR")+"-"+String(serialN).padStart(3,"0");
        const nfc=(nfcPrefix||"NFC")+"-"+String(serialN).padStart(3,"0");
        serialN++;
        items.push({
          gear_id:id, physical_serial:serial,
          item: selType.name+(size?" ("+size+")":""),
          category_id: selType.cat_id,
          status: "Green",
          expiry: expiry||null,
          number_of_uses:0,
          usage_limit: selType.usage_limit||null,
          signed_in_out: selType.behaviour==="monitored_only" ? "IN" : "IN",
          location, size,
          nfc_tag:nfc, qr_code:qr, notes,
          is_pool_bucket:false, pool_count:null, pool_capacity:null,
          set_size:null,
        });
      });
    }
    setPreview(items);
  }

  function commit(){
    if(!preview||preview.length===0)return;
    onAdd(preview);
    showToast("✅ Added "+preview.length+" item"+(preview.length!==1?"s":"")+" to inventory");
    setPreview(null);setQty(1);setSizeDistribution({});setNotes("");
  }

  function adjSize(s,d){setSizeDistribution(q=>({...q,[s]:Math.max(0,(q[s]||0)+d)}));}

  // ── Single mode handlers ─────────────────────────────────────────────────
  function updSingle(k,v){setSingle(s=>({...s,[k]:v}));}
  function applyClone(src){
    setSingle({
      item:src.item,category_id:src.category_id||"",
      physical_serial:"",location:src.location||"",size:src.size||"",
      expiry:src.expiry||"",usage_limit:src.usage_limit||"",notes:"",
      nfc_tag:"",qr_code:"",
    });
    setShowClone(false);
    showToast("📋 Cloned from "+src.item+" #"+src.gear_id);
  }
  function onSingleTypeChange(v){
    updSingle("category_id",v);
    const t=types.find(x=>x.type_id===v||x.cat_id===v);
    if(t){
      updSingle("item",t.name);
      updSingle("location",t.home_location||"");
      updSingle("usage_limit",t.usage_limit||"");
      if(t.behaviour!=="sized_pool"&&t.category_id) updSingle("category_id",t.category_id);
      if(t.expiry_months){
        const d=new Date();d.setMonth(d.getMonth()+t.expiry_months);
        updSingle("expiry",d.toISOString().slice(0,10));
      }
    }
  }
  function submitSingle(){
    if(!single.item.trim()||!single.location){showToast("⚠ Fill item name and location");return;}
    if(single.physical_serial&&gear.find(g=>g.physical_serial===single.physical_serial)){showToast("⚠ Serial already in use");return;}
    if(single.nfc_tag&&gear.find(g=>g.nfc_tag===single.nfc_tag)){showToast("⚠ NFC tag already in use");return;}
    if(single.qr_code&&gear.find(g=>g.qr_code===single.qr_code)){showToast("⚠ QR code already in use");return;}
    const cat = cats.find(c=>c.cat_id===single.category_id);
    const isBucketCat = cat && cat.behaviour==="sized_pool" && cat.sized_pool_style==="bucket";
    if(isBucketCat){
      if(!single.size){showToast("⚠ Bucket-style sized pool needs a size");return;}
      if(gear.find(g=>g.category_id===cat.cat_id && g.size===single.size && g.is_pool_bucket)){
        showToast(`⚠ A bucket for size ${single.size} already exists — edit it in Sized Pool tab`);return;
      }
    }
    const maxId=gear.reduce((m,g)=>Math.max(m,g.gear_id||0),1000);
    const id=maxId+1;
    const newItem={
      gear_id:id,
      physical_serial:single.physical_serial||"",
      item:single.item.trim(),
      category_id:single.category_id||null,
      status:"Green",
      expiry:single.expiry||null,
      number_of_uses:0,
      usage_limit:single.usage_limit?Number(single.usage_limit):null,
      signed_in_out:"IN",
      location:single.location,
      size:single.size||null,
      nfc_tag: single.nfc_tag || (isBucketCat?null:"NFC"+id),
      qr_code:  single.qr_code || (isBucketCat?null:"QR"+id),
      notes:single.notes||"",
      // Hybrid pool model: if this is a bucket cat, default count=1, capacity=1.
      // The user can grow the bucket from the Sized Pool tab afterwards.
      is_pool_bucket: !!isBucketCat,
      pool_count:    isBucketCat ? 1 : null,
      pool_capacity: isBucketCat ? 1 : null,
      set_size: null,
    };
    newItem.status=calcStatus(newItem);
    onAdd([newItem]);
    showToast("✅ "+newItem.item+" added"+(isBucketCat?" (bucket — grow it in Sized Pool tab)":""));
    setSingle({item:"",category_id:"",physical_serial:"",location:"",size:"",expiry:"",usage_limit:"",notes:"",nfc_tag:"",qr_code:""});
  }

  const singleType=types.find(t=>t.cat_id===single.category_id);
  const isSized=selType&&selType.behaviour==="sized_pool";
  const totalSized=isSized?Object.values(sizeDistribution).reduce((a,b)=>a+b,0):qty;
  const cloneResults=useMemo(()=>sq(gear,cloneQ,["item","gear_id","physical_serial","location"]),[gear,cloneQ]);
  const activeTypes=types.filter(t=>t.active!==false);
  const activeCats=cats.filter(c=>c.active!==false);

  function handleAddGearScan(raw){
    const cleaned = raw.trim();
    if(scanTarget==="nfc_tag") updSingle("nfc_tag", cleaned);
    if(scanTarget==="qr_code") updSingle("qr_code", cleaned);
    setScanTarget(null);
  }

  return <div>
    {scanTarget==="nfc_tag"&&<NFCOverlay title="Scan NFC Tag" hint="Hold device near the NFC sticker to assign it to this item" onResult={handleAddGearScan} onClose={()=>setScanTarget(null)}/>}
    {scanTarget==="qr_code"&&<ScannerOverlay title="Scan QR Code" hint="Point camera at the QR label to assign it to this item" onResult={handleAddGearScan} onClose={()=>setScanTarget(null)}/>}
    <PT title="Add Gear" sub={mode==="batch"?"Batch mode — pick a kind, set quantity, system generates IDs, serials, QR codes":"Single mode — add one item with full control or clone from existing"}/>

    <div style={{display:"flex",gap:0,background:"rgba(255,255,255,0.04)",borderRadius:10,padding:3,marginBottom:16,maxWidth:360}}>
      {["batch","single"].map(m=>(
        <button key={m} onClick={()=>setMode(m)} style={{flex:1,background:mode===m?"rgba(232,98,26,0.2)":"transparent",border:mode===m?"1px solid "+T.accent:"1px solid transparent",color:mode===m?T.white:T.muted,borderRadius:8,padding:"8px 0",fontSize:13,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>
          {m==="batch"?"📦 Batch":"➕ Single"}
        </button>
      ))}
    </div>

    {mode==="batch" && !preview && (
      <Card>
        <FL>Kind of gear</FL>
        <select value={selectedTypeId} onChange={e=>onTypeChange(e.target.value)}>
          <option value="">— select a kind —</option>
          {activeTypes.map(t=><option key={t.cat_id} value={t.cat_id}>{t.name} ({t.behaviour})</option>)}
        </select>
        {selType&&(
          <div style={{background:"rgba(232,98,26,0.06)",border:"1px solid rgba(232,98,26,0.2)",borderRadius:8,padding:"9px 12px",marginTop:10,fontSize:12,color:T.muted,lineHeight:1.6}}>
            <strong style={{color:T.white}}>{selType.name}</strong> · <BhBadge behaviour={selType.behaviour} small/>{selType.usage_limit?" · "+selType.usage_limit+" uses":""}{selType.expiry_months?" · "+selType.expiry_months+"mo expiry":""}{selType.life_safety?" · life safety":""}
            <div style={{marginTop:4}}>Category: {isSized?"auto per size":cats.find(c=>c.cat_id===selType.category_id)?.name||"—"}</div>
          </div>
        )}
        {selType&&!isSized&&(<><FL>How many?</FL><input type="number" min={1} max={500} value={qty} onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))}/></>)}
        {selType&&isSized&&(
          <>
            <FL>Size distribution {selType.sized_pool_style==="bucket"?"(stock per size — bucket style)":"(individual items per size)"}</FL>
            {(!selType.sizes||selType.sizes.length===0) ? (
              <div style={{background:"rgba(232,98,26,0.08)",border:"1px solid rgba(232,98,26,0.3)",borderRadius:8,padding:12,fontSize:13,color:"#ffcc99",lineHeight:1.6}}>
                No sizes defined yet for this category. Switch to <strong>Single mode</strong> above and add the first item with a size — sizes auto-populate from existing stock.
              </div>
            ) : (
              <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid "+T.border,borderRadius:8,padding:12}}>
                {selType.sizes.map(s=>(
                  <div key={s} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                    <div style={{flex:1,fontSize:14,color:T.white,fontWeight:500}}>Size {s}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <button onClick={()=>adjSize(s,-1)} disabled={(sizeDistribution[s]||0)===0} style={{width:30,height:30,borderRadius:"50%",background:(sizeDistribution[s]||0)===0?"rgba(255,255,255,0.05)":T.g2,border:"none",color:(sizeDistribution[s]||0)===0?T.muted:"#fff",fontSize:15,fontWeight:700}}>−</button>
                      <div style={{width:34,textAlign:"center",fontSize:15,fontWeight:700,color:(sizeDistribution[s]||0)>0?T.accent:T.muted}}>{sizeDistribution[s]||0}</div>
                      <button onClick={()=>adjSize(s,1)} style={{width:30,height:30,borderRadius:"50%",background:T.accent,border:"none",color:"#fff",fontSize:15,fontWeight:700}}>+</button>
                    </div>
                  </div>
                ))}
                <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 0",borderTop:"1px solid rgba(255,255,255,0.06)",marginTop:6,fontSize:13}}>
                  <span style={{color:T.muted}}>Total</span><span style={{color:T.white,fontWeight:700}}>{totalSized}</span>
                </div>
              </div>
            )}
          </>
        )}
        {selType&&(<>
          <FL>Location</FL>
          <select value={location} onChange={e=>setLocation(e.target.value)}>
            <option value="">— select —</option>
            {locations.filter(l=>l.active).map(l=><option key={l.loc_id} value={l.name}>{l.name}</option>)}
          </select>
          <FL>Expiry (optional)</FL>
          <input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/>
          <Divider/>
          <p style={{fontSize:13,fontWeight:600,color:T.white,marginBottom:8}}>Auto-generated codes</p>
          <p style={{fontSize:12,color:T.muted,marginBottom:10,lineHeight:1.6}}>Prefixes fill from the kind of gear. Edit if you want. System numbers them sequentially.</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"0 10px"}}>
            <div><FL>Serial prefix</FL><input value={serialPrefix} onChange={e=>setSerialPrefix(e.target.value.toUpperCase())} placeholder="HEL"/></div>
            <div><FL>Start #</FL><input type="number" min={1} value={serialStart} onChange={e=>setSerialStart(Math.max(1,parseInt(e.target.value)||1))}/></div>
            <div><FL>QR prefix</FL><input value={qrPrefix} onChange={e=>setQrPrefix(e.target.value)} placeholder="QR-HEL"/></div>
            <div><FL>NFC prefix</FL><input value={nfcPrefix} onChange={e=>setNfcPrefix(e.target.value)} placeholder="NFC-HEL"/></div>
          </div>
          <div style={{fontSize:11,color:T.muted,marginTop:6,lineHeight:1.6}}>Sample: serial <strong style={{color:T.white}}>{(serialPrefix||"GEAR")+"-"+String(serialStart).padStart(3,"0")}</strong> · QR <strong style={{color:T.white}}>{(qrPrefix||"QR")+"-"+String(serialStart).padStart(3,"0")}</strong> · NFC <strong style={{color:T.white}}>{(nfcPrefix||"NFC")+"-"+String(serialStart).padStart(3,"0")}</strong></div>
          <FL>Notes (applied to all)</FL>
          <textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional"/>
          <div style={{marginTop:14}}>
            <Btn onClick={buildPreview} color={T.accent} style={{width:"100%"}}>
              Preview {isSized?totalSized:qty} new item{(isSized?totalSized:qty)!==1?"s":""}
            </Btn>
          </div>
        </>)}
      </Card>
    )}

    {mode==="batch" && preview && (
      <>
        <Card style={{marginBottom:12,border:"1px solid rgba(39,174,96,0.3)",background:"rgba(39,174,96,0.05)"}}>
          <p style={{fontSize:15,fontWeight:600,color:"#7adf9a",marginBottom:6}}>Ready to add {preview.length} item{preview.length!==1?"s":""}</p>
          <p style={{fontSize:12,color:T.muted,lineHeight:1.6}}>Review the auto-generated IDs. Click Commit to add them all, then print QR labels and attach them.</p>
        </Card>
        <Card style={{marginBottom:12}}>
          <div className="sx"><table>
            <thead><tr><th>Gear ID</th><th>Item</th><th>Serial</th><th>QR</th><th>NFC</th><th>Size</th><th>Location</th></tr></thead>
            <tbody>{preview.map(g=>(
              <tr key={g.gear_id}>
                <td style={{color:T.muted}}>{g.gear_id}</td>
                <td style={{fontWeight:500}}>{g.item}</td>
                <td style={{color:T.white,fontFamily:"monospace",fontSize:12}}>{g.physical_serial}</td>
                <td style={{color:T.muted,fontFamily:"monospace",fontSize:12}}>{g.qr_code}</td>
                <td style={{color:T.muted,fontFamily:"monospace",fontSize:12}}>{g.nfc_tag}</td>
                <td style={{color:T.muted}}>{g.size||"—"}</td>
                <td style={{color:T.muted,fontSize:13}}>{g.location}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
        <div style={{display:"flex",gap:10}}>
          <Btn onClick={commit} color="#27ae60" style={{flex:1}}>✅ Commit — add {preview.length} to inventory</Btn>
          <Btn onClick={()=>setPreview(null)} outline color={T.muted}>Back to edit</Btn>
        </div>
      </>
    )}

    {mode==="single" && (
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <p style={{fontSize:14,fontWeight:600,color:T.white}}>Add one item</p>
          <Btn small outline color="#7ab0ff" onClick={()=>setShowClone(s=>!s)}>{showClone?"Close picker":"📋 Clone from existing"}</Btn>
        </div>
        {showClone && (
          <div style={{background:"rgba(74,128,200,0.06)",border:"1px solid rgba(74,128,200,0.22)",borderRadius:8,padding:10,marginBottom:12}}>
            <p style={{fontSize:12,color:"#7ab0ff",marginBottom:8,lineHeight:1.5}}>Pick any existing gear row to pre-fill the form. Serial, NFC, and QR stay blank for you to enter.</p>
            <input placeholder="🔍 Search by name, ID, serial, location…" value={cloneQ} onChange={e=>setCloneQ(e.target.value)} style={{marginBottom:8}}/>
            <div style={{maxHeight:160,overflowY:"auto"}}>
              {cloneResults.slice(0,15).map(g=>(
                <div key={g.gear_id} className="cl" onClick={()=>applyClone(g)} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",borderRadius:4}}>
                  <SBadge status={g.status} small/>
                  <span style={{fontSize:13,color:T.white,flex:1}}>{g.item} #{g.gear_id}{g.physical_serial?" · "+g.physical_serial:""}</span>
                  <span style={{fontSize:11,color:"#7ab0ff"}}>Use →</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <FL>Kind of gear (optional — pre-fills defaults)</FL>
        <select value={single.category_id} onChange={e=>onSingleTypeChange(e.target.value)}>
          <option value="">— none —</option>
          {activeTypes.map(t=><option key={t.cat_id} value={t.cat_id}>{t.name} ({t.behaviour})</option>)}
        </select>
        <FL>Item Name</FL>
        <input value={single.item} onChange={e=>updSingle("item",e.target.value)} placeholder="e.g. Long Dynamic Rope 5"/>
        <FL>Physical Serial (your existing code, e.g. LD05)</FL>
        <input value={single.physical_serial} onChange={e=>updSingle("physical_serial",e.target.value)} placeholder="Optional — must be unique"/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
          <div><FL>Category</FL>
            <select value={single.category_id} onChange={e=>updSingle("category_id",e.target.value)} disabled={singleType?.behaviour==="sized_pool"&&!single.size}>
              <option value="">— none —</option>
              {activeCats.map(c=><option key={c.cat_id} value={c.cat_id}>{c.name}</option>)}
            </select>
          </div>
          <div><FL>Location</FL>
            <select value={single.location} onChange={e=>updSingle("location",e.target.value)}>
              <option value="">— select —</option>
              {locations.filter(l=>l.active).map(l=><option key={l.loc_id} value={l.name}>{l.name}</option>)}
            </select>
          </div>
          {singleType?.behaviour==="sized_pool"&&(
            <div><FL>Size</FL>
              <select value={single.size} onChange={e=>updSingle("size",e.target.value)}>
                <option value="">— select —</option>
                {(singleType.sizes||[]).map(s=><option key={s} value={s}>{s}</option>)}
                <option value="__custom__">Other (type below)</option>
              </select>
              {single.size==="__custom__"&&(
                <input value="" onChange={e=>updSingle("size",e.target.value)} placeholder="Type a new size, e.g. 4XL" style={{marginTop:6}}/>
              )}
            </div>
          )}
          <div><FL>Expiry (optional)</FL><input type="date" value={single.expiry} onChange={e=>updSingle("expiry",e.target.value)}/></div>
          <div><FL>Usage Limit (optional)</FL><input type="number" value={single.usage_limit} onChange={e=>updSingle("usage_limit",e.target.value)}/></div>
          <div>
            <FL>NFC tag (optional — auto if blank)</FL>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <input value={single.nfc_tag} onChange={e=>updSingle("nfc_tag",e.target.value)} style={{flex:1}} placeholder="Auto-generated if blank"/>
              <button type="button" onClick={()=>setScanTarget("nfc_tag")} style={{background:"rgba(74,128,200,0.15)",border:"1px solid rgba(74,128,200,0.4)",color:"#7ab0ff",borderRadius:8,padding:"8px 12px",fontSize:13,fontWeight:600,whiteSpace:"nowrap",cursor:"pointer"}}>📡 Scan NFC</button>
            </div>
          </div>
          <div>
            <FL>QR code (optional — auto if blank)</FL>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <input value={single.qr_code} onChange={e=>updSingle("qr_code",e.target.value)} style={{flex:1}} placeholder="Auto-generated if blank"/>
              <button type="button" onClick={()=>setScanTarget("qr_code")} style={{background:"rgba(39,174,96,0.15)",border:"1px solid rgba(39,174,96,0.4)",color:"#27ae60",borderRadius:8,padding:"8px 12px",fontSize:13,fontWeight:600,whiteSpace:"nowrap",cursor:"pointer"}}>📷 Scan QR</button>
            </div>
          </div>
        </div>
        <FL>Notes</FL>
        <textarea rows={2} value={single.notes} onChange={e=>updSingle("notes",e.target.value)}/>
        <div style={{marginTop:14}}>
          <Btn onClick={submitSingle} color={T.accent} style={{width:"100%"}} disabled={!single.item.trim()||!single.location}>Add to Inventory</Btn>
        </div>
      </Card>
    )}
  </div>;
}
// ═══ MANAGER — CATEGORIES ═════════════════════════════════════════════════════
function CategoriesTab({cats,setCats,gear,showToast}){
  const [q,setQ]=useState("");
  const [showRetired,setShowRetired]=useState(false);
  const [editing,setEditing]=useState(null);
  const [adding,setAdding]=useState(false);
  const visible=cats.filter(c=>showRetired?!c.active:c.active!==false);
  const filtered=useMemo(()=>sq(visible,q,["name","cat_id","description"]),[visible,q]);
  function updCat(id,patch){setCats(cs=>cs.map(c=>c.cat_id===id?{...c,...patch}:c));}
  function usageCount(cat_id){return gear.filter(g=>g.category_id===cat_id).length;}
  function retire(c){const n=usageCount(c.cat_id);if(n>0){showToast("⚠ "+n+" gear item"+(n!==1?"s":"")+" still reference this — reassign or retire them first");return;}updCat(c.cat_id,{active:false});showToast("♻️ Category retired");}
  function restore(c){updCat(c.cat_id,{active:true});showToast("↩️ Category restored");}

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:10}}>
      <PT title="Categories" sub="Purchasing buckets with target stock levels — drive Future Purchases"/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Btn small outline color={T.muted} onClick={()=>setShowRetired(!showRetired)}>{showRetired?"Show active":"Show retired"}</Btn>
        <Btn small color={T.accent} onClick={()=>setAdding(true)}>+ Add Category</Btn>
      </div>
    </div>
    <SBar value={q} onChange={setQ} ph="Search categories…"/>
    <Card>
      <div className="sx"><table>
        <thead><tr><th>ID</th><th>Name</th><th>Behaviour</th><th>Budget Owner</th><th>Target</th><th>Current</th><th>Life Safety</th><th>ROY%</th><th></th></tr></thead>
        <tbody>{filtered.map(c=>{const s=calcROY(c.cat_id,gear);const n=usageCount(c.cat_id);return (
          <tr key={c.cat_id}>
            <td style={{color:T.muted,fontSize:12}}>{c.cat_id}</td>
            <td style={{fontWeight:500}}>{c.name}</td>
            <td><span style={{fontSize:11,background:"rgba(232,98,26,0.12)",color:T.accent,padding:"2px 7px",borderRadius:8,fontWeight:600}}>{c.behaviour||"signable"}</span></td>
            <td style={{fontSize:12,color:c.budget_owner?T.text:T.muted}}>{c.budget_owner||"—"}</td>
            <td>{showRetired?"—":<input type="number" value={c.target_stock||""} onChange={e=>updCat(c.cat_id,{target_stock:e.target.value?Number(e.target.value):null})} style={{width:60,padding:"3px 6px",fontSize:13}}/>}</td>
            <td>{s.total}</td>
            <td>{c.life_safety?<span style={{color:"#ff8a7a",fontSize:11,fontWeight:700}}>YES</span>:<span style={{color:T.muted,fontSize:11}}>no</span>}</td>
            <td style={{color:s.pct>10?"#ffaa7a":T.muted,fontWeight:s.pct>10?700:400}}>{s.total>0?s.pct.toFixed(0)+"%":"—"}</td>
            <td style={{whiteSpace:"nowrap"}}>
              {showRetired
                ? <Btn small outline color="#27ae60" onClick={()=>restore(c)}>Restore</Btn>
                : <div style={{display:"flex",gap:5}}>
                    <Btn small outline color="#7ab0ff" onClick={()=>setEditing(c)}>Edit</Btn>
                    <Btn small outline color={n>0?T.muted:"#c0392b"} onClick={()=>retire(c)} disabled={n>0} style={n>0?{cursor:"not-allowed",opacity:.5}:{}}>Retire</Btn>
                  </div>
              }
            </td>
          </tr>
        );})}</tbody>
      </table></div>
    </Card>
    {adding && <CategoryModal cats={cats} gear={gear} onClose={()=>setAdding(false)} onSave={newCat=>{setCats(cs=>[...cs,newCat]);setAdding(false);showToast("✅ Category added");}}/>}
    {editing && <CategoryModal cats={cats} gear={gear} existing={editing} onClose={()=>setEditing(null)} onSave={upd=>{updCat(editing.cat_id,upd);setEditing(null);showToast("✅ Category updated");}}/>}
  </div>;
}

function CategoryModal({cats,gear,existing,onClose,onSave}){
  const [name,        setName]        = useState(existing?.name||"");
  const [targetStock, setTargetStock] = useState(existing?.target_stock||"");
  const [lifeSafety,  setLifeSafety]  = useState(existing?.life_safety||false);
  const [behaviour,   setBehaviour]   = useState(existing?.behaviour||"signable");
  const [poolStyle,   setPoolStyle]   = useState(existing?.sized_pool_style||"individual");
  const [budgetOwner, setBudgetOwner] = useState(existing?.budget_owner||"");
  const [description, setDescription] = useState(existing?.description||"");
  const [nfcTag,      setNfcTag]      = useState(existing?.nfc_tag||"");
  const [qrCode,      setQrCode]      = useState(existing?.qr_code||"");
  const [catScanner,  setCatScanner]  = useState(null);  // null | 'nfc' | 'qr'
  const [error,       setError]       = useState("");

  // Live count of gear in this category — drives target-stock validation
  const currentCount = useMemo(()=>{
    if(!existing) return 0;
    return (gear||[]).filter(g=>g.category_id===existing.cat_id && g.status!=="YellowRepair").length;
  },[gear,existing]);

  function handleCatScan(raw){
    const t = (raw||"").trim();
    if(catScanner==='nfc') setNfcTag(t);
    if(catScanner==='qr')  setQrCode(t);
    setCatScanner(null);
  }

  async function submit(){
    setError("");
    if(!name.trim()){setError("Name is required.");return;}
    const tgt = targetStock?Number(targetStock):null;
    // Bug #4: block save when target < current
    if(existing && tgt!==null && tgt < currentCount){
      setError(`Target (${tgt}) cannot be below current stock (${currentCount}). Set target to at least ${currentCount}.`);
      return;
    }
    const patch={
      name:name.trim(),
      target_stock: tgt,
      life_safety:lifeSafety,
      behaviour,
      sized_pool_style: behaviour==="sized_pool"?poolStyle:null,
      budget_owner:budgetOwner.trim()||null,
      description:description.trim(),
      nfc_tag: nfcTag.trim()||null,
      qr_code: qrCode.trim()||null,
    };
    if(existing){
      if(hasSupabase()){
        const r = await sbUpdate("categories",{cat_id:existing.cat_id},patch);
        if(!r){setError("Database rejected the change. Most likely target_stock is below current stock — refresh and check.");return;}
      }
      onSave(patch);
    }else{
      const id="cat_"+name.trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,30);
      if(cats.find(c=>c.cat_id===id)){setError("Category ID already exists — try a different name.");return;}
      // NOTE: categories table has no `active` column in the production schema.
      // Sending it would cause the insert to fail silently (sbInsert returns null,
      // we'd fall through and the row would only live in local React state until
      // refresh). So we keep the row clean here, and add `active:true` only when
      // adding to local state.
      const dbRow={cat_id:id,...patch};
      if(hasSupabase()){
        const ins=await sbInsert("categories",dbRow);
        if(!ins){
          setError("Database rejected the new category. Open the browser console for the exact reason — most often a CHECK constraint or duplicate cat_id.");
          return;
        }
        onSave({...ins,active:true});
      } else {
        onSave({...dbRow,active:true});
      }
    }
  }

  const BH_OPTIONS=[
    {v:"signable",      l:"Signable",       d:"Standard gear — sign out / sign in"},
    {v:"sized_pool",    l:"Sized Pool",      d:"Items with sizes (S/M/L/XL etc)"},
    {v:"monitored_only",l:"Monitored Only",  d:"Report only — cannot sign out"},
    {v:"fuel",          l:"Fuel",            d:"Fuel tank — litres + gauge log"},
    {v:"catalogue",     l:"Catalogue",       d:"Reference only — no sign out"},
  ];

  return <Mdl onClose={onClose}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>{existing?"Edit Category":"New Category"}</div>
      <button onClick={onClose} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button>
    </div>
    <FL>Name</FL>
    <input id="cat-name" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. PFDs Adult, Climbing Shoes, Wetsuits 3mm"/>
    <FL>Behaviour</FL>
    <p style={{fontSize:12,color:T.muted,marginBottom:8,lineHeight:1.6}}>This controls how instructors interact with items in this category on the scan screen.</p>
    {BH_OPTIONS.map(o=>(
      <label key={o.v} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 10px",borderRadius:8,cursor:"pointer",background:behaviour===o.v?"rgba(232,98,26,0.1)":"transparent",border:"1px solid "+(behaviour===o.v?T.accent:"transparent"),marginBottom:5,transition:"all .12s"}}>
        <input type="radio" name="behaviour" value={o.v} checked={behaviour===o.v} onChange={()=>setBehaviour(o.v)} style={{width:"auto",marginTop:2}}/>
        <div>
          <div style={{fontSize:14,fontWeight:600,color:T.white}}>{o.l}</div>
          <div style={{fontSize:12,color:T.muted}}>{o.d}</div>
        </div>
      </label>
    ))}
    <FL>Budget Responsibility</FL>
    <input id="cat-budget" value={budgetOwner} onChange={e=>setBudgetOwner(e.target.value)} placeholder="e.g. Operations, Programmes, Fundraising"/>
    <p style={{fontSize:12,color:T.muted,marginTop:4,marginBottom:8,lineHeight:1.5}}>Items with a budget owner are excluded from future purchase auto-recommendations.</p>
    {behaviour==="sized_pool"&&(
      <>
        <FL>Sized pool style</FL>
        <p style={{fontSize:12,color:T.muted,marginBottom:8,lineHeight:1.6}}>Individual = one row per physical item (harnesses, helmets). Bucket = one row per size with a stock count (fleeces, rain gear).</p>
        <div style={{display:"flex",gap:8,marginBottom:8}}>
          {["individual","bucket"].map(s=>(
            <button key={s} type="button" onClick={()=>setPoolStyle(s)} style={{flex:1,background:poolStyle===s?"rgba(232,98,26,0.15)":"rgba(255,255,255,0.04)",border:"1px solid "+(poolStyle===s?T.accent:T.border),color:poolStyle===s?T.white:T.muted,borderRadius:8,padding:"9px 12px",fontSize:13,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>{s}</button>
          ))}
        </div>
      </>
    )}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
      <div>
        <FL>Target Stock {existing?<span style={{color:T.muted,fontWeight:400}}>· current {currentCount}</span>:null}</FL>
        <input id="cat-stock" type="number" value={targetStock} onChange={e=>setTargetStock(e.target.value)} placeholder="e.g. 5" min={existing?currentCount:0}/>
        {existing&&targetStock&&Number(targetStock)<currentCount&&(
          <p style={{fontSize:11,color:"#ff8a7a",marginTop:4}}>⚠ Below current stock ({currentCount}) — won't save.</p>
        )}
      </div>
    </div>
    <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",cursor:"pointer"}}>
      <input type="checkbox" checked={lifeSafety} onChange={e=>setLifeSafety(e.target.checked)} style={{width:"auto"}}/>
      <span style={{fontSize:14,color:T.white}}>Life safety item (×1.5 purchase priority weight)</span>
    </label>
    <FL>Description</FL>
    <textarea id="cat-desc" rows={2} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Optional notes about this category"/>
    <FL>Category NFC Tag (optional — scan a tag to attach)</FL>
    <p style={{fontSize:11,color:T.muted,marginBottom:6,lineHeight:1.5}}>
      Attaching a tag to the category lets one scan open the whole category.
      For sized pools that means the size grid for sign-out; for signable
      categories it shows the type-pick screen.
    </p>
    <div style={{display:"flex",gap:6,marginBottom:4}}>
      <input id="cat-nfc" name="nfc_tag" value={nfcTag} onChange={e=>setNfcTag(e.target.value)} placeholder="leave blank for none" style={{flex:1}}/>
      <button type="button" onClick={()=>setCatScanner("nfc")} style={{background:"rgba(74,128,200,0.15)",border:"1px solid rgba(74,128,200,0.4)",color:"#7ab0ff",borderRadius:8,padding:"8px 12px",fontSize:13,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>📡 Scan NFC</button>
    </div>
    <FL>Category QR Code (optional)</FL>
    <div style={{display:"flex",gap:6,marginBottom:4}}>
      <input id="cat-qr" name="qr_code" value={qrCode} onChange={e=>setQrCode(e.target.value)} placeholder="leave blank for none" style={{flex:1}}/>
      <button type="button" onClick={()=>setCatScanner("qr")} style={{background:"rgba(39,174,96,0.15)",border:"1px solid rgba(39,174,96,0.4)",color:"#27ae60",borderRadius:8,padding:"8px 12px",fontSize:13,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>📷 Scan QR</button>
    </div>
    {catScanner==="nfc"&&<NFCOverlay title="Scan NFC Tag" hint="Hold device near the NFC sticker for this category" onResult={handleCatScan} onClose={()=>setCatScanner(null)}/>}
    {catScanner==="qr"&&<ScannerOverlay title="Scan QR Code" hint="Point camera at the QR label for this category" onResult={handleCatScan} onClose={()=>setCatScanner(null)}/>}
    {error&&<div style={{background:"rgba(192,57,43,0.12)",border:"1px solid rgba(192,57,43,0.4)",color:"#ff8a7a",padding:"9px 12px",borderRadius:8,fontSize:13,marginTop:10}}>{error}</div>}
    <div style={{display:"flex",gap:10,marginTop:16}}>
      <Btn onClick={submit} color={T.accent} style={{flex:1}}>{existing?"Save Changes":"Create Category"}</Btn>
      <Btn onClick={onClose} outline color={T.muted}>Cancel</Btn>
    </div>
  </Mdl>;
}
// ═══ MANAGER — ITEM TYPES ═════════════════════════════════════════════════════
function ItemTypesTab({cats, setCats, gear, showToast}){
  // Item Types are not used in this version - behaviour lives on Categories
  // This tab now shows a summary of categories by behaviour as a reference
  const byBehaviour = ['signable','sized_pool','monitored_only','fuel','catalogue'].map(b=>({
    b, cats: cats.filter(c=>c.behaviour===b&&c.active!==false)
  })).filter(x=>x.cats.length>0);

  const BH_DESC = {
    signable:      {l:'Signable',      d:'Individual items scanned in/out by instructors',   col:'#27ae60'},
    sized_pool:    {l:'Sized Pool',    d:'Stock tracked by size — e.g. wetsuits, PFDs',      col:'#4a80c8'},
    monitored_only:{l:'Monitored',     d:'Visible for reporting, no sign-out required',       col:'#9b59b6'},
    fuel:          {l:'Fuel',          d:'Fuel tanks — litre log',                            col:'#e67e22'},
    catalogue:     {l:'Catalogue',     d:'Reference only, no checkout',                       col:'#6a8a6a'},
  };

  return <div>
    <PT title="Item Behaviours" sub="Behaviour is set on each Category — this shows a summary of how gear is organised"/>
    <p style={{fontSize:13,color:T.muted,marginBottom:16,lineHeight:1.7}}>
      To change how a category behaves, go to the <strong style={{color:T.white}}>Categories</strong> tab and edit the category.
      Behaviour options: Signable, Sized Pool, Monitored Only, Fuel, Catalogue.
    </p>
    {byBehaviour.map(({b,cats:bc})=>{
      const {l,d,col}=BH_DESC[b]||{l:b,d:'',col:T.muted};
      return <Card key={b} style={{marginBottom:12,borderLeft:`3px solid ${col}`}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
          <span style={{fontSize:14,fontWeight:700,color:col}}>{l}</span>
          <span style={{fontSize:12,color:T.muted}}>({bc.length} {bc.length===1?'category':'categories'})</span>
          <span style={{fontSize:12,color:T.muted}}>— {d}</span>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
          {bc.map(c=>(
            <span key={c.cat_id} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'4px 10px',fontSize:13,color:T.text}}>
              {c.name}
              {c.life_safety&&<span style={{color:'#ff8a7a',fontSize:10,marginLeft:4}}>⚡</span>}
            </span>
          ))}
        </div>
      </Card>;
    })}
    {byBehaviour.length===0&&<Card><p style={{color:T.muted,fontSize:14}}>No categories yet. Add categories first.</p></Card>}
  </div>;
}

// ═══ MANAGER — SIZED POOL ═════════════════════════════════════════════════════
function SizedPoolTab({gear, setGear, cats, showToast}){
  const sizedCats = cats.filter(c => c.behaviour === 'sized_pool' && c.active !== false);
  const [editingCat, setEditingCat] = useState(null);   // cat_id when adding new size to bucket
  const [newSize, setNewSize] = useState('');
  const [newCount, setNewCount] = useState(0);
  const [newCap, setNewCap] = useState(0);

  // ── BUCKET EDIT: change pool_count (current stock) for a bucket row ──
  async function adjustCount(bucket, delta){
    const newCount = Math.max(0, (Number(bucket.pool_count)||0) + delta);
    if(newCount > (Number(bucket.pool_capacity)||0)){
      showToast("⚠ Count would exceed capacity — increase capacity first");
      return;
    }
    setGear(gs => gs.map(g => g.gear_id===bucket.gear_id ? {...g, pool_count:newCount} : g));
    if(hasSupabase()) await sbUpdate('gear', {gear_id: bucket.gear_id}, {pool_count: newCount});
  }
  // ── BUCKET EDIT: change pool_capacity ──
  async function adjustCapacity(bucket, delta){
    const newCap = Math.max(0, (Number(bucket.pool_capacity)||0) + delta);
    if(newCap < (Number(bucket.pool_count)||0)){
      showToast("⚠ Capacity cannot drop below current count");
      return;
    }
    setGear(gs => gs.map(g => g.gear_id===bucket.gear_id ? {...g, pool_capacity:newCap} : g));
    if(hasSupabase()) await sbUpdate('gear', {gear_id: bucket.gear_id}, {pool_capacity: newCap});
  }
  // ── BUCKET DELETE: remove a size completely ──
  async function deleteBucket(bucket){
    if(!confirm(`Remove the ${bucket.size} bucket from this category? This deletes ${bucket.pool_count} items.`)) return;
    setGear(gs => gs.filter(g => g.gear_id!==bucket.gear_id));
    if(hasSupabase()) await sbDelete('gear', {gear_id: bucket.gear_id});
    showToast("✅ Bucket removed");
  }
  // ── BUCKET ADD: create a new size bucket for a category ──
  async function createBucket(cat){
    const sz = (newSize||'').trim();
    if(!sz){showToast("⚠ Enter a size");return;}
    if(gear.find(g=>g.category_id===cat.cat_id && g.size===sz && g.is_pool_bucket)){
      showToast("⚠ A bucket for that size already exists — edit it instead");return;
    }
    const cnt = Math.max(0, Number(newCount)||0);
    const cap = Math.max(cnt, Number(newCap)||0);
    const maxId = gear.reduce((m,g)=>Math.max(m,g.gear_id||0), 1000);
    const row = {
      gear_id: maxId+1,
      item: cat.name+" — "+sz,
      category_id: cat.cat_id,
      status: 'Green', expiry: null,
      number_of_uses: 0, usage_limit: 0,
      signed_in_out: 'IN',
      notes: '', location: '', physical_serial: '',
      size: sz, nfc_tag: null, qr_code: null,
      is_pool_bucket: true,
      pool_count: cnt, pool_capacity: cap,
      set_size: null,
    };
    setGear(gs => [...gs, row]);
    if(hasSupabase()) await sbInsert('gear', row);
    setEditingCat(null); setNewSize(''); setNewCount(0); setNewCap(0);
    showToast("✅ "+sz+" bucket added");
  }

  if (sizedCats.length === 0) {
    return <div>
      <PT title="Sized Pool Stock" sub="No sized pool categories yet"/>
      <Card>
        <p style={{fontSize:14,color:T.muted,lineHeight:1.7}}>
          No sized pool categories found. Go to <strong style={{color:T.white}}>Categories</strong> and
          set the behaviour to <strong style={{color:T.white}}>Sized Pool</strong> for items like
          fleeces, PFDs, wetsuits, boots, etc.
        </p>
      </Card>
    </div>;
  }

  return <div>
    <PT title="Sized Pool Stock" sub={`${sizedCats.length} sized categories · sorted by canonical size order`}/>
    {sizedCats.map(cat => {
      const items = gear.filter(g => g.category_id === cat.cat_id);
      const isBucket = cat.sized_pool_style === 'bucket';

      // ── BUCKET STYLE: rows ARE the buckets, edit them directly ──
      if(isBucket){
        const buckets = items.filter(g=>g.is_pool_bucket).sort((a,b)=>sizeSortKey(a.size)-sizeSortKey(b.size));
        const totalCount = buckets.reduce((a,g)=>a+(Number(g.pool_count)||0),0);
        const totalCap   = buckets.reduce((a,g)=>a+(Number(g.pool_capacity)||0),0);

        return (
          <Card key={cat.cat_id} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div>
                <span style={{fontSize:15,fontWeight:700,color:T.white}}>{cat.name}</span>
                {cat.life_safety && <span style={{fontSize:10,background:"rgba(192,57,43,0.15)",color:"#ff8a7a",padding:"2px 7px",borderRadius:10,marginLeft:8,fontWeight:700}}>LIFE SAFETY</span>}
                <span style={{fontSize:11,background:"rgba(232,98,26,0.12)",color:T.accent,padding:"2px 7px",borderRadius:8,marginLeft:8,fontWeight:600}}>BUCKET</span>
                <span style={{fontSize:12,color:T.muted,marginLeft:8}}>{totalCount} / {totalCap} units</span>
              </div>
              <div style={{display:"flex",gap:6}}>
                <Btn small outline color="#7ab0ff" onClick={()=>setEditingCat(editingCat===cat.cat_id?null:cat.cat_id)}>{editingCat===cat.cat_id?"Close":"+ Add size"}</Btn>
              </div>
            </div>

            {editingCat===cat.cat_id && (
              <div style={{background:"rgba(74,128,200,0.06)",border:"1px solid rgba(74,128,200,0.22)",borderRadius:8,padding:10,marginBottom:10,display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div><FL>Size</FL><input style={{width:80}} value={newSize} onChange={e=>setNewSize(e.target.value)} placeholder="e.g. M"/></div>
                <div><FL>Count</FL><input style={{width:70}} type="number" value={newCount} onChange={e=>setNewCount(e.target.value)}/></div>
                <div><FL>Capacity</FL><input style={{width:70}} type="number" value={newCap} onChange={e=>setNewCap(e.target.value)}/></div>
                <Btn small color={T.accent} onClick={()=>createBucket(cat)}>Add</Btn>
              </div>
            )}

            {buckets.length>0 ? (
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {buckets.map(b => {
                  const cnt = Number(b.pool_count)||0;
                  const cap = Number(b.pool_capacity)||0;
                  const pct = cap>0 ? Math.min((cnt/cap)*100, 100) : 0;
                  const col = cnt===0 ? '#c0392b' : cnt < cap*0.3 ? '#e67e22' : '#27ae60';
                  return (
                    <div key={b.gear_id} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 12px",minWidth:96,textAlign:"center"}}>
                      <div style={{fontSize:13,fontWeight:700,color:T.white}}>{b.size||'?'}</div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,margin:"5px 0"}}>
                        <button onClick={()=>adjustCount(b,-1)} disabled={cnt===0} style={{width:22,height:22,borderRadius:"50%",background:cnt===0?"rgba(255,255,255,0.05)":T.g2,border:"none",color:cnt===0?T.muted:"#fff",fontSize:13,fontWeight:700,cursor:cnt===0?"not-allowed":"pointer"}}>−</button>
                        <div style={{minWidth:30,fontSize:18,fontWeight:800,color:col,lineHeight:1.1}}>{cnt}</div>
                        <button onClick={()=>adjustCount(b,1)} disabled={cnt>=cap} style={{width:22,height:22,borderRadius:"50%",background:cnt>=cap?"rgba(255,255,255,0.05)":T.accent,border:"none",color:cnt>=cap?T.muted:"#fff",fontSize:13,fontWeight:700,cursor:cnt>=cap?"not-allowed":"pointer"}}>+</button>
                      </div>
                      <div style={{fontSize:10,color:T.muted}}>cap {cap} <button onClick={()=>adjustCapacity(b,-1)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",padding:"0 3px"}}>−</button><button onClick={()=>adjustCapacity(b,+1)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",padding:"0 3px"}}>+</button></div>
                      <div style={{height:3,background:"rgba(255,255,255,0.08)",borderRadius:2,marginTop:4,overflow:"hidden"}}>
                        <div style={{height:"100%",width:pct+"%",background:col,transition:"width .3s"}}/>
                      </div>
                      <button onClick={()=>deleteBucket(b)} style={{marginTop:5,fontSize:9,background:"none",border:"none",color:"#ff8a7a",cursor:"pointer",textDecoration:"underline"}}>delete</button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{fontSize:13,color:T.muted,padding:"6px 0"}}>No size buckets yet — click "+ Add size" above to start.</p>
            )}
          </Card>
        );
      }

      // ── INDIVIDUAL STYLE: rows are physical items, group by size for display ──
      const indivItems = items.filter(g=>!g.is_pool_bucket);
      const sizes = sortSizes([...new Set(indivItems.map(g => g.size||'').filter(Boolean))]);
      const totalIndiv = indivItems.length;

      return (
        <Card key={cat.cat_id} style={{marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
            <div>
              <span style={{fontSize:15,fontWeight:700,color:T.white}}>{cat.name}</span>
              {cat.life_safety && <span style={{fontSize:10,background:"rgba(192,57,43,0.15)",color:"#ff8a7a",padding:"2px 7px",borderRadius:10,marginLeft:8,fontWeight:700}}>LIFE SAFETY</span>}
              <span style={{fontSize:11,background:"rgba(74,128,200,0.12)",color:"#7ab0ff",padding:"2px 7px",borderRadius:8,marginLeft:8,fontWeight:600}}>INDIVIDUAL</span>
              <span style={{fontSize:12,color:T.muted,marginLeft:8}}>{totalIndiv} items</span>
            </div>
            <span style={{fontSize:10,color:T.muted}}>To add/remove items use Add Gear · Edit individuals in Gear List</span>
          </div>

          {sizes.length > 0 ? (
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {sizes.map(sz => {
                const ofSize = indivItems.filter(g=>g.size===sz);
                const inStock = ofSize.filter(g=>g.signed_in_out==='IN' && g.status!=='Red' && g.status!=='YellowRepair').length;
                const total = ofSize.length;
                const col = inStock===0 ? '#c0392b' : inStock < total*0.3 ? '#e67e22' : '#27ae60';
                const pct = total>0 ? (inStock/total)*100 : 0;
                return (
                  <div key={sz} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"8px 12px",minWidth:72,textAlign:"center"}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.white}}>{sz}</div>
                    <div style={{fontSize:18,fontWeight:800,color:col,lineHeight:1.1,margin:"3px 0"}}>{inStock}<span style={{fontSize:11,color:T.muted,fontWeight:400}}> / {total}</span></div>
                    <div style={{height:3,background:"rgba(255,255,255,0.08)",borderRadius:2,marginTop:5,overflow:"hidden"}}>
                      <div style={{height:"100%",width:pct+"%",background:col,transition:"width .3s"}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{fontSize:13,color:T.muted}}>{totalIndiv > 0 ? `${totalIndiv} items in DB — no size data` : "No items in DB for this category"}</p>
          )}
        </Card>
      );
    })}
  </div>;
}

// ═══ MANAGER — LOCATIONS ══════════════════════════════════════════════════════
function LocationsTab({gear, setGear, locations, setLocations, showToast}){
  const [adding, setAdding]   = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(null);  // loc_id being renamed
  const [editName, setEditName] = useState("");
  const [merging, setMerging] = useState(null);  // {from: locName, to: ""}

  // Combine: every location row + counts of gear there.
  // If there are gear rows pointing to a location *name* not in the locations
  // table, they show up too (so you can clean them up).
  const rowsByName = {};
  (locations||[]).forEach(l => {
    rowsByName[l.name] = {
      loc_id: l.loc_id, name: l.name, active: l.active!==false,
      total: 0, out: 0, red: 0, dangling: false,
    };
  });
  gear.forEach(g => {
    const nm = (g.location||'').trim();
    if(!nm) return;
    if(!rowsByName[nm]) rowsByName[nm] = {
      loc_id: null, name: nm, active: true,
      total: 0, out: 0, red: 0, dangling: true,
    };
    rowsByName[nm].total++;
    if(g.signed_in_out === 'OUT') rowsByName[nm].out++;
    if(g.status === 'Red') rowsByName[nm].red++;
  });
  const rows = Object.values(rowsByName).sort((a,b) => b.total - a.total);
  const danglingCount = rows.filter(r => r.dangling).length;

  // ── ADD a new location row to the locations table ──
  async function addLoc(){
    const nm = (newName||'').trim();
    if(!nm){showToast("⚠ Enter a name");return;}
    if(rowsByName[nm]){showToast("⚠ Location already exists");return;}
    const loc_id = "loc_" + nm.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40);
    const row = {loc_id, name:nm, active:true};
    // DB first — if it rejects, we don't pollute local state with a row that
    // disappears on refresh. The previous version inserted locally first and
    // ignored DB failures, which was the "doesn't persist" bug.
    if(hasSupabase()){
      const ins = await sbInsert('locations', row);
      if(!ins){showToast("❌ DB rejected — see console");return;}
      setLocations(ls => [...ls, ins]);
    } else {
      setLocations(ls => [...ls, row]);
    }
    setAdding(false); setNewName('');
    showToast("✅ Added "+nm);
  }

  // ── RENAME: change a location name everywhere (locations row + every gear row) ──
  async function commitRename(oldRow){
    const target = (editName||'').trim();
    if(!target || target === oldRow.name){setEditing(null);return;}
    if(rowsByName[target] && target !== oldRow.name){
      // Target exists → treat as a merge
      if(!confirm(`"${target}" already exists. Merge "${oldRow.name}" (${oldRow.total} items) into it?`)){return;}
    }
    // Update gear rows in state and DB
    setGear(gs => gs.map(g => g.location === oldRow.name ? {...g, location: target} : g));
    if(hasSupabase()){
      const ids = gear.filter(g => g.location === oldRow.name).map(g => g.gear_id);
      // bulk update gear in chunks
      for(let i=0;i<ids.length;i+=50){
        const chunk = ids.slice(i, i+50);
        await Promise.all(chunk.map(id => sbUpdate('gear', {gear_id:id}, {location: target})));
      }
    }
    // Update or remove the source location row
    if(oldRow.loc_id){
      if(rowsByName[target] && target !== oldRow.name){
        // Merge: delete the source location row
        setLocations(ls => ls.filter(l => l.loc_id !== oldRow.loc_id));
        if(hasSupabase()) await sbDelete('locations', {loc_id: oldRow.loc_id});
      } else {
        // Pure rename: update the row
        setLocations(ls => ls.map(l => l.loc_id===oldRow.loc_id ? {...l, name: target} : l));
        if(hasSupabase()) await sbUpdate('locations', {loc_id: oldRow.loc_id}, {name: target});
      }
    } else if(!rowsByName[target]){
      // Was dangling, no row in locations table — create one
      const loc_id = "loc_" + target.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40);
      const row = {loc_id, name: target, active:true};
      setLocations(ls => [...ls, row]);
      if(hasSupabase()) await sbInsert('locations', row);
    }
    setEditing(null); setEditName('');
    showToast("✅ Updated "+oldRow.total+" gear row"+(oldRow.total!==1?"s":""));
  }

  // ── ACTIVE TOGGLE ──
  async function toggleActive(row){
    if(!row.loc_id){showToast("⚠ Save this dangling location first by renaming it");return;}
    const nv = !row.active;
    setLocations(ls => ls.map(l => l.loc_id===row.loc_id ? {...l, active: nv} : l));
    if(hasSupabase()) await sbUpdate('locations', {loc_id: row.loc_id}, {active: nv});
    showToast(nv ? "✅ Active" : "🚫 Inactive");
  }

  // ── ADOPT dangling: create a locations row matching it ──
  async function adopt(row){
    const loc_id = "loc_" + row.name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40);
    const newRow = {loc_id, name: row.name, active:true};
    if(hasSupabase()){
      const ins = await sbInsert('locations', newRow);
      if(!ins){showToast("❌ DB rejected — see console");return;}
      setLocations(ls => [...ls, ins]);
    } else {
      setLocations(ls => [...ls, newRow]);
    }
    showToast("✅ Adopted "+row.name);
  }

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:10}}>
      <PT title="Locations" sub={`${rows.length} known locations · ${danglingCount?danglingCount+" need adopting · ":""}rename to merge`}/>
      <Btn small color={T.accent} onClick={()=>setAdding(s=>!s)}>{adding?"Close":"+ Add Location"}</Btn>
    </div>

    {adding && (
      <Card style={{marginBottom:10}}>
        <FL>New location name</FL>
        <div style={{display:"flex",gap:8}}>
          <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Tech Climbing Room" style={{flex:1}}/>
          <Btn small color={T.accent} onClick={addLoc}>Add</Btn>
        </div>
      </Card>
    )}

    {danglingCount > 0 && (
      <Card style={{marginBottom:10,background:"rgba(232,98,26,0.08)",border:"1px solid rgba(232,98,26,0.25)"}}>
        <p style={{fontSize:13,color:"#ffcc99",lineHeight:1.6}}>
          <strong>{danglingCount}</strong> location name{danglingCount!==1?"s":""} appear on gear rows but {danglingCount===1?"is":"are"} not in the locations table.
          Adopt them (creates a row), or rename them to merge into an existing location.
        </p>
      </Card>
    )}

    {rows.length === 0
      ? <Card><p style={{color:T.muted,fontSize:14}}>No locations yet — add one above.</p></Card>
      : <Card><div className="sx"><table>
          <thead><tr><th>Location</th><th>Items</th><th>Out</th><th>Red</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.name} style={{opacity:r.active?1:0.5}}>
              <td style={{fontWeight:500}}>
                {editing === r.name ? (
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <input value={editName} onChange={e=>setEditName(e.target.value)} style={{padding:"4px 8px",fontSize:13,minWidth:160}}/>
                    <button onClick={()=>commitRename(r)} style={{background:T.accent,border:"none",color:"#fff",borderRadius:6,padding:"4px 9px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Save</button>
                    <button onClick={()=>setEditing(null)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:12}}>Cancel</button>
                  </div>
                ) : (
                  <span>
                    {r.name}
                    {r.dangling && <span style={{fontSize:10,marginLeft:8,padding:"1px 6px",background:"rgba(232,98,26,0.18)",color:"#ffcc99",borderRadius:8,fontWeight:700}}>DANGLING</span>}
                  </span>
                )}
              </td>
              <td>{r.total}</td>
              <td style={{color:r.out>0?T.accent:T.muted}}>{r.out||'—'}</td>
              <td style={{color:r.red>0?"#ff8a7a":T.muted}}>{r.red||'—'}</td>
              <td><span style={{fontSize:11,color:r.active?"#7adf9a":T.muted}}>{r.active?"active":"inactive"}</span></td>
              <td style={{whiteSpace:"nowrap"}}>
                {editing !== r.name && (<>
                  <button onClick={()=>{setEditing(r.name);setEditName(r.name);}} style={{background:"none",border:"none",color:"#7ab0ff",cursor:"pointer",fontSize:12,marginRight:8}}>rename / merge</button>
                  {r.dangling
                    ? <button onClick={()=>adopt(r)} style={{background:"none",border:"none",color:"#7adf9a",cursor:"pointer",fontSize:12}}>adopt</button>
                    : <button onClick={()=>toggleActive(r)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:12}}>{r.active?"deactivate":"activate"}</button>
                  }
                </>)}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
    }
  </div>;
}

// ═══ MANAGER — LISTS ══════════════════════════════════════════════════════════
function ListsTab({lists,setLists,gear,cats,showToast}){
  const [q,setQ]=useState("");
  const [showRetired,setShowRetired]=useState(false);
  const [editing,setEditing]=useState(null);
  const [adding,setAdding]=useState(false);
  const visible=lists.filter(l=>showRetired?!l.active:l.active!==false);
  const filtered=useMemo(()=>sq(visible,q,["name","list_id","description"]),[visible,q]);
  function retire(l){setLists(ls=>ls.map(x=>x.list_id===l.list_id?{...x,active:false}:x));showToast("♻️ List retired");}
  function restore(l){setLists(ls=>ls.map(x=>x.list_id===l.list_id?{...x,active:true}:x));showToast("↩️ List restored");}

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:10}}>
      <PT title="Lists" sub="Checkout groups — scan one QR to sign out the set · max 40 items"/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Btn small outline color={T.muted} onClick={()=>setShowRetired(!showRetired)}>{showRetired?"Show active":"Show retired"}</Btn>
        <Btn small color={T.accent} onClick={()=>setAdding(true)}>+ Add List</Btn>
      </div>
    </div>
    <SBar value={q} onChange={setQ} ph="Search lists…"/>
    {filtered.map(l=>{
      const items=l.gear_ids.map(id=>gear.find(g=>g.gear_id===id)).filter(Boolean);
      const missing=l.gear_ids.length-items.length;
      return (
        <Card key={l.list_id} style={{marginBottom:11}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:0}}>
              <p style={{fontSize:15,fontWeight:600,color:T.white}}>{l.name}</p>
              <p style={{fontSize:12,color:T.muted,marginTop:3}}>{l.description} · QR: {l.qr_code}</p>
              {missing>0&&<p style={{fontSize:12,color:"#ffaa7a",marginTop:3}}>⚠ {missing} retired member{missing!==1?"s":""} — click Edit to clean up</p>}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <div style={{textAlign:"right"}}><div style={{fontSize:17,fontWeight:700,color:T.white}}>{items.length}</div><div style={{fontSize:11,color:T.muted}}>items</div></div>
              {showRetired
                ? <Btn small outline color="#27ae60" onClick={()=>restore(l)}>Restore</Btn>
                : <div style={{display:"flex",gap:5}}>
                    <Btn small outline color="#7ab0ff" onClick={()=>setEditing(l)}>Edit</Btn>
                    <Btn small outline color="#c0392b" onClick={()=>retire(l)}>Retire</Btn>
                  </div>
              }
            </div>
          </div>
          <div style={{marginTop:8}}>
            {items.map(g=>(<div key={g.gear_id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}><SBadge status={g.status} small/><span style={{fontSize:13,color:T.white,flex:1}}>{g.item} #{g.gear_id}</span><span style={{fontSize:12,color:T.muted}}>{g.signed_in_out}</span></div>))}
          </div>
        </Card>
      );
    })}
    {adding && <ListModal lists={lists} gear={gear} cats={cats} onClose={()=>setAdding(false)} onSave={async newList=>{
      // Persist to DB before adding to local state. The lists table doesn't
      // have an `active` column so we strip it; gear_ids isn't a column at
      // all and instead drives inserts into list_gear.
      const {gear_ids, active, ...dbRow} = newList;
      if(hasSupabase()){
        const ins = await sbInsert("lists", dbRow);
        if(!ins){showToast("❌ DB rejected the list — see console");return;}
        // Insert join rows
        if(gear_ids && gear_ids.length){
          for(let i=0;i<gear_ids.length;i++){
            await sbInsert("list_gear", {list_id:ins.list_id, gear_id:gear_ids[i], sort_order:i});
          }
        }
        setLists(ls=>[...ls,{...ins, gear_ids: gear_ids||[], active:true}]);
      } else {
        setLists(ls=>[...ls,newList]);
      }
      setAdding(false);showToast("✅ List created");
    }}/>}
    {editing && <ListModal lists={lists} gear={gear} cats={cats} existing={editing} onClose={()=>setEditing(null)} onSave={async upd=>{
      const {gear_ids: newIds, ...listFields} = upd;
      if(hasSupabase()){
        const r = await sbUpdate("lists",{list_id:editing.list_id},listFields);
        if(!r){showToast("❌ DB rejected the update — see console");return;}
        // Reconcile list_gear: easy approach is to delete all then re-insert.
        // For 40-item-max lists this is cheap.
        await sbDelete("list_gear",{list_id:editing.list_id});
        if(newIds && newIds.length){
          for(let i=0;i<newIds.length;i++){
            await sbInsert("list_gear",{list_id:editing.list_id, gear_id:newIds[i], sort_order:i});
          }
        }
      }
      setLists(ls=>ls.map(x=>x.list_id===editing.list_id?{...x,...upd}:x));
      setEditing(null);showToast("✅ List updated");
    }}/>}
  </div>;
}

function ListModal({lists,gear,cats,existing,onClose,onSave}){
  const [name,setName]=useState(existing?.name||"");
  const [description,setDescription]=useState(existing?.description||"");
  const [behaviour,setBehaviour]=useState(existing?.behaviour||"signable");
  const [nfcTag,setNfcTag]=useState(existing?.nfc_tag||"");
  const [qrCode,setQrCode]=useState(existing?.qr_code||"");
  const [memberIds,setMemberIds]=useState(existing?.gear_ids||[]);
  const [pickerQ,setPickerQ]=useState("");
  const [listScanner,setListScanner]=useState(null);
  const [error,setError]=useState("");

  // Available gear is filtered to gear whose category behaviour matches the
  // list's behaviour. Membership is locked to a single behaviour by design (#9).
  const matchesBehaviour = useCallback((g)=>{
    const cat = (cats||[]).find(c=>c.cat_id===g.category_id);
    return (cat?.behaviour || "signable") === behaviour;
  },[cats,behaviour]);

  const available=useMemo(()=>sq(
    gear.filter(g=>!memberIds.includes(g.gear_id) && matchesBehaviour(g)),
    pickerQ,
    ["item","gear_id","physical_serial","location"]
  ),[gear,memberIds,pickerQ,matchesBehaviour]);
  const selected=memberIds.map(id=>gear.find(g=>g.gear_id===id)).filter(Boolean);

  // If the user changes behaviour, drop members that no longer match.
  useEffect(()=>{
    setMemberIds(ids => ids.filter(id => {
      const g = gear.find(x=>x.gear_id===id);
      return g && matchesBehaviour(g);
    }));
  },[behaviour]); // eslint-disable-line react-hooks/exhaustive-deps

  function add(g){
    if(memberIds.length>=150){setError("Maximum 150 items per list");return;}
    if(!matchesBehaviour(g)){setError(`This list is locked to ${behaviour} — that item is ${behaviourOf(g,cats)}`);return;}
    setError("");
    setMemberIds(ids=>[...ids,g.gear_id]);
  }
  function remove(id){setMemberIds(ids=>ids.filter(x=>x!==id));}
  function handleListScan(raw){
    if(listScanner==="nfc") setNfcTag(raw.trim());
    if(listScanner==="qr")  setQrCode(raw.trim());
    setListScanner(null);
  }
  function submit(){
    if(!name.trim()){setError("Name is required");return;}
    setError("");
    if(existing){
      onSave({name:name.trim(),description:description.trim(),behaviour,nfc_tag:nfcTag.trim()||existing.nfc_tag,qr_code:qrCode.trim()||existing.qr_code,gear_ids:memberIds});
    }else{
      const id="LST"+String(Date.now()).slice(-3);
      const autoNfc="NFC-LIST-"+id.slice(3);
      const autoQr="QR-LIST-"+id.slice(3);
      onSave({list_id:id,name:name.trim(),description:description.trim(),behaviour,nfc_tag:nfcTag.trim()||autoNfc,qr_code:qrCode.trim()||autoQr,gear_ids:memberIds,active:true});
    }
  }

  return <Mdl onClose={onClose}>
    {listScanner==="nfc"&&<NFCOverlay title="Scan NFC Tag" hint="Hold device near the NFC sticker for this list" onResult={handleListScan} onClose={()=>setListScanner(null)}/>}
    {listScanner==="qr"&&<ScannerOverlay title="Scan QR Code" hint="Point camera at the QR label for this list" onResult={handleListScan} onClose={()=>setListScanner(null)}/>}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>{existing?"Edit List":"New List"}</div>
      <button onClick={onClose} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button>
    </div>
    <FL>Name</FL><input id="list-name" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Puke Ab Sail Kit"/>
    <FL>Behaviour (locked — all members of this list must share this behaviour)</FL>
    <select value={behaviour} onChange={e=>setBehaviour(e.target.value)} disabled={existing && memberIds.length>0}>
      <option value="signable">Signable — standard sign in / out</option>
      <option value="sized_pool">Sized Pool — clothing / footwear pools</option>
      <option value="monitored_only">Monitored Only — report-only items</option>
      <option value="fuel">Fuel — vehicles &amp; fuel logs</option>
      <option value="catalogue">Catalogue — reference, no sign-out</option>
    </select>
    {existing && memberIds.length>0 && <p style={{fontSize:11,color:T.muted,marginTop:4}}>Behaviour is locked while members exist. Remove all members to change.</p>}
    <FL>Description</FL><input id="list-desc" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Optional"/>
    <FL>NFC Tag (auto-generated if blank)</FL>
    <div style={{display:"flex",gap:6,marginBottom:4}}>
      <input id="list-nfc" value={nfcTag} onChange={e=>setNfcTag(e.target.value)} placeholder={existing?.nfc_tag||"Auto-generated"} style={{flex:1}}/>
      <button type="button" onClick={()=>setListScanner("nfc")} style={{background:"rgba(74,128,200,0.15)",border:"1px solid rgba(74,128,200,0.4)",color:"#7ab0ff",borderRadius:8,padding:"8px 12px",fontSize:13,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>📡 Scan NFC</button>
    </div>
    <FL>QR Code (auto-generated if blank)</FL>
    <div style={{display:"flex",gap:6,marginBottom:4}}>
      <input id="list-qr" value={qrCode} onChange={e=>setQrCode(e.target.value)} placeholder={existing?.qr_code||"Auto-generated"} style={{flex:1}}/>
      <button type="button" onClick={()=>setListScanner("qr")} style={{background:"rgba(39,174,96,0.15)",border:"1px solid rgba(39,174,96,0.4)",color:"#27ae60",borderRadius:8,padding:"8px 12px",fontSize:13,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>📷 Scan QR</button>
    </div>
    <FL>Members ({selected.length} of max 40)</FL>
    <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid "+T.border,borderRadius:8,padding:10,maxHeight:140,overflowY:"auto",marginBottom:8}}>
      {selected.length===0?<p style={{fontSize:13,color:T.muted,textAlign:"center",padding:8}}>No members yet — add from the picker below</p>:selected.map(g=>(
        <div key={g.gear_id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
          <SBadge status={g.status} small/>
          <span style={{fontSize:13,color:T.white,flex:1}}>{g.item} #{g.gear_id}</span>
          <button onClick={()=>remove(g.gear_id)} style={{background:"rgba(192,57,43,0.15)",border:"none",color:"#ff8a7a",borderRadius:6,padding:"3px 8px",fontSize:11,fontWeight:600}}>Remove</button>
        </div>
      ))}
    </div>
    <FL>Add Members (click to add)</FL>
    <input placeholder="🔍 Search gear to add…" value={pickerQ} onChange={e=>setPickerQ(e.target.value)} style={{marginBottom:6}}/>
    <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid "+T.border,borderRadius:8,padding:10,maxHeight:160,overflowY:"auto"}}>
      {available.slice(0,20).map(g=>(
        <div key={g.gear_id} className="cl" onClick={()=>add(g)} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer"}}>
          <SBadge status={g.status} small/>
          <span style={{fontSize:13,color:T.white,flex:1}}>{g.item} #{g.gear_id}</span>
          <span style={{fontSize:11,color:T.accent}}>+ Add</span>
        </div>
      ))}
      {available.length>20&&<p style={{fontSize:11,color:T.muted,textAlign:"center",padding:5}}>Showing first 20 — refine search to see more</p>}
      {available.length===0&&pickerQ===""&&<p style={{fontSize:12,color:T.muted,textAlign:"center",padding:5}}>No gear matches this list's behaviour ({behaviour}).</p>}
    </div>
    {error&&<div style={{background:"rgba(192,57,43,0.12)",border:"1px solid rgba(192,57,43,0.4)",color:"#ff8a7a",padding:"9px 12px",borderRadius:8,fontSize:13,marginTop:10}}>{error}</div>}
    <div style={{display:"flex",gap:10,marginTop:16}}>
      <Btn onClick={submit} color={T.accent} style={{flex:1}} disabled={!name.trim()||memberIds.length===0}>{existing?"Save Changes":"Create List"}</Btn>
      <Btn onClick={onClose} outline color={T.muted}>Cancel</Btn>
    </div>
  </Mdl>;
}
// ═══ MANAGER — USAGE / REPORTS / REPAIRS ══════════════════════════════════════

function UsageTab({usage,setUsage,gear,showToast}){
  const [q,setQ]=useState("");const [editU,setEditU]=useState(null);
  const filtered=useMemo(()=>sq([...usage].reverse(),q,["item","gear_id","instructor","signed_in_out"]),[usage,q]);

  async function saveUsage(upd){
    setUsage(u=>u.map(x=>x.usage_id===upd.usage_id?upd:x));
    if(hasSupabase())await sbUpdate("usage",{usage_id:upd.usage_id},upd);
    showToast("✅ Usage updated");setEditU(null);
  }
  async function deleteUsage(id){
    if(!window.confirm("Delete this usage record?"))return;
    setUsage(u=>u.filter(x=>x.usage_id!==id));
    if(hasSupabase())await sbDelete("usage",{usage_id:id});
    showToast("🗑 Usage deleted");
  }
  // Sign gear back in from usage log
  async function signInFromLog(u){
    const now=new Date().toISOString();
    const upd={...u,signed_in_out:"IN",time_in:now};
    setUsage(us=>us.map(x=>x.usage_id===u.usage_id?upd:x));
    if(hasSupabase()){
      await sbUpdate("usage",{usage_id:u.usage_id},{signed_in_out:"IN",time_in:now});
      if(u.gear_id)await sbUpdate("gear",{gear_id:u.gear_id},{signed_in_out:"IN"});
    }
    showToast("✅ Signed back in");
  }

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:10}}>
      <PT title="Usage Log" sub="Edit or delete rows to fix dirty data. Sign items back in directly."/>
      <Btn small color="#27ae60" onClick={()=>dlCSV("Usage",usage)}>⬇ Export CSV</Btn>
    </div>
    <SBar value={q} onChange={setQ} ph="Search by item, gear ID, instructor…"/>
    <Card><div className="sx"><table>
      <thead><tr><th>ID</th><th>Item</th><th>Gear</th><th>Action</th><th>Out</th><th>In</th><th>Instructor</th><th>Edit</th></tr></thead>
      <tbody>{filtered.map(u=>(
        <tr key={u.usage_id}>
          <td style={{color:T.muted,fontSize:12}}>{u.usage_id}</td>
          <td style={{fontWeight:500}}>{u.item}</td>
          <td style={{color:T.muted}}>{u.gear_id||"—"}</td>
          <td><span style={{fontSize:13,color:u.signed_in_out==="OUT"?T.accent:"#27ae60",fontWeight:600}}>{u.signed_in_out}</span></td>
          <td style={{fontSize:13,color:T.muted,whiteSpace:"nowrap"}}>{fmtDT(u.time_out)}</td>
          <td style={{fontSize:13,color:T.muted,whiteSpace:"nowrap"}}>{u.time_in?fmtDT(u.time_in):<span style={{color:T.accent,fontSize:11}}>Still out</span>}</td>
          <td>{u.instructor}</td>
          <td style={{display:"flex",gap:4}}>
            {u.signed_in_out==="OUT"&&!u.time_in&&
              <button onClick={()=>signInFromLog(u)} style={{background:"rgba(39,174,96,0.15)",border:"1px solid rgba(39,174,96,0.3)",color:"#27ae60",borderRadius:6,padding:"3px 7px",fontSize:10,cursor:"pointer",whiteSpace:"nowrap"}}>Sign In</button>
            }
            <button onClick={()=>setEditU({...u})} style={{background:"rgba(255,255,255,0.07)",border:"1px solid "+T.border,color:T.text,borderRadius:6,padding:"3px 8px",fontSize:10,cursor:"pointer"}}>Edit</button>
            <button onClick={()=>deleteUsage(u.usage_id)} style={{background:"rgba(192,57,43,0.1)",border:"1px solid rgba(192,57,43,0.2)",color:"#ff8a7a",borderRadius:6,padding:"3px 8px",fontSize:10,cursor:"pointer"}}>Del</button>
          </td>
        </tr>
      ))}</tbody>
    </table></div></Card>

    {editU&&<Mdl onClose={()=>setEditU(null)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>Edit Usage #{editU.usage_id}</div>
        <button onClick={()=>setEditU(null)} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button>
      </div>
      <FL>Item</FL><input id="editu-item" value={editU.item||""} onChange={e=>setEditU(u=>({...u,item:e.target.value}))}/>
      <FL>Instructor</FL><input value={editU.instructor||""} onChange={e=>setEditU(u=>({...u,instructor:e.target.value}))}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
        <div><FL>Time Out</FL><input type="datetime-local" value={editU.time_out?editU.time_out.slice(0,16):""} onChange={e=>setEditU(u=>({...u,time_out:e.target.value+":00Z"}))}/></div>
        <div><FL>Time In</FL><input type="datetime-local" value={editU.time_in?editU.time_in.slice(0,16):""} onChange={e=>setEditU(u=>({...u,time_in:e.target.value+":00Z",signed_in_out:"IN"}))}/></div>
        <div><FL>State</FL><select value={editU.signed_in_out} onChange={e=>setEditU(u=>({...u,signed_in_out:e.target.value}))}><option value="IN">IN</option><option value="OUT">OUT</option></select></div>
      </div>
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn onClick={()=>saveUsage(editU)} color={T.accent}>Save</Btn>
        <Btn onClick={()=>setEditU(null)} outline color={T.muted}>Cancel</Btn>
      </div>
    </Mdl>}
  </div>;
}

function ReportsTab({reports,setReports,gear,setGear,showToast}){
  const [q,setQ]=useState("");const [showResolved,setShowResolved]=useState(false);const [editR,setEditR]=useState(null);
  const filtered=useMemo(()=>{
    let r=showResolved?reports:reports.filter(x=>!x.resolved);
    return sq([...r].reverse(),q,["item","gear_id","instructor","status","notes"]);
  },[reports,q,showResolved]);

  async function resolveReport(r){
    const upd={...r,resolved:true,resolved_at:new Date().toISOString()};
    setReports(rs=>rs.map(x=>x.report_id===r.report_id?upd:x));
    if(hasSupabase())await sbUpdate("reports",{report_id:r.report_id},{resolved:true,resolved_at:upd.resolved_at});
    showToast("✅ Report resolved — stays on file");
  }
  async function saveReport(upd){
    setReports(rs=>rs.map(x=>x.report_id===upd.report_id?upd:x));
    // Also update gear status if changed
    if(gear.find(g=>g.gear_id===upd.gear_id)){
      setGear(g=>g.map(x=>x.gear_id===upd.gear_id?{...x,status:upd.status,notes:upd.notes}:x));
      if(hasSupabase())await sbUpdate("gear",{gear_id:upd.gear_id},{status:upd.status,notes:upd.notes});
    }
    if(hasSupabase())await sbUpdate("reports",{report_id:upd.report_id},upd);
    showToast("✅ Report updated");setEditR(null);
  }

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:10}}>
      <PT title="Issue Reports" sub="Resolve to archive. Active reports shown by default."/>
      <div style={{display:"flex",gap:8}}>
        <Btn small outline color={T.muted} onClick={()=>setShowResolved(x=>!x)}>{showResolved?"Hide Resolved":"Show Resolved"}</Btn>
        <Btn small color="#27ae60" onClick={()=>dlCSV("Reports",reports)}>⬇ Export CSV</Btn>
      </div>
    </div>
    <SBar value={q} onChange={setQ} ph="Search by item, status, instructor, notes…"/>
    <Card><div className="sx"><table>
      <thead><tr><th>ID</th><th>Item</th><th>Gear</th><th>Status</th><th>Notes</th><th>Instructor</th><th>Reported</th><th>Actions</th></tr></thead>
      <tbody>{filtered.map(r=>(
        <tr key={r.report_id} style={{opacity:r.resolved?0.55:1}}>
          <td style={{color:T.muted,fontSize:12}}>{r.report_id}</td>
          <td style={{fontWeight:500}}>{r.item}</td>
          <td style={{color:T.muted}}>{r.gear_id||"—"}</td>
          <td><SBadge status={r.status} small/></td>
          <td style={{fontSize:13,color:T.muted,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.notes}</td>
          <td style={{fontSize:13}}>{r.instructor}</td>
          <td style={{fontSize:12,color:T.muted,whiteSpace:"nowrap"}}>{fmtDT(r.time_reported)}</td>
          <td style={{display:"flex",gap:4,whiteSpace:"nowrap"}}>
            <button onClick={()=>setEditR({...r})} style={{background:"rgba(255,255,255,0.07)",border:"1px solid "+T.border,color:T.text,borderRadius:6,padding:"3px 8px",fontSize:10,cursor:"pointer"}}>Edit</button>
            {!r.resolved&&<button onClick={()=>resolveReport(r)} style={{background:"rgba(39,174,96,0.12)",border:"1px solid rgba(39,174,96,0.3)",color:"#27ae60",borderRadius:6,padding:"3px 8px",fontSize:10,cursor:"pointer"}}>Resolve</button>}
          </td>
        </tr>
      ))}</tbody>
    </table></div></Card>

    {editR&&<Mdl onClose={()=>setEditR(null)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>Edit Report #{editR.report_id}</div>
        <button onClick={()=>setEditR(null)} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button>
      </div>
      <FL>Status</FL>
      <select value={editR.status} onChange={e=>setEditR(r=>({...r,status:e.target.value}))}>
        {["Green","Yellow","Orange","Red","YellowRepair"].map(s=><option key={s} value={s}>{s}</option>)}
      </select>
      <FL>Notes</FL><textarea id="editr-notes" rows={3} value={editR.notes||""} onChange={e=>setEditR(r=>({...r,notes:e.target.value}))}/>
      <FL>Instructor</FL><input value={editR.instructor||""} onChange={e=>setEditR(r=>({...r,instructor:e.target.value}))}/>
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn onClick={()=>saveReport(editR)} color={T.accent}>Save</Btn>
        <Btn onClick={()=>setEditR(null)} outline color={T.muted}>Cancel</Btn>
      </div>
    </Mdl>}
  </div>;
}

function RepairsTab({repairs,setRepairs,showToast}){
  const [showClosed,setShowClosed]=useState(false);const [editRep,setEditRep]=useState(null);
  const open=repairs.filter(r=>r.status==="open");
  const closed=repairs.filter(r=>r.status==="closed"||r.status==="retired");

  async function closeRepair(r){
    const upd={...r,status:"closed",date_completed:new Date().toISOString().slice(0,10)};
    setRepairs(rs=>rs.map(x=>x.repair_id===r.repair_id?upd:x));
    if(hasSupabase())await sbUpdate("repairs",{repair_id:r.repair_id},{status:"closed",date_completed:upd.date_completed});
    showToast("✅ Repair closed");
  }
  async function retireRepair(r){
    const upd={...r,status:"retired"};
    setRepairs(rs=>rs.map(x=>x.repair_id===r.repair_id?upd:x));
    if(hasSupabase())await sbUpdate("repairs",{repair_id:r.repair_id},{status:"retired"});
    showToast("♻️ Repair retired — stays on file");
  }
  async function saveRepair(upd){
    setRepairs(rs=>rs.map(x=>x.repair_id===upd.repair_id?upd:x));
    if(hasSupabase())await sbUpdate("repairs",{repair_id:upd.repair_id},upd);
    showToast("✅ Repair updated");setEditRep(null);
  }

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:10}}>
      <PT title="Repairs" sub="Close when fixed · Retire to archive without closing"/>
      <div style={{display:"flex",gap:8}}>
        <Btn small outline color={T.muted} onClick={()=>setShowClosed(x=>!x)}>{showClosed?"Hide Closed":"Show Closed/Retired"}</Btn>
        <Btn small color="#27ae60" onClick={()=>dlCSV("Repairs",repairs)}>⬇ Export CSV</Btn>
      </div>
    </div>
    <Card style={{marginBottom:12}}>
      <p style={{fontSize:14,fontWeight:600,color:T.white,marginBottom:10}}>Open ({open.length})</p>
      {open.length===0?<p style={{fontSize:13,color:T.muted}}>No open repairs.</p>:open.map(r=>(
        <div key={r.repair_id} style={{padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:500,color:T.white}}>{r.item} #{r.gear_id}</div>
            <div style={{fontSize:12,color:T.muted,marginTop:3}}>{r.notes} · {r.assigned_to||"unassigned"} · {fmtD(r.date_reported)}</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setEditRep({...r})} style={{background:"rgba(255,255,255,0.07)",border:"1px solid "+T.border,color:T.text,borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer"}}>Edit</button>
            <button onClick={()=>closeRepair(r)} style={{background:"rgba(39,174,96,0.15)",border:"1px solid rgba(39,174,96,0.35)",color:"#27ae60",borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer"}}>✓ Close</button>
            <button onClick={()=>retireRepair(r)} style={{background:"rgba(192,57,43,0.1)",border:"1px solid rgba(192,57,43,0.2)",color:"#ff8a7a",borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer"}}>Retire</button>
          </div>
        </div>
      ))}
    </Card>
    {showClosed&&<Card>
      <p style={{fontSize:14,fontWeight:600,color:T.white,marginBottom:10}}>Closed/Retired ({closed.length})</p>
      {closed.length===0?<p style={{fontSize:13,color:T.muted}}>None yet.</p>:closed.map(r=>(
        <div key={r.repair_id} style={{padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",opacity:.65}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,background:r.status==="retired"?"rgba(192,57,43,0.15)":"rgba(39,174,96,0.12)",color:r.status==="retired"?"#ff8a7a":"#27ae60",padding:"1px 7px",borderRadius:10,fontWeight:700}}>{r.status.toUpperCase()}</span><span style={{fontSize:13,color:T.white}}>{r.item} #{r.gear_id}</span></div>
          <div style={{fontSize:12,color:T.muted,marginTop:2}}>{r.date_completed?("Completed "+fmtD(r.date_completed)+" · "):""}{r.notes}</div>
        </div>
      ))}
    </Card>}

    {editRep&&<Mdl onClose={()=>setEditRep(null)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>Edit Repair {editRep.repair_id}</div>
        <button onClick={()=>setEditRep(null)} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button>
      </div>
      <FL>Notes</FL><textarea rows={3} value={editRep.notes||""} onChange={e=>setEditRep(r=>({...r,notes:e.target.value}))}/>
      <FL>Assigned To</FL><input value={editRep.assigned_to||""} onChange={e=>setEditRep(r=>({...r,assigned_to:e.target.value}))}/>
      <FL>Status</FL>
      <select value={editRep.status} onChange={e=>setEditRep(r=>({...r,status:e.target.value}))}>
        {["open","closed","retired"].map(s=><option key={s} value={s}>{s}</option>)}
      </select>
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn onClick={()=>saveRepair(editRep)} color={T.accent}>Save</Btn>
        <Btn onClick={()=>setEditRep(null)} outline color={T.muted}>Cancel</Btn>
      </div>
    </Mdl>}
  </div>;
}

// ═══ MANAGER — FUTURE PURCHASES / PURCHASING WORKFLOW / SPENDING ══════════════
function FuturePurchasesTab({cats,gear,workflow,setWorkflow,showToast}){
  const fp=useMemo(()=>calcFuturePurchases(cats,gear),[cats,gear]);
  async function addToWF(c){
    if(workflow.find(w=>w.cat_id===c.cat_id&&w.workflow_stage!=="entered")){showToast("⚠ Already in workflow");return;}
    const rec={cat_id:c.cat_id,item:c.name+" — batch",gear_id:null,status:c.red>0?"Red":c.orange>0?"Orange":"Yellow",priority:c.priority,purchase_type:"operational",workflow_stage:"pending",estimated_cost:null,quote_amount:null,quote_supplier:null,grant_name:null,grant_applied_date:null,grant_approved_date:null,order_date:null,arrived_date:null,notes:"",allocated_to:"unallocated"};
    if(hasSupabase()){const ins=await sbInsert("workflow",rec);if(ins){setWorkflow(w=>[...w,ins]);showToast("✅ Added");return;}}
    setWorkflow(w=>[...w,{...rec,wf_id:Date.now()}]);showToast("✅ Added to workflow");
  }
  // Build a list of human-readable reasons for each flagged category
  function reasonsFor(c){
    const r = [];
    if(c.red>0)         r.push(`${c.red} Red`);
    if(c.orange>0)      r.push(`${c.orange} Orange`);
    if(c.yellow>0)      r.push(`${c.yellow} Yellow`);
    if(c.belowTarget)   r.push(`stock ${c.total} / target ${c.effectiveTarget}`);
    if(c.belowCapacity) r.push(`one or more size buckets below 80% capacity`);
    return r;
  }
  return <div>
    <PT title="Future Purchases" sub="Auto-derived from categories with Red/Orange/Yellow items, below target, or below 80% bucket capacity. Life-safety weighted ×1.5."/>
    {fp.length===0?<Card><p style={{fontSize:14,color:T.muted,textAlign:"center",padding:12}}>No categories need replenishment right now. 🎉</p></Card>:fp.map(c=>{
      const reasons = reasonsFor(c);
      return (
      <Card key={c.cat_id} style={{marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
              <span style={{fontSize:15,fontWeight:600,color:T.white}}>{c.name}</span>
              <span style={{fontSize:12,fontWeight:700,padding:"2px 8px",borderRadius:10,background:c.priority===1?"rgba(192,57,43,0.2)":c.priority===2?"rgba(232,98,26,0.2)":c.priority===3?"rgba(201,168,0,0.2)":"rgba(106,138,106,0.18)",color:c.priority===1?"#ff8a7a":c.priority===2?T.accent:c.priority===3?"#c9a800":T.muted}}>P{c.priority} {["","CRITICAL","HIGH","MEDIUM","STOCK LOW"][c.priority]}</span>
              {c.life_safety&&<span style={{fontSize:10,background:"rgba(192,57,43,0.12)",color:"#ff8a7a",padding:"1px 7px",borderRadius:10,fontWeight:700}}>LIFE SAFETY ×1.5</span>}
            </div>
            <p style={{fontSize:12,color:T.muted,lineHeight:1.6,marginBottom:4}}>
              <span style={{color:"#c0392b",fontWeight:600}}>{c.red} Red</span> · <span style={{color:"#e67e22",fontWeight:600}}>{c.orange} Orange</span> · <span style={{color:"#c9a800",fontWeight:600}}>{c.yellow} Yellow</span> · {c.total} total{c.effectiveTarget?` / target ${c.effectiveTarget}`:""} · {c.pct.toFixed(0)}% ROY · score {c.score}
            </p>
            {reasons.length>0 && (
              <p style={{fontSize:11,color:"#ffaa7a",lineHeight:1.5,marginTop:2}}>
                <strong style={{color:"#ffcc99"}}>Why flagged:</strong> {reasons.join(" · ")}
              </p>
            )}
          </div>
          <div style={{display:"flex",gap:8,flexShrink:0}}>
            {workflow.find(w=>w.cat_id===c.cat_id&&w.workflow_stage!=="entered")?
              <span style={{fontSize:12,color:T.muted,padding:"6px 10px"}}>In workflow ✓</span>:
              <Btn small color={T.accent} onClick={()=>addToWF(c)}>+ Add to Workflow</Btn>}
          </div>
        </div>
      </Card>
    );})}
  </div>;
}

function PurchasingTab({workflow,setWorkflow,prevPurchases,setPrevPurchases,showToast}){
  const [budget,setBudget]=useState(6000);
  const [addModal,setAddModal]=useState(false);
  const [orderModal,setOrderModal]=useState(null); // wf item being ordered
  const [orderSpend,setOrderSpend]=useState("");
  const [newItem,setNewItem]=useState({item:"",priority:3,purchase_type:"operational",estimated_cost:"",notes:""});
  const active=workflow.filter(w=>w.workflow_stage!=="entered");

  async function updWF(id,ch){
    setWorkflow(w=>w.map(x=>x.wf_id===id?{...x,...ch}:x));
    if(hasSupabase())await sbUpdate("workflow",{wf_id:id},ch);
  }

  async function advance(wf,next){
    if(next==="ordered"){setOrderModal(wf);setOrderSpend(wf.estimated_cost||"");return;}
    await updWF(wf.wf_id,{workflow_stage:next});showToast("Stage → "+next);
  }

  async function confirmOrder(){
    const spend=Number(orderSpend)||null;
    const now=new Date().toISOString().slice(0,10);
    await updWF(orderModal.wf_id,{workflow_stage:"ordered",order_date:now,actual_cost:spend});
    // Create prev_purchase record for spending tab
    const prec={item:orderModal.item,purchase_type:orderModal.purchase_type,final_cost:spend,purchase_date:now,supplier:orderModal.quote_supplier||"",new_gear_id:"",notes:orderModal.notes||""};
    if(hasSupabase()){const ins=await sbInsert("prev_purchases",prec);if(ins){setPrevPurchases(p=>[ins,...p]);}}
    else setPrevPurchases(p=>[{...prec,prev_id:Date.now()},...p]);
    showToast("🛒 Ordered — spend recorded in Spending");setOrderModal(null);
  }

  async function addManual(){
    if(!newItem.item.trim())return;
    const rec={...newItem,estimated_cost:Number(newItem.estimated_cost)||null,gear_id:null,cat_id:null,status:"Green",workflow_stage:"pending",quote_amount:null,quote_supplier:null,grant_name:null,grant_applied_date:null,grant_approved_date:null,order_date:null,arrived_date:null,allocated_to:"unallocated"};
    if(hasSupabase()){const ins=await sbInsert("workflow",rec);if(ins){setWorkflow(w=>[ins,...w]);setAddModal(false);showToast("✅ Added");return;}}
    setWorkflow(w=>[{...rec,wf_id:Date.now()},...w]);setAddModal(false);showToast("✅ Added");
  }

  function allocate(){
    let rem=budget;
    setWorkflow(w=>w.map(wf=>{
      if(wf.workflow_stage==="entered")return wf;
      const cost=wf.estimated_cost||0;let at,reason;
      if(wf.priority===1){at="budget";rem-=cost;reason="Critical P1";}
      else if(cost>600&&wf.priority>2){at="grant";reason="Large capital → grant";}
      else if(cost<=rem&&wf.priority<=3){at="budget";rem-=cost;reason="Fits budget";}
      else{at="grant";reason=cost>rem?"Exceeds budget":"Grant preferred";}
      if(hasSupabase())sbUpdate("workflow",{wf_id:wf.wf_id},{allocated_to:at,allocation_reason:reason});
      return {...wf,allocated_to:at,allocation_reason:reason};
    }));
    showToast("🧠 Allocation complete");
  }

  const bs=active.filter(w=>w.allocated_to==="budget").reduce((a,b)=>a+(b.estimated_cost||0),0);
  const gs=active.filter(w=>w.allocated_to==="grant").reduce((a,b)=>a+(b.estimated_cost||0),0);

  return <div>
    {/* Header */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18,flexWrap:"wrap",gap:10}}>
      <PT title="Purchasing Workflow" sub="pending → quoted → grant_applied → grant_approved → ordered → arrived → entered"/>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,background:T.card,border:"1px solid "+T.border,borderRadius:8,padding:"6px 10px"}}>
          <span style={{fontSize:12,color:T.muted}}>Budget NZD</span>
          <input id="wf-budget" type="number" value={budget} onChange={e=>setBudget(Number(e.target.value))} style={{width:80,padding:"3px 6px",fontSize:13}}/>
        </div>
        <Btn small color="#4a80c8" onClick={allocate}>🧠 Smart Allocate</Btn>
        <Btn small color={T.accent} onClick={()=>setAddModal(true)}>+ Add Item</Btn>
      </div>
    </div>

    {/* Budget bars */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12,marginBottom:14}}>
      <Card style={{border:"1px solid rgba(39,174,96,0.28)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <p style={{fontSize:14,fontWeight:600,color:"#27ae60"}}>💰 Budget</p>
          <div style={{textAlign:"right"}}><div style={{fontSize:17,fontWeight:700,color:T.white}}>{nzd(bs)}</div><div style={{fontSize:11,color:T.muted}}>of {nzd(budget)} · {nzd(budget-bs)} left</div></div>
        </div>
        <div style={{height:5,background:"rgba(255,255,255,0.09)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:Math.min((bs/budget)*100,100)+"%",background:bs>budget?"#c0392b":"#27ae60",transition:"width .4s"}}/></div>
      </Card>
      <Card style={{border:"1px solid rgba(74,120,200,0.28)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <p style={{fontSize:14,fontWeight:600,color:"#7ab0ff"}}>🏛 Grant</p>
          <div style={{fontSize:17,fontWeight:700,color:T.white}}>{nzd(gs)}</div>
        </div>
      </Card>
    </div>

    {/* Active items */}
    <Card>
      <p style={{fontSize:14,fontWeight:600,color:T.white,marginBottom:12}}>Active Items ({active.length})</p>
      {active.length===0&&<p style={{fontSize:13,color:T.muted}}>No active items.</p>}
      {[...active].sort((a,b)=>a.priority-b.priority).map(w=>{
        const isGrant=w.purchase_type==="grant";
        const stages=isGrant?["pending","quoted","grant_applied","grant_approved","ordered","arrived","entered"]:["pending","ordered","arrived","entered"];
        const idx=stages.indexOf(w.workflow_stage);const next=idx>=0&&idx<stages.length-1?stages[idx+1]:null;
        return (
          <div key={w.wf_id} style={{padding:"11px 0",borderBottom:"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:220}}>
              <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap",marginBottom:4}}>
                <span style={{fontSize:14,fontWeight:600,color:T.white}}>{w.item}</span>
                <SBadge status={w.status} small/>
                <StgBadge stage={w.workflow_stage}/>
                {w.allocated_to==="budget"&&<span style={{fontSize:9,background:"rgba(39,174,96,0.15)",color:"#27ae60",padding:"1px 6px",borderRadius:10,fontWeight:700}}>BUDGET</span>}
                {w.allocated_to==="grant"&&<span style={{fontSize:9,background:"rgba(74,120,200,0.15)",color:"#7ab0ff",padding:"1px 6px",borderRadius:10,fontWeight:700}}>GRANT</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontSize:12,color:T.muted}}>P{w.priority}</span>
                {/* Inline estimated cost edit */}
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{fontSize:11,color:T.muted}}>Est:</span>
                  <input type="number" placeholder="NZD" value={w.estimated_cost||""} onChange={e=>updWF(w.wf_id,{estimated_cost:Number(e.target.value)||null})}
                    style={{width:80,padding:"2px 6px",fontSize:11,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:5,color:T.text}}/>
                </div>
                {w.order_date&&<span style={{fontSize:11,color:T.muted}}>Ordered {fmtD(w.order_date)}</span>}
                {w.allocation_reason&&<span style={{fontSize:11,color:T.muted,fontStyle:"italic"}}>{w.allocation_reason}</span>}
              </div>
            </div>
            {next&&<Btn small color={next==="ordered"?T.accent:next==="entered"?"#27ae60":"#4a80c8"} onClick={()=>advance(w,next)}>→ {STGC[next]?.label||next}</Btn>}
          </div>
        );
      })}
    </Card>

    {/* Add manual item modal */}
    {addModal&&<Mdl onClose={()=>setAddModal(false)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>Add Workflow Item</div>
        <button onClick={()=>setAddModal(false)} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button>
      </div>
      <FL>Item Description</FL><input id="wf-item" value={newItem.item} onChange={e=>setNewItem(x=>({...x,item:e.target.value}))} placeholder="e.g. Helmet x5"/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
        <div><FL>Priority</FL><select value={newItem.priority} onChange={e=>setNewItem(x=>({...x,priority:Number(e.target.value)}))}>
          <option value={1}>1 — Critical</option><option value={2}>2 — High</option><option value={3}>3 — Medium</option><option value={4}>4 — Low</option>
        </select></div>
        <div><FL>Type</FL><select value={newItem.purchase_type} onChange={e=>setNewItem(x=>({...x,purchase_type:e.target.value}))}>
          <option value="operational">Operational</option><option value="grant">Grant</option>
        </select></div>
        <div><FL>Estimated Cost (NZD)</FL><input type="number" value={newItem.estimated_cost} onChange={e=>setNewItem(x=>({...x,estimated_cost:e.target.value}))}/></div>
      </div>
      <FL>Notes</FL><textarea rows={2} value={newItem.notes} onChange={e=>setNewItem(x=>({...x,notes:e.target.value}))}/>
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn onClick={addManual} color={T.accent} disabled={!newItem.item.trim()}>Add to Workflow</Btn>
        <Btn onClick={()=>setAddModal(false)} outline color={T.muted}>Cancel</Btn>
      </div>
    </Mdl>}

    {/* Order confirmation modal */}
    {orderModal&&<Mdl onClose={()=>setOrderModal(null)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>Mark as Ordered</div>
        <button onClick={()=>setOrderModal(null)} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button>
      </div>
      <p style={{fontSize:14,color:T.white,marginBottom:6}}>{orderModal.item}</p>
      <p style={{fontSize:13,color:T.muted,marginBottom:16,lineHeight:1.6}}>This will record the order date as today and add the spend to the Spending tab.</p>
      <FL>Actual Amount Spent (NZD)</FL>
      <input id="order-spend" type="number" value={orderSpend} onChange={e=>setOrderSpend(e.target.value)} placeholder={orderModal.estimated_cost?"Est: "+orderModal.estimated_cost:"Enter amount"}/>
      <p style={{fontSize:12,color:T.muted,marginTop:6}}>Leave blank to skip — you can add it later in Spending.</p>
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn onClick={confirmOrder} color={T.accent}>Confirm Order</Btn>
        <Btn onClick={()=>setOrderModal(null)} outline color={T.muted}>Cancel</Btn>
      </div>
    </Mdl>}
  </div>;
}

function SpendingTab({prevPurchases,setPrevPurchases,showToast}){
  const [editP,setEditP]=useState(null);
  const monthly=useMemo(()=>{const m={};prevPurchases.forEach(p=>{if(!p.purchase_date)return;const k=p.purchase_date.slice(0,7);if(!m[k])m[k]={month:k,operational:0,grant:0,total:0};if(p.purchase_type==="grant")m[k].grant+=Number(p.final_cost)||0;else m[k].operational+=Number(p.final_cost)||0;m[k].total+=Number(p.final_cost)||0;});return Object.values(m).sort((a,b)=>b.month.localeCompare(a.month));},[prevPurchases]);
  const totOp=prevPurchases.filter(p=>p.purchase_type!=="grant").reduce((a,p)=>a+(Number(p.final_cost)||0),0);
  const totGr=prevPurchases.filter(p=>p.purchase_type==="grant").reduce((a,p)=>a+(Number(p.final_cost)||0),0);

  async function saveSpend(upd){
    setPrevPurchases(p=>p.map(x=>x.prev_id===upd.prev_id?upd:x));
    if(hasSupabase())await sbUpdate("prev_purchases",{prev_id:upd.prev_id},upd);
    showToast("✅ Updated");setEditP(null);
  }

  return <div>
    <PT title="Spending" sub="Historical spend — populated when workflow items are marked Ordered"/>
    <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
      {[["Total",nzd(totOp+totGr),"#7ab0ff"],["Operational",nzd(totOp),"#27ae60"],["Grant",nzd(totGr),"#9b59b6"],["Records",String(prevPurchases.length),"#6a8a6a"]].map(([l,v,c])=>(
        <div key={l} style={{background:T.card,border:"1px solid "+T.border,borderRadius:12,padding:"10px 16px",minWidth:120}}><div style={{fontSize:18,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:12,color:T.muted,marginTop:2}}>{l}</div></div>
      ))}
    </div>
    <Card style={{marginBottom:12}}>
      <p style={{fontSize:14,fontWeight:600,color:T.white,marginBottom:10}}>Monthly Breakdown</p>
      {monthly.length===0?<p style={{fontSize:13,color:T.muted}}>No purchase data yet.</p>:(
        <div className="sx"><table><thead><tr><th>Month</th><th>Operational</th><th>Grant</th><th>Total</th></tr></thead>
          <tbody>{monthly.map(m=>(<tr key={m.month}><td style={{fontWeight:500}}>{m.month}</td><td style={{color:"#27ae60"}}>{nzd(m.operational)}</td><td style={{color:"#9b59b6"}}>{nzd(m.grant)}</td><td style={{fontWeight:700}}>{nzd(m.total)}</td></tr>))}</tbody>
        </table></div>
      )}
    </Card>
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <p style={{fontSize:14,fontWeight:600,color:T.white}}>All Purchases</p>
        <Btn small color="#27ae60" onClick={()=>dlCSV("Spending",prevPurchases)}>⬇ Export CSV</Btn>
      </div>
      <div className="sx"><table><thead><tr><th>Item</th><th>Type</th><th>Cost</th><th>Date</th><th>Supplier</th><th>Edit</th></tr></thead>
        <tbody>{prevPurchases.map(p=>(
          <tr key={p.prev_id}>
            <td style={{fontWeight:500}}>{p.item}</td>
            <td><span style={{fontSize:11,padding:"2px 7px",borderRadius:10,background:p.purchase_type==="grant"?"rgba(155,89,182,0.15)":"rgba(39,174,96,0.15)",color:p.purchase_type==="grant"?"#b47fd1":"#7adf9a",fontWeight:700}}>{p.purchase_type?.toUpperCase()}</span></td>
            <td style={{fontWeight:600}}>{nzd(p.final_cost)}</td>
            <td style={{color:T.muted,fontSize:13}}>{fmtD(p.purchase_date)}</td>
            <td style={{color:T.muted,fontSize:13}}>{p.supplier||"—"}</td>
            <td><button onClick={()=>setEditP({...p})} style={{background:"rgba(255,255,255,0.07)",border:"1px solid "+T.border,color:T.text,borderRadius:6,padding:"3px 8px",fontSize:10,cursor:"pointer"}}>Edit</button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>

    {editP&&<Mdl onClose={()=>setEditP(null)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>Edit Purchase</div>
        <button onClick={()=>setEditP(null)} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button>
      </div>
      <FL>Item</FL><input value={editP.item||""} onChange={e=>setEditP(p=>({...p,item:e.target.value}))}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
        <div><FL>Type</FL><select value={editP.purchase_type} onChange={e=>setEditP(p=>({...p,purchase_type:e.target.value}))}><option value="operational">Operational</option><option value="grant">Grant</option></select></div>
        <div><FL>Final Cost (NZD)</FL><input type="number" value={editP.final_cost||""} onChange={e=>setEditP(p=>({...p,final_cost:Number(e.target.value)}))}/></div>
        <div><FL>Date</FL><input type="date" value={editP.purchase_date||""} onChange={e=>setEditP(p=>({...p,purchase_date:e.target.value}))}/></div>
        <div><FL>Supplier</FL><input value={editP.supplier||""} onChange={e=>setEditP(p=>({...p,supplier:e.target.value}))}/></div>
      </div>
      <FL>Notes</FL><textarea rows={2} value={editP.notes||""} onChange={e=>setEditP(p=>({...p,notes:e.target.value}))}/>
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn onClick={()=>saveSpend(editP)} color={T.accent}>Save</Btn>
        <Btn onClick={()=>setEditP(null)} outline color={T.muted}>Cancel</Btn>
      </div>
    </Mdl>}
  </div>;
}

// ═══ MANAGER — FUEL LOG ═══════════════════════════════════════════════════════
function FuelLogTab({fuelLog,setFuelLog,gear,showToast}){
  const [editF,setEditF]=useState(null);
  async function saveFuel(upd){
    setFuelLog(f=>f.map(x=>x.fuel_id===upd.fuel_id?upd:x));
    if(hasSupabase())await sbUpdate("fuel_log",{fuel_id:upd.fuel_id},upd);
    showToast("✅ Fuel record updated");setEditF(null);
  }
  const byVehicle=useMemo(()=>{
    const m={};
    fuelLog.forEach(f=>{
      if(!m[f.vehicle_gear_id])m[f.vehicle_gear_id]={name:f.vehicle_name,total_litres:0,count:0,last_fill:null};
      m[f.vehicle_gear_id].total_litres+=f.litres_added;
      m[f.vehicle_gear_id].count++;
      if(!m[f.vehicle_gear_id].last_fill||new Date(f.time)>new Date(m[f.vehicle_gear_id].last_fill))m[f.vehicle_gear_id].last_fill=f.time;
    });
    return Object.entries(m).map(([id,v])=>({gear_id:Number(id),...v})).sort((a,b)=>b.total_litres-a.total_litres);
  },[fuelLog]);
  const currentGauge=useMemo(()=>{
    if(fuelLog.length===0)return null;
    return [...fuelLog].sort((a,b)=>new Date(b.time)-new Date(a.time))[0];
  },[fuelLog]);
  const totalLitresAllVehicles=fuelLog.reduce((s,f)=>s+f.litres_added,0);
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:10}}><PT title="Fuel Log" sub="Pump gauge + per-vehicle totals + fill history"/><Btn small color="#27ae60" onClick={()=>dlCSV("FuelLog",fuelLog)}>⬇ Export CSV</Btn></div>
    {/* Hero — current pump gauge */}
    <Card style={{marginBottom:12,background:"linear-gradient(135deg,rgba(155,89,182,0.15),rgba(155,89,182,0.05))",border:"1px solid rgba(155,89,182,0.3)"}}>
      <p style={{fontSize:12,color:T.muted,textTransform:"uppercase",letterSpacing:1.3,marginBottom:6}}>Current Pump Gauge Reading</p>
      {currentGauge?(
        <>
          <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
            <span style={{fontSize:36,fontWeight:700,color:"#b47fd1"}}>{currentGauge.pump_gauge_reading.toFixed(1)}</span>
            <span style={{fontSize:16,color:"#b47fd1"}}>L</span>
          </div>
          <p style={{fontSize:13,color:T.muted,marginTop:4}}>Last fill: {currentGauge.vehicle_name} · {currentGauge.litres_added.toFixed(1)}L · {currentGauge.instructor} · {fmtDT(currentGauge.time)}</p>
        </>
      ):<p style={{fontSize:14,color:T.muted}}>No fills recorded yet.</p>}
    </Card>
    {/* Per-vehicle totals */}
    <Card style={{marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <p style={{fontSize:14,fontWeight:600,color:T.white}}>Total Litres Added per Vehicle</p>
        <p style={{fontSize:13,color:T.muted}}>All vehicles: <strong style={{color:T.white}}>{totalLitresAllVehicles.toFixed(1)}L</strong> across {fuelLog.length} fills</p>
      </div>
      {byVehicle.length===0?<p style={{fontSize:13,color:T.muted}}>No data yet.</p>:byVehicle.map(v=>{
        const pct=totalLitresAllVehicles>0?(v.total_litres/totalLitresAllVehicles)*100:0;
        return (
          <div key={v.gear_id} style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:T.white}}>{v.name}</div>
                <div style={{fontSize:12,color:T.muted,marginTop:2}}>{v.count} fill{v.count!==1?"s":""} · last {fmtD(v.last_fill)}</div>
              </div>
              <div style={{fontSize:17,fontWeight:700,color:"#9b59b6",whiteSpace:"nowrap"}}>{v.total_litres.toFixed(1)}L</div>
            </div>
            <div style={{height:5,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",width:pct+"%",background:"linear-gradient(90deg,#9b59b6,#b47fd1)",borderRadius:3}}/>
            </div>
          </div>
        );
      })}
    </Card>
    {/* History table */}
    <Card>
      <p style={{fontSize:14,fontWeight:600,color:T.white,marginBottom:10}}>Fill History ({fuelLog.length} records)</p>
      <div className="sx"><table>
        <thead><tr><th>ID</th><th>Vehicle</th><th>Litres Added</th><th>Pump Gauge</th><th>Instructor</th><th>Time</th><th>Edit</th></tr></thead>
        <tbody>{[...fuelLog].sort((a,b)=>new Date(b.time)-new Date(a.time)).map(f=>(
          <tr key={f.fuel_id}>
            <td style={{color:T.muted}}>{f.fuel_id}</td>
            <td style={{fontWeight:500}}>{f.vehicle_name}</td>
            <td style={{fontWeight:700,color:"#9b59b6"}}>{f.litres_added.toFixed(1)}L</td>
            <td style={{color:T.white}}>{f.pump_gauge_reading.toFixed(1)}L</td>
            <td>{f.instructor}</td>
            <td style={{color:T.muted,fontSize:13}}>{fmtDT(f.time)}</td>
            <td><button onClick={()=>setEditF({...f})} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",color:T.text,borderRadius:6,padding:"3px 8px",fontSize:10,cursor:"pointer"}}>Edit</button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
    {editF&&<Mdl onClose={()=>setEditF(null)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>Edit Fuel Record</div>
        <button onClick={()=>setEditF(null)} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
        <div><FL>Litres Added</FL><input type="number" step="0.1" value={editF.litres_added||""} onChange={e=>setEditF(f=>({...f,litres_added:Number(e.target.value)}))}/></div>
        <div><FL>Pump Gauge Reading</FL><input type="number" step="0.1" value={editF.pump_gauge_reading||""} onChange={e=>setEditF(f=>({...f,pump_gauge_reading:Number(e.target.value)}))}/></div>
        <div><FL>Instructor</FL><input value={editF.instructor||""} onChange={e=>setEditF(f=>({...f,instructor:e.target.value}))}/></div>
      </div>
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn onClick={()=>saveFuel(editF)} color={T.accent}>Save</Btn>
        <Btn onClick={()=>setEditF(null)} outline color={T.muted}>Cancel</Btn>
      </div>
    </Mdl>}
  </div>;
}

// ═══ MANAGER — RETIRED / EXPORTS / INSTRUCTORS / GO LIVE / SECURITY ═══════════
function RetiredTab({retired,setRetired,setGear,showToast}){
  async function restore(r){
    setGear(g=>[...g,{...r,status:calcStatus(r)}]);
    setRetired(rs=>rs.filter(x=>x.gear_id!==r.gear_id));
    if(hasSupabase()){
      await sbInsert("gear",{...r,status:calcStatus(r)});
      await sbDelete("retired",{gear_id:r.gear_id});
    }
    showToast("↩️ Restored to active gear");
  }
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:10}}><PT title="Retired"/><Btn small color="#27ae60" onClick={()=>dlCSV("Retired",retired)}>⬇ Export CSV</Btn></div>
    <Card>
      <p style={{fontSize:12,color:T.muted,marginBottom:10,padding:"6px 10px",background:"rgba(192,57,43,0.08)",borderRadius:7,border:"1px solid rgba(192,57,43,0.16)"}}>⚠ Retired items archived. Click Restore to bring back.</p>
      <div className="sx"><table><thead><tr><th>ID</th><th>Item</th><th>Status</th><th>Notes</th><th></th></tr></thead>
        <tbody>{retired.map(r=>(<tr key={r.gear_id} style={{opacity:.75}}><td style={{color:T.muted}}>{r.gear_id}</td><td style={{textDecoration:"line-through",color:T.muted}}>{r.item}</td><td><SBadge status={r.status} small/></td><td style={{color:T.muted,fontSize:13}}>{r.notes}</td><td><Btn small outline color="#27ae60" onClick={()=>restore(r)}>Restore</Btn></td></tr>))}</tbody>
      </table></div>
    </Card>
  </div>;
}
function ExportsTab({gear,usage,reports,cats,lists,repairs,retired,prevPurchases,types,locations,fuelLog}){
  const rows=[
    {label:"Gear Inventory",icon:"📦",col:"#27ae60",fn:()=>dlCSV("GearInventory",gear)},
    {label:"Usage Log",icon:"📋",col:"#4a80c8",fn:()=>dlCSV("Usage",usage)},
    {label:"Issue Reports",icon:"⚠",col:"#e67e22",fn:()=>dlCSV("Reports",reports)},
    {label:"Repairs",icon:"🔧",col:"#9b7c0c",fn:()=>dlCSV("Repairs",repairs)},
    {label:"Categories",icon:"⬡",col:"#7ab0ff",fn:()=>dlCSV("Categories",cats)},
    {label:"Item Types",icon:"⚙",col:"#e67e22",fn:()=>dlCSV("ItemTypes",types)},
    {label:"Locations",icon:"📍",col:"#7adf9a",fn:()=>dlCSV("Locations",locations)},
    {label:"Lists",icon:"≡",col:"#b47fd1",fn:()=>dlCSV("Lists",lists.map(l=>({...l,gear_ids:l.gear_ids.join(",")})))},
    {label:"Fuel Log",icon:"⛽",col:"#9b59b6",fn:()=>dlCSV("FuelLog",fuelLog)},
    {label:"Previous Purchases",icon:"💰",col:"#27ae60",fn:()=>dlCSV("PreviousPurchases",prevPurchases)},
    {label:"Retired Gear",icon:"♻",col:"#6a8a6a",fn:()=>dlCSV("Retired",retired)},
  ];
  return <div>
    <PT title="Audit Exports" sub="CSV downloads for audits, compliance, grant applications"/>
    <div style={{display:"grid",gap:10}}>
      {rows.map(ex=>(
        <div key={ex.label} style={{background:T.card,border:"1px solid "+T.border,borderRadius:12,padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",gap:14}}>
          <div style={{display:"flex",gap:12,alignItems:"center"}}><div style={{width:40,height:40,borderRadius:10,background:ex.col+"22",border:"1px solid "+ex.col+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{ex.icon}</div><p style={{fontSize:14,fontWeight:600,color:T.white}}>{ex.label}</p></div>
          <Btn small color={ex.col} onClick={ex.fn}>⬇ Export</Btn>
        </div>
      ))}
    </div>
  </div>;
}
function InstructorsTab({instructors,setInstructors,showToast}){
  const [name,setName]=useState("");const [email,setEmail]=useState("");const [sent,setSent]=useState(null);
  function invite(){if(!name||!email)return;const n={id:"i"+Date.now(),name,email,role:"instructor",status:"pending",joined_date:new Date().toISOString().slice(0,10)};setInstructors(p=>[...p,n]);setSent(n);setName("");setEmail("");showToast("✉️ Invite drafted");}
  return <div>
    <PT title="Instructors" sub="Manage accounts — invite via email"/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12}}>
      <Card>
        <p style={{fontSize:14,fontWeight:600,color:T.white,marginBottom:10}}>Invite New</p>
        {sent&&<div style={{background:"rgba(39,174,96,0.12)",border:"1px solid rgba(39,174,96,0.3)",borderRadius:9,padding:"10px 12px",marginBottom:10,fontSize:13,color:"#7adf9a"}}>✅ Invite drafted for {sent.name}</div>}
        <FL>Name</FL><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Aroha Tane"/>
        <FL>Email</FL><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="e.g. aroha@hillaryoutdoors.co.nz"/>
        <div style={{marginTop:12}}><Btn onClick={invite} disabled={!name||!email} color={T.accent} style={{width:"100%"}}>Send Invite</Btn></div>
      </Card>
      <Card><p style={{fontSize:13,color:T.muted,lineHeight:1.8}}>In production: Supabase Auth sends the invite email, instructor sets password via link, then signs in on any device. Permissions: instructors can scan/sign/report only.</p></Card>
    </div>
    <Card style={{marginTop:12}}>
      <p style={{fontSize:14,fontWeight:600,color:T.white,marginBottom:10}}>Current Instructors ({instructors.length})</p>
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
        <tbody>{instructors.map(i=>(<tr key={i.id}><td style={{fontWeight:500}}>{i.name}</td><td style={{color:T.muted}}>{i.email}</td><td style={{color:T.muted,fontSize:13}}>{i.role}</td><td><span style={{fontSize:11,padding:"2px 7px",borderRadius:10,background:i.status==="active"?"rgba(39,174,96,0.15)":"rgba(212,172,13,0.15)",color:i.status==="active"?"#7adf9a":"#e0c060",fontWeight:700}}>{i.status.toUpperCase()}</span></td><td style={{color:T.muted,fontSize:13}}>{fmtD(i.joined_date)}</td></tr>))}</tbody>
      </table>
    </Card>
  </div>;
}
function GoLiveTab(){
  const steps=[
    {n:"1",col:"#4a80c8",title:"Finalise taxonomy",time:"1 day",body:"Complete the Excel taxonomy (Locations, Categories, Item Types). This becomes seed data."},
    {n:"2",col:"#9b59b6",title:"Run the SQL schema",time:"30 min",body:"Apply 01_schema.sql to your Supabase project — creates all tables + RLS policies."},
    {n:"3",col:"#e67e22",title:"Seed from taxonomy",time:"1-2 days",body:"Import taxonomy → locations, categories, item_types tables. Then batch-enter physical gear."},
    {n:"4",col:"#27ae60",title:"Deploy to Vercel",time:"Half day",body:"Push repo to GitHub, import to Vercel, set env vars (SUPABASE_URL, ANON_KEY). Get live URL."},
    {n:"5",col:"#c0392b",title:"Tag gear (NFC + QR)",time:"1 week",body:"Print/attach NFC stickers ~$1 each · QR labels free · 4000 items ≈ 2 labour days."},
    {n:"6",col:"#6a8a6a",title:"Train team",time:"1-2 hours",body:"Instructor training: scan → behaviour-aware UI tells them exactly what to do. Manager training: walk through dashboard tabs."},
    {n:"7",col:"#27ae60",title:"Go live + monitor",time:"Ongoing",body:"Run alongside current system 2 weeks. Review Future Purchases monthly before budget meetings."},
  ];
  return <div>
    <PT title="Going Live" sub="Steps to turn this prototype into a production system — 2-4 weeks total"/>
    {steps.map(s=>(
      <div key={s.n} style={{display:"flex",gap:14,marginBottom:10,alignItems:"flex-start"}}>
        <div style={{width:36,height:36,borderRadius:"50%",background:s.col+"22",border:"2px solid "+s.col,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:2}}><span style={{fontSize:13,fontWeight:700,color:s.col}}>{s.n}</span></div>
        <Card style={{flex:1}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,gap:10,flexWrap:"wrap"}}><p style={{fontSize:14,fontWeight:600,color:T.white}}>{s.title}</p><span style={{fontSize:12,background:"rgba(255,255,255,0.06)",color:T.muted,padding:"2px 9px",borderRadius:20,whiteSpace:"nowrap"}}>{s.time}</span></div>
          <p style={{fontSize:13,color:T.muted,lineHeight:1.75}}>{s.body}</p>
        </Card>
      </div>
    ))}
  </div>;
}
function SecurityTab(){
  const secs=[
    {cat:"Authentication",icon:"🔐",col:"#4a80c8",points:[["Supabase Auth","Email + password · bcrypt hashing · JWT tokens"],["Enable MFA for managers","TOTP in Supabase · 10 minutes to set up"],["Session expiry","~1hr access tokens · 30d refresh"]]},
    {cat:"Database",icon:"🛡",col:"#27ae60",points:[["Row Level Security","Enable RLS. Instructors INSERT to usage/reports only."],["Keep service role server-side","Never in frontend JS"],["Daily backups","Supabase Pro $40/mo · critical for safety data"]]},
    {cat:"Application",icon:"⚙",col:"#e67e22",points:[["HTTPS everywhere","Vercel auto-SSL"],["Server-side validation","Via Supabase Edge Functions"],["Audit log","usage/reports already are one. Add admin_log for gear edits."]]},
    {cat:"Compliance (NZ)",icon:"📋",col:"#6a8a6a",points:[["Privacy Act 2020","2-5yr retention common"],["HSWA 2015","Red hard-stop + usage audit trail support HSWA"],["GDPR","EU residents → AWS EU region in Supabase"]]},
  ];
  return <div>
    <PT title="Cybersecurity"/>
    {secs.map(s=>(
      <Card key={s.cat} style={{marginBottom:12,border:"1px solid "+s.col+"33"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}><span style={{fontSize:20}}>{s.icon}</span><p style={{fontSize:15,fontWeight:700,color:s.col}}>{s.cat}</p></div>
        {s.points.map(([title,body])=>(<div key={title} style={{marginBottom:10,paddingLeft:10,borderLeft:"2px solid "+s.col+"44"}}><p style={{fontSize:14,fontWeight:600,color:T.white,marginBottom:2}}>{title}</p><p style={{fontSize:13,color:T.muted,lineHeight:1.75}}>{body}</p></div>))}
      </Card>
    ))}
  </div>;
}

// ═══ DETAIL MODAL ═════════════════════════════════════════════════════════════
function DetailModal({itemType,item,onClose,gear,types,cats,setGear,showToast}){
  const [edit,setEdit]=useState({...item});
  function upd(k,v){setEdit(e=>({...e,[k]:v}));}
  function saveGear(){setGear(g=>g.map(x=>x.gear_id===item.gear_id?{...edit,status:calcStatus(edit)}:x));showToast("✅ Updated");onClose();}
  if(itemType==="gear"){
    const type=types.find(t=>t.type_id===item.type_id);
    return <Mdl onClose={onClose}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>{item.item}</div><button onClick={onClose} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button></div>
      <KV label="ID" value={item.gear_id}/>
      <KV label="Serial" value={item.physical_serial||"—"}/>
      <KV label="QR" value={item.qr_code||"—"}/>
      <KV label="NFC" value={item.nfc_tag||"—"}/>
      {type&&<KV label="Kind" value={type.name}/>}
      <KV label="Behaviour" value={<BhBadge behaviour={behaviourOf(item,cats)} small/>}/>
      {item.size&&<KV label="Size" value={item.size}/>}
      <KV label="Status" value={<SBadge status={item.status} small/>}/>
      <FL>Location</FL><input value={edit.location} onChange={e=>upd("location",e.target.value)}/>
      <FL>Expiry</FL><input type="date" value={edit.expiry||""} onChange={e=>upd("expiry",e.target.value)}/>
      <FL>Uses</FL><input type="number" value={edit.number_of_uses} onChange={e=>upd("number_of_uses",Number(e.target.value))}/>
      <FL>Notes</FL><textarea rows={2} value={edit.notes||""} onChange={e=>upd("notes",e.target.value)}/>
      <div style={{marginTop:14}}><Btn onClick={saveGear} color={T.accent}>Save Changes</Btn></div>
    </Mdl>;
  }
  if(itemType==="report"){
    return <Mdl onClose={onClose}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>Report {item.report_id}</div><button onClick={onClose} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button></div>
      <KV label="Item" value={item.item}/><KV label="Gear ID" value={item.gear_id}/><KV label="Status" value={<SBadge status={item.status} small/>}/><KV label="Instructor" value={item.instructor}/><KV label="Reported" value={fmtDT(item.time_reported)}/><KV label="Notes" value={item.notes}/>
    </Mdl>;
  }
  if(itemType==="usage"){
    return <Mdl onClose={onClose}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.white}}>Usage {item.usage_id}</div><button onClick={onClose} style={{background:"none",border:"none",color:T.muted,fontSize:22}}>×</button></div>
      <KV label="Item" value={item.item}/><KV label="Gear ID" value={item.gear_id||"—"}/><KV label="Action" value={item.signed_in_out}/><KV label="Out" value={fmtDT(item.time_out)}/><KV label="In" value={fmtDT(item.time_in)}/><KV label="Instructor" value={item.instructor}/>
    </Mdl>;
  }
  return null;
}

// ═══ DASHBOARD SHELL ══════════════════════════════════════════════════════════
function Dashboard(props){
  const [tab,setTab]=useState("overview");const [open,setOpen]=useState(true);const [detail,setDetail]=useState(null);
  const prefilledTypeId=null; // deprecated — types tab now shows behaviour summary
  function handleQuickAdd(){setTab("addgear");}
  function openDetail(type,item){setDetail({type,item});}function closeDetail(){setDetail(null);}
  const activePurch=props.workflow.filter(w=>w.workflow_stage!=="entered").length;
  const openRepairs=props.repairs.filter(r=>r.status==="open").length;
  const fp=useMemo(()=>calcFuturePurchases(props.cats,props.gear),[props.cats,props.gear]);
  const TABS=[
    {id:"overview",l:"Dashboard",ico:"◈"},
    {id:"gear",l:"Gear List",ico:"☰"},
    {id:"addgear",l:"Add Gear",ico:"+"},
    {id:"categories",l:"Categories",ico:"⬡",badge:fp.length>0?fp.length:null},
    {id:"types",l:"Item Behaviour",ico:"⚙"},
    {id:"sized",l:"Sized Pool",ico:"▦"},
    {id:"locations",l:"Locations",ico:"📍"},
    {id:"lists",l:"Lists",ico:"≡"},
    {id:"usage",l:"Usage Log",ico:"↕"},
    {id:"reports",l:"Reports",ico:"⚠"},
    {id:"repairs",l:"Repairs",ico:"🔧",badge:openRepairs>0?openRepairs:null},
    {id:"future",l:"Future Purchases",ico:"◉",badge:fp.length>0?fp.length:null},
    {id:"purchasing",l:"Workflow",ico:"$",badge:activePurch>0?activePurch:null},
    {id:"spending",l:"Spending",ico:"📈"},
    {id:"fuel",l:"Fuel Log",ico:"⛽"},
    {id:"retired",l:"Retired",ico:"✕"},
    {id:"exports",l:"Exports",ico:"⬇"},
    {id:"instructors",l:"Instructors",ico:"👤"},
    {id:"golive",l:"Go Live",ico:"🚀"},
    {id:"security",l:"Security",ico:"🔐"},
  ];
  return <div style={{display:"flex",height:"100vh",overflow:"hidden"}}>
    <div className="sb" style={{width:open?215:46,background:"rgba(0,0,0,0.32)",borderRight:"1px solid "+T.border,display:"flex",flexDirection:"column",position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{position:"absolute",top:14,right:-15,zIndex:20,width:30,height:30,borderRadius:"50%",background:"#1a3a1a",border:"1px solid "+T.border,color:T.text,fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 8px rgba(0,0,0,0.5)"}}>{open?"‹":"›"}</button>
      {open&&<div style={{padding:"18px 18px 15px",borderBottom:"1px solid "+T.border}}><div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:900,color:T.white}}>HILLARY</div><div style={{fontSize:9,letterSpacing:5,color:T.muted,textTransform:"uppercase"}}>OUTDOORS</div></div>}
      <nav style={{flex:1,padding:"10px 0",overflowY:"auto",overflowX:"hidden"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} title={!open?t.l:undefined} style={{display:"flex",width:"100%",textAlign:"left",padding:open?"8px 18px":"8px 0",justifyContent:open?"space-between":"center",background:tab===t.id?"rgba(255,255,255,0.08)":"none",border:"none",borderLeft:open&&tab===t.id?"3px solid "+T.accent:"3px solid transparent",color:tab===t.id?T.white:T.muted,fontSize:12,fontWeight:tab===t.id?600:400,alignItems:"center",overflow:"hidden",whiteSpace:"nowrap"}}>
            {open?(<span style={{display:"flex",justifyContent:"space-between",width:"100%",alignItems:"center"}}><span>{t.l}</span>{t.badge&&<span style={{background:T.accent,color:"#fff",borderRadius:10,padding:"0 6px",fontSize:10,fontWeight:700}}>{t.badge}</span>}</span>):(<div style={{position:"relative",width:24,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:13}}>{t.ico}</span>{t.badge&&<span style={{position:"absolute",top:-4,right:-4,background:T.accent,color:"#fff",borderRadius:"50%",width:12,height:12,fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{t.badge}</span>}</div>)}
          </button>
        ))}
      </nav>
      {open&&<div style={{padding:"10px 18px",fontSize:11,color:T.muted}}>Manager View</div>}
    </div>
    <div style={{flex:1,overflow:"auto",padding:24}}>
      {tab==="overview"    && <OverviewTab        gear={props.gear} cats={props.cats} reports={props.reports} openDetail={openDetail} onOpenGearFiltered={props.onOpenGearFiltered}/>}
      {tab==="gear"        && <GearListTab        gear={props.gear} setGear={props.setGear} cats={props.cats} types={props.cats} openDetail={openDetail} showToast={props.showToast} initialFilter={props.gearFilter?.status}/>}
      {tab==="addgear"     && <GearEntry types={props.cats} cats={props.cats} locations={props.locations} gear={props.gear} onAdd={async items=>{
  // DB-first ordering: previous version inserted to local React state then
  // tried DB and silently swallowed errors. Result was the "phantom row"
  // bug — the row showed in the UI until refresh, then disappeared because
  // the DB never accepted it (sequence drift, RLS, CHECK violation etc).
  // Now we let the DB allocate gear_id and only update local state from
  // the rows it returned successfully.
  if(!hasSupabase()){
    props.setGear(g=>[...g,...items]);
    return;
  }
  const inserted = [];
  const failed = [];
  for(const item of items){
    // Strip client-only fields AND the client-side gear_id so the DB
    // sequence allocates a fresh, conflict-free one.
    const {type_id:_tid, gear_id:_gid, ...dbRow} = item;
    const ins = await sbInsert("gear", dbRow);
    if(ins) inserted.push(ins);
    else    failed.push(item.item || "(unnamed)");
  }
  if(inserted.length){
    props.setGear(g=>[...g, ...inserted]);
  }
  if(failed.length){
    props.showToast(`❌ ${failed.length} of ${items.length} not saved — see console (most likely a duplicate serial/QR/NFC, missing category, or DB constraint)`);
    console.error("Failed gear inserts:", failed);
  } else if(inserted.length){
    // Success toast is normally fired by the form itself; we only override
    // when there were partial failures.
  }
}} showToast={props.showToast} prefilledTypeId={prefilledTypeId} onPrefillConsumed={()=>setPrefilledTypeId(null)}/>}
      {tab==="categories"  && <CategoriesTab      cats={props.cats} setCats={props.setCats} gear={props.gear} showToast={props.showToast}/>}
      {tab==="types"       && <ItemTypesTab       cats={props.cats} setCats={props.setCats} gear={props.gear} showToast={props.showToast}/>}
      {tab==="sized"       && <SizedPoolTab       gear={props.gear} setGear={props.setGear} cats={props.cats} showToast={props.showToast}/>}
      {tab==="locations"   && <LocationsTab      gear={props.gear} setGear={props.setGear} locations={props.locations} setLocations={props.setLocations} showToast={props.showToast}/>}
      {tab==="lists"       && <ListsTab           lists={props.lists} setLists={props.setLists} gear={props.gear} cats={props.cats} showToast={props.showToast}/>}
      {tab==="usage"       && <UsageTab           usage={props.usage} setUsage={props.setUsage} gear={props.gear} showToast={props.showToast}/>}
      {tab==="reports"     && <ReportsTab         reports={props.reports} setReports={props.setReports} gear={props.gear} setGear={props.setGear} showToast={props.showToast}/>}
      {tab==="repairs"     && <RepairsTab         repairs={props.repairs} setRepairs={props.setRepairs} showToast={props.showToast}/>}
      {tab==="future"      && <FuturePurchasesTab cats={props.cats} gear={props.gear} workflow={props.workflow} setWorkflow={props.setWorkflow} showToast={props.showToast}/>}
      {tab==="purchasing"  && <PurchasingTab      workflow={props.workflow} setWorkflow={props.setWorkflow} prevPurchases={props.prevPurchases} setPrevPurchases={props.setPrevPurchases} showToast={props.showToast}/>}
      {tab==="spending"    && <SpendingTab        prevPurchases={props.prevPurchases} setPrevPurchases={props.setPrevPurchases} showToast={props.showToast}/>}
      {tab==="fuel"        && <FuelLogTab         fuelLog={props.fuelLog} setFuelLog={props.setFuelLog} gear={props.gear} showToast={props.showToast}/>}
      {tab==="retired"     && <RetiredTab         retired={props.retired} setRetired={props.setRetired} setGear={props.setGear} showToast={props.showToast}/>}
      {tab==="exports"     && <ExportsTab         gear={props.gear} usage={props.usage} reports={props.reports} cats={props.cats} lists={props.lists} repairs={props.repairs} retired={props.retired} prevPurchases={props.prevPurchases} types={props.cats} locations={props.locations} fuelLog={props.fuelLog}/>}
      {tab==="instructors" && <InstructorsTab     instructors={props.instructors} setInstructors={props.setInstructors} showToast={props.showToast}/>}
      {tab==="golive"      && <GoLiveTab/>}
      {tab==="security"    && <SecurityTab/>}
    </div>
    {detail && <DetailModal itemType={detail.type} item={detail.item} onClose={closeDetail} gear={props.gear} types={props.cats} cats={props.cats} setGear={props.setGear} showToast={props.showToast}/>}
  </div>;
}

// ═══ APP ROOT ═════════════════════════════════════════════════════════════════
export default function App(){
  const [session,setSession]=useState(null);
  const [currentUser,setCurrentUser]=useState(null);
  const [view,setView]=useState("scan");
  const [dbReady,setDbReady]=useState(false);
  const [loading,setLoading]=useState(false);

  // ── State ─────────────────────────────────────────────────────────────────
  const [locations,setLocations]=useState(INIT_LOCATIONS);
  const [cats,setCats]=useState(INIT_CATEGORIES);
  const [gear,setGear]=useState(INIT_GEAR);
  const [lists,setLists]=useState(INIT_LISTS);
  const [usage,setUsage]=useState(INIT_USAGE);
  const [reports,setReports]=useState(INIT_REPORTS);
  const [repairs,setRepairs]=useState(INIT_REPAIRS);
  const [workflow,setWorkflow]=useState(INIT_WORKFLOW);
  const [prevPurchases,setPrevPurchases]=useState(INIT_PREV);
  const [retired,setRetired]=useState(INIT_RETIRED);
  const [fuelLog,setFuelLog]=useState(INIT_FUEL_LOG);
  const [instructors,setInstructors]=useState(INIT_INSTRUCTORS);

  // types is derived from cats — each cat acts as its own "type". For
  // sized_pool categories we derive `sizes` from existing gear rows so the
  // GearEntry / SizedPoolScreen can show the right size selector. Sizes are
  // returned in canonical clothing/footwear order via the inline sort key
  // below. We INLINE the sort key here (instead of calling sizeSortKey from
  // outside the component) so production bundlers can't re-order this useMemo
  // ahead of the helper's initialization (TDZ trap that caused the v18 blank
  // screen on Vercel).
  const types = useMemo(() => {
    const SIZE_ORDER_LOCAL = {
      "6XS":10,"5XS":20,"4XS":30,"3XS":40,"2XS":50,
      "XS":60,"S":70,"M":80,"L":90,"XL":100,
      "2XL":110,"3XL":120,"4XL":130,"5XL":140,"6XL":150,
    };
    const sortKey = (sz) => {
      if (!sz) return 9999;
      const u = String(sz).trim().toUpperCase();
      if (SIZE_ORDER_LOCAL[u] != null) return SIZE_ORDER_LOCAL[u];
      const m = u.match(/^(\d+(?:\.\d+)?)/);
      if (m) return 200 + parseFloat(m[1]) * 10;
      return 9999;
    };
    return cats.map(c => {
      const sizes = c.behaviour === "sized_pool"
        ? [...new Set(gear.filter(g => g.category_id === c.cat_id && g.size).map(g => g.size))]
            .sort((a, b) => sortKey(a) - sortKey(b))
        : null;
      return {
        ...c,
        type_id: c.cat_id,
        category_id: c.cat_id,
        home_location: c.description || "",
        behaviour: c.behaviour || "signable",
        life_safety: c.life_safety || false,
        sizes,
        sized_categories: null,
      };
    });
  }, [cats, gear]);

  const [selected,setSelected]=useState(null);
  const [flowCtx,setFlowCtx]=useState(null);
  const [fromQuick,setFromQuick]=useState(false);
  const [toast,setToast]=useState("");
  const [lastAct,setLastAct]=useState(null);
  const [saving,setSaving]=useState(false);
  const [gearFilter,setGearFilter]=useState(null); // {status} for overview tap-through
  const usageRef=useRef(6000);const reportRef=useRef(9100);const fuelRef=useRef(8100);const repRef=useRef(200);

  function showToast(m){setToast(m);setTimeout(()=>setToast(""),2800);}
  function go(v){setView(v);}

  // ── Load all data from Supabase ──────────────────────────────────────────
  async function loadAll(){
    if(!hasSupabase()){setDbReady(true);return;}
    setLoading(true);
    try {
      // Fetch all tables in parallel
      const [gearData,catsData,usageData,reportsData,repairsData,
             workflowData,prevData,retiredData,listsData,listGearData,
             fuelData,profilesData,locationsData] = await Promise.all([
        sbGet("gear"), sbGet("categories"), sbGet("usage"), sbGet("reports"),
        sbGet("repairs"), sbGet("workflow"), sbGet("prev_purchases"),
        sbGet("retired"), sbGet("lists"), sbGet("list_gear"),
        sbGet("fuel_log"), sbGet("profiles"), sbGet("locations")
      ]);

      if(gearData){
        setGear(gearData.map(g=>({
          ...g,
          size: g.size||null,
          physical_serial: g.physical_serial||null,
          expiry: g.expiry||null,
          notes: g.notes||"",
          // Preserve v18 columns even when DB doesn't return them yet
          is_pool_bucket: Boolean(g.is_pool_bucket),
          pool_count:    g.pool_count    ?? null,
          pool_capacity: g.pool_capacity ?? null,
          set_size:      g.set_size      ?? null,
        })));
      }
      if(catsData){
        setCats(catsData.map(c=>({
          ...c,
          active: true,
          life_safety: Boolean(c.life_safety),
          behaviour: c.behaviour||"signable",
          sized_pool_style: c.sized_pool_style || (c.behaviour==="sized_pool"?"individual":null),
          budget_owner: c.budget_owner||null,
          description: c.description||"",
        })));
      }
      if(usageData)    setUsage(usageData);
      if(reportsData)  setReports(reportsData.map(r=>({...r,resolved:r.resolved||false})));
      if(repairsData)  setRepairs(repairsData);
      if(workflowData) setWorkflow(workflowData.map(w=>({...w,
        allocation_reason: w.allocation_reason||"",
        allocated_to: w.allocated_to||"unallocated",
      })));
      if(prevData)     setPrevPurchases(prevData);
      if(retiredData)  setRetired(retiredData);

      // Build lists with gear_ids from list_gear join table
      if(listsData){
        const lgMap={};
        (listGearData||[]).forEach(lg=>{
          if(!lgMap[lg.list_id])lgMap[lg.list_id]=[];
          lgMap[lg.list_id].push(lg.gear_id);
        });
        setLists(listsData.map(l=>({
          ...l,
          gear_ids:lgMap[l.list_id]||[],
          behaviour: l.behaviour || null,
        })));
      }

      if(fuelData)     setFuelLog(fuelData);
      if(profilesData) setInstructors(profilesData.map(p=>({
        ...p, id:p.id, role:p.role||"instructor", status:p.status||"active"
      })));
      // Locations table — only loads after migrations.sql + data_cleanup.sql
      if(locationsData) setLocations(locationsData.map(l=>({
        ...l, active: l.active!==false
      })));

      setDbReady(true);
      console.log("✅ Loaded from Supabase");
    } catch(e) {
      console.error("loadAll error",e);
      setDbReady(true);
    }
    setLoading(false);
  }

  // ── Auth + initial load ──────────────────────────────────────────────────
  useEffect(()=>{
    if(!hasSupabase()){setDbReady(true);return;}

    // Check for existing valid session
    supabase.auth.getSession().then(async ({data:{session},error})=>{
      if(error||!session){
        // Clear any stale tokens — this fixes the "Invalid Refresh Token" error
        await supabase.auth.signOut().catch(()=>{});
        setDbReady(true);
        return;
      }
      // Valid session — fetch profile and load data
      const {data:profile}=await supabase
        .from("profiles").select("role,name").eq("id",session.user.id).single();
      const role=profile?.role||"instructor";
      const name=profile?.name||session.user.email?.split("@")[0]||"User";
      setSession(role);
      setCurrentUser({id:session.user.id,name,email:session.user.email,role});
      loadAll();
    });

    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
      if(!session){setSession(null);setCurrentUser(null);setDbReady(true);}
    });
    return ()=>subscription.unsubscribe();
  },[]);

  function handleLogin(role, userObj){
    setSession(role);
    setCurrentUser(userObj || (role==="manager"?{name:"Manager",role}:{name:"Staff",role}));
    loadAll();
    go(role==="manager"?"dashboard":"scan");
  }
  async function handleLogout(){
    if(hasSupabase()) await supabase.auth.signOut();
    setSession(null);setCurrentUser(null);go("scan");
  }

  // ── Scan routing ─────────────────────────────────────────────────────────
  function handleScanResult(kind,payload){
    if(kind==="gear"){
      let g=gear.find(x=>x.gear_id===payload);
      if(!g&&typeof payload==="string")g=gear.find(x=>x.physical_serial===payload||x.nfc_tag===payload||x.qr_code===payload);
      if(!g){showToast("⚠ Not found");return;}
      const bh=behaviourOf(g,cats);setSelected(g);
      if(bh==="monitored_only")go("monitoredDetail");
      else if(bh==="fuel")go("fuelLog");
      else if(bh==="sized_pool"&&g.is_pool_bucket){
        // Bucket row scan → go to that category's sized pool grid
        const cat = cats.find(c=>c.cat_id===g.category_id);
        if(cat){setFlowCtx({type:cat});go("sized");return;}
      }
      else go("detail");
    }
    else if(kind==="type"){
      // Tag attached to a sized_pool CATEGORY (lets you scan one tag for "all PFDs", etc.)
      // Resolution order: match nfc_tag → match qr_code → match cat_id literal.
      const t = cats.find(c => c.nfc_tag===payload || c.qr_code===payload || c.cat_id===payload);
      if(!t){showToast("⚠ Category tag not recognised: "+payload);return;}
      if(t.behaviour!=="sized_pool"){
        // Non-sized-pool category tags are useful too — e.g. signable category
        // tags could open a "list all gear of this category" view. For now we
        // route them to the gear list filtered to that cat, by stashing the
        // filter in flowCtx and going to the manager dashboard.
        showToast(t.behaviour+" category tags aren't yet wired — for now, scan a specific item.");return;
      }
      setFlowCtx({type:t});go("sized");
    }
    else if(kind==="list"){
      const l=lists.find(x=>x.list_id===payload);
      if(!l){showToast("⚠ List not found");return;}
      setFlowCtx({list:l});
      // Route by the list's locked behaviour. Lists are single-behaviour by design.
      const bh = l.behaviour || "signable";
      if(bh==="fuel")        go("fuelLog");
      else if(bh==="sized_pool"){
        // Find the category these gear items belong to
        const firstG = (l.gear_ids||[]).map(id=>gear.find(g=>g.gear_id===id)).find(Boolean);
        if(firstG){
          const cat = cats.find(c=>c.cat_id===firstG.category_id);
          if(cat){setFlowCtx({type:cat,list:l});go("sized");return;}
        }
        go("list");
      }
      else go("list");
    }
    else if(kind==="notfound"){showToast("⚠ Tag not recognised: "+payload);}
  }

  // ── Sign in/out (with Supabase) ──────────────────────────────────────────
  async function doSignIn(g){
    if(g.signed_in_out==="IN"){showToast("⚠ Already in");return;}
    setGear(gg=>gg.map(x=>x.gear_id===g.gear_id?{...x,signed_in_out:"IN"}:x));
    setUsage(u=>u.map(x=>x.gear_id===g.gear_id&&x.signed_in_out==="OUT"&&!x.time_in?{...x,time_in:new Date().toISOString()}:x));
    showToast("✅ "+g.item+" signed in");
    if(hasSupabase()){
      await sbUpdate("gear",{gear_id:g.gear_id},{signed_in_out:"IN"});
      // Update the open usage record
      const rec=usage.find(u=>u.gear_id===g.gear_id&&u.signed_in_out==="OUT"&&!u.time_in);
      if(rec)await sbUpdate("usage",{usage_id:rec.usage_id},{time_in:new Date().toISOString(),signed_in_out:"IN"});
    }
  }
  async function doSignOut(g){
    if(g.status==="Red"){showToast("⛔ Red — cannot sign out");return;}
    if(g.status==="YellowRepair"){showToast("🔧 Repair — cannot sign out");return;}
    if(g.signed_in_out==="OUT"){showToast("⚠ Already out");return;}
    const nu=g.number_of_uses+1;const ns=calcStatus({...g,number_of_uses:nu});
    setGear(gg=>gg.map(x=>x.gear_id===g.gear_id?{...x,signed_in_out:"OUT",number_of_uses:nu,status:ns}:x));
    const uRec={item:g.item,gear_id:g.gear_id,list_id:null,signed_in_out:"OUT",time_out:new Date().toISOString(),time_in:null,instructor:currentUser.name,use_number_on_item:nu};
    if(hasSupabase()){
      await sbUpdate("gear",{gear_id:g.gear_id},{signed_in_out:"OUT",number_of_uses:nu,status:ns});
      const inserted=await sbInsert("usage",uRec);
      if(inserted)setUsage(u=>[...u,inserted]);
    } else {
      setUsage(u=>[...u,{...uRec,usage_id:usageRef.current++}]);
    }
    showToast("✅ "+g.item+" signed out");
  }
  function handleSignOut(){const n=Date.now();if(lastAct&&n-lastAct<3000){showToast("⏳ Wait 3s");return;}doSignOut(selected);setLastAct(n);go("scan");}
  function handleSignIn(){const n=Date.now();if(lastAct&&n-lastAct<3000){showToast("⏳ Wait 3s");return;}doSignIn(selected);setLastAct(n);go("scan");}

  // ── Report ────────────────────────────────────────────────────────────────
  async function handleReport(status,notes){
    setSaving(true);const g=selected;
    const rRec={item:g.item,gear_id:g.gear_id,status,notes,instructor:currentUser.name,time_reported:new Date().toISOString()};
    setGear(gg=>gg.map(x=>x.gear_id===g.gear_id?{...x,status,notes}:x));
    let savedReport={...rRec,report_id:reportRef.current++};
    if(hasSupabase()){
      const ins=await sbInsert("reports",rRec);
      if(ins)savedReport=ins;
      await sbUpdate("gear",{gear_id:g.gear_id},{status,notes});
    }
    setReports(rs=>[...rs,savedReport]);
    if(status==="YellowRepair"){
      const rep={gear_id:g.gear_id,item:g.item,report_id:savedReport.report_id,status:"open",assigned_to:null,notes,date_reported:new Date().toISOString().slice(0,10),date_completed:null};
      if(hasSupabase()){
        const ins=await sbInsert("repairs",rep);
        if(ins)setRepairs(rs=>[...rs,ins]);
      } else {
        setRepairs(rs=>[...rs,{...rep,repair_id:"REP"+String(repRef.current++).padStart(3,"0")}]);
      }
    }
    if(fromQuick){await doSignIn(g);setFromQuick(false);}
    setSaving(false);showToast("📋 Report — "+status);go("scan");
  }

  // ── Sized pool sign-out ───────────────────────────────────────────────────
  async function handleSizedSubmit(qtyBySize){
    const type = flowCtx.type;
    const isBucket = type.sized_pool_style === "bucket";
    const ts = new Date().toISOString();

    if(isBucket){
      // ── BUCKET: decrement pool_count on the bucket row for each size ──
      const updates = [];
      let totalUnits = 0;
      for(const [size, n] of Object.entries(qtyBySize)){
        if(!n || n<=0) continue;
        const bucket = gear.find(g => g.category_id===type.cat_id && g.size===size && g.is_pool_bucket);
        if(!bucket){showToast(`⚠ No bucket for size ${size}`);continue;}
        const cur = Number(bucket.pool_count)||0;
        if(n > cur){showToast(`⚠ Only ${cur} ${size} available`);continue;}
        const newCount = cur - n;
        updates.push({bucket, n, newCount, size});
        totalUnits += n;
      }
      if(totalUnits===0){showToast("⚠ None selected");return;}
      // Apply locally
      setGear(gg => gg.map(x => {
        const u = updates.find(u=>u.bucket.gear_id===x.gear_id);
        return u ? {...x, pool_count: u.newCount} : x;
      }));
      // Log a usage row per size (one row, with quantity in use_number_on_item)
      const uRecs = updates.map(u=>({
        item: type.name+" — "+u.size+" × "+u.n,
        gear_id: u.bucket.gear_id,
        list_id: flowCtx.list?.list_id || null,
        signed_in_out: "OUT",
        time_out: ts, time_in: null,
        instructor: currentUser.name,
        use_number_on_item: u.n,
      }));
      if(hasSupabase()){
        for(const u of updates) await sbUpdate("gear",{gear_id:u.bucket.gear_id},{pool_count:u.newCount});
        for(const r of uRecs){ const ins=await sbInsert("usage",r); if(ins) setUsage(prev=>[...prev, ins]); }
      } else {
        setUsage(u=>[...u, ...uRecs.map(r=>({...r, usage_id: usageRef.current++}))]);
      }
      showToast(`✅ ${totalUnits} ${type.name} signed out`); go("scan");
      return;
    }

    // ── INDIVIDUAL: pick the first N IN-stock items per size and sign out ──
    const picks=[];
    Object.entries(qtyBySize).forEach(([size,n])=>{
      if(n>0){
        const pool = gear.filter(g=>g.category_id===type.cat_id && g.size===size && g.signed_in_out==="IN" && g.status!=="Red" && g.status!=="YellowRepair");
        pool.slice(0,n).forEach(g=>picks.push(g));
      }
    });
    if(picks.length===0){showToast("⚠ None selected");return;}
    setGear(gg=>gg.map(x=>picks.find(p=>p.gear_id===x.gear_id)?{...x,signed_in_out:"OUT",number_of_uses:(x.number_of_uses||0)+1}:x));
    const uRecs=picks.map(p=>({item:p.item+" ("+p.size+")",gear_id:p.gear_id,list_id:flowCtx.list?.list_id||null,signed_in_out:"OUT",time_out:ts,time_in:null,instructor:currentUser.name,use_number_on_item:(p.number_of_uses||0)+1}));
    if(hasSupabase()){
      for(const p of picks) await sbUpdate("gear",{gear_id:p.gear_id},{signed_in_out:"OUT",number_of_uses:(p.number_of_uses||0)+1});
      for(const u of uRecs){const ins=await sbInsert("usage",u);if(ins)setUsage(prev=>[...prev,ins]);}
    } else {
      setUsage(u=>[...u,...uRecs.map(r=>({...r,usage_id:usageRef.current++}))]);
    }
    showToast("✅ "+picks.length+" "+type.name+" signed out");go("scan");
  }

  // ── Sized pool damage report — same UI as sign-out, but reduces both
  //     pool_count AND pool_capacity (items are gone for good), and writes
  //     a report row so the manager sees it.
  async function handleSizedDamage(qtyBySize){
    const type = flowCtx.type;
    if (type.sized_pool_style !== 'bucket') {
      showToast('Damage path is bucket-only here. For individual items, use the gear detail screen.');
      return;
    }
    const ts = new Date().toISOString();
    const updates = [];
    let totalUnits = 0;
    for (const [size, n] of Object.entries(qtyBySize)) {
      if (!n || n <= 0) continue;
      const bucket = gear.find(g => g.category_id === type.cat_id && g.size === size && g.is_pool_bucket);
      if (!bucket) { showToast(`⚠ No bucket for size ${size}`); continue; }
      const cur = Number(bucket.pool_count) || 0;
      const cap = Number(bucket.pool_capacity) || 0;
      if (n > cur) { showToast(`⚠ Only ${cur} ${size} in stock`); continue; }
      updates.push({ bucket, size, n, newCount: cur - n, newCap: Math.max(0, cap - n) });
      totalUnits += n;
    }
    if (totalUnits === 0) { showToast('⚠ None selected'); return; }
    if (!confirm(`Mark ${totalUnits} ${type.name} as damaged or lost?\n\nThis reduces both stock and capacity. The items are gone for good. A report is created for the manager.`)) return;

    setGear(gs => gs.map(x => {
      const u = updates.find(u => u.bucket.gear_id === x.gear_id);
      return u ? { ...x, pool_count: u.newCount, pool_capacity: u.newCap } : x;
    }));

    const reportRows = updates.map(u => ({
      item: `${u.n}× ${type.name} ${u.size} reported damaged/lost`,
      gear_id: u.bucket.gear_id,
      status: 'Red',
      notes: `${currentUser.name} reported ${u.n} item(s) of size ${u.size} damaged or lost. Pool count and capacity each reduced by ${u.n}.`,
      instructor: currentUser.name,
      time_reported: ts,
      resolved: false,
    }));

    if (hasSupabase()) {
      for (const u of updates) {
        await sbUpdate('gear', { gear_id: u.bucket.gear_id }, { pool_count: u.newCount, pool_capacity: u.newCap });
      }
      for (const r of reportRows) {
        const ins = await sbInsert('reports', r);
        if (ins) setReports(prev => [...prev, ins]);
      }
    } else {
      setReports(prev => [...prev, ...reportRows.map(r => ({ ...r, report_id: Date.now() + Math.random() }))]);
    }
    showToast(`⚠ ${totalUnits} reported damaged — capacity reduced`);
    go('scan');
  }

  // ── List checkout ──────────────────────────────────────────────────────────
  async function handleListSignOut(gearIds){
    setGear(gg=>gg.map(x=>{if(gearIds.includes(x.gear_id)){const nu=x.number_of_uses+1;return{...x,signed_in_out:"OUT",number_of_uses:nu,status:calcStatus({...x,number_of_uses:nu})};}return x;}));
    const ts=new Date().toISOString();const lid=flowCtx.list.list_id;
    const uRecs=gearIds.map(id=>{const g=gear.find(x=>x.gear_id===id);return{item:g.item,gear_id:id,list_id:lid,signed_in_out:"OUT",time_out:ts,time_in:null,instructor:currentUser.name,use_number_on_item:(g.number_of_uses||0)+1};});
    if(hasSupabase()){
      for(const id of gearIds){const g=gear.find(x=>x.gear_id===id);const nu=(g.number_of_uses||0)+1;await sbUpdate("gear",{gear_id:id},{signed_in_out:"OUT",number_of_uses:nu,status:calcStatus({...g,number_of_uses:nu})});}
      for(const u of uRecs){const ins=await sbInsert("usage",u);if(ins)setUsage(prev=>[...prev,ins]);}
    } else {
      setUsage(u=>[...u,...uRecs.map(r=>({...r,usage_id:usageRef.current++}))]);
    }
    showToast("✅ "+gearIds.length+" items signed out as "+flowCtx.list.name);go("scan");
  }
  async function handleListSignIn(){
    const ids=flowCtx.list.gear_ids;const ts=new Date().toISOString();
    setGear(gg=>gg.map(x=>ids.includes(x.gear_id)?{...x,signed_in_out:"IN"}:x));
    setUsage(u=>u.map(x=>ids.includes(x.gear_id)&&x.signed_in_out==="OUT"&&!x.time_in?{...x,time_in:ts}:x));
    if(hasSupabase()){
      for(const id of ids){await sbUpdate("gear",{gear_id:id},{signed_in_out:"IN"});}
      const openRecs=usage.filter(u=>ids.includes(u.gear_id)&&u.signed_in_out==="OUT"&&!u.time_in);
      for(const u of openRecs)await sbUpdate("usage",{usage_id:u.usage_id},{time_in:ts,signed_in_out:"IN"});
    }
    showToast("✅ List signed in");go("scan");
  }
  function handleListReport(g){setSelected(g);setFromQuick(false);go("report");}

  // ── Fuel log ──────────────────────────────────────────────────────────────
  async function handleFuelSubmit(data){
    const v=gear.find(g=>g.gear_id===data.vehicle_gear_id);
    const rec={vehicle_gear_id:data.vehicle_gear_id,vehicle_name:v?v.item:"Unknown",litres_added:data.litres_added,pump_gauge_reading:data.pump_gauge_reading,instructor:currentUser.name,time:new Date().toISOString()};
    if(hasSupabase()){
      const ins=await sbInsert("fuel_log",rec);
      if(ins)setFuelLog(f=>[...f,ins]);
    } else {
      setFuelLog(f=>[...f,{...rec,fuel_id:fuelRef.current++}]);
    }
    showToast("⛽ Fuel fill recorded");go("scan");
  }

  // ── Quick sign in ─────────────────────────────────────────────────────────
  function handleQuickReport(g){setSelected(g);setFromQuick(true);go("report");}
  function handleSignAll(items){items.forEach(({g})=>doSignIn(g));showToast("✅ All signed in");go("scan");}

  // ── Bucket sign-back-in: usage row gets time_in stamped, bucket count goes back up
  async function handleBucketSignIn(uRow, bucket, qty){
    const ts = new Date().toISOString();
    const newCount = Math.min(
      (Number(bucket.pool_capacity) || (Number(bucket.pool_count) + qty)),
      (Number(bucket.pool_count) || 0) + qty
    );
    setUsage(us => us.map(u => u.usage_id === uRow.usage_id ? {...u, time_in: ts, signed_in_out: 'IN'} : u));
    setGear(gs => gs.map(g => g.gear_id === bucket.gear_id ? {...g, pool_count: newCount} : g));
    if (hasSupabase()) {
      await sbUpdate('usage', {usage_id: uRow.usage_id}, {time_in: ts, signed_in_out: 'IN'});
      await sbUpdate('gear',  {gear_id:  bucket.gear_id}, {pool_count: newCount});
    }
    showToast(`✅ ${qty} signed in`);
  }

  // ── Bucket "damaged / lost": close the usage row WITHOUT incrementing the
  //     bucket back. Optionally drop pool_capacity by qty (because the items
  //     are gone for good). Also writes a report row so the manager sees it.
  async function handleBucketReport(uRow, bucket, qty){
    if (!confirm(`Mark ${qty} ${bucket.size||''} ${bucket.item} as damaged or lost?\n\nThis closes the sign-out without returning the items to the pool, and reduces the pool capacity by ${qty}.`)) return;
    const ts = new Date().toISOString();
    const newCap = Math.max(0, (Number(bucket.pool_capacity)||0) - qty);
    // Close usage row
    setUsage(us => us.map(u => u.usage_id === uRow.usage_id ? {...u, time_in: ts, signed_in_out: 'IN'} : u));
    // Drop capacity (count stays at current — already decremented at sign-out)
    setGear(gs => gs.map(g => g.gear_id === bucket.gear_id ? {...g, pool_capacity: newCap} : g));
    // Insert a report row so it shows in the manager's reports list
    const rRec = {
      item: `${qty}× ${bucket.item} reported damaged/lost`,
      gear_id: bucket.gear_id,
      status: 'Red',
      notes: `${currentUser.name} reported ${qty} item(s) lost/damaged from pool. Capacity dropped by ${qty}.`,
      instructor: currentUser.name,
      time_reported: ts,
      resolved: false,
    };
    if (hasSupabase()) {
      await sbUpdate('usage', {usage_id: uRow.usage_id}, {time_in: ts, signed_in_out: 'IN'});
      await sbUpdate('gear',  {gear_id:  bucket.gear_id}, {pool_capacity: newCap});
      const ins = await sbInsert('reports', rRec);
      if (ins) setReports(r => [...r, ins]);
    } else {
      setReports(r => [...r, {...rRec, report_id: Date.now()}]);
    }
    showToast(`⚠ ${qty} reported damaged — capacity reduced`);
  }

  // ── Overview tap-through ───────────────────────────────────────────────────
  function openGearFiltered(status){setGearFilter({status});go("dashboard");}

  const bg={minHeight:"100vh",background:"radial-gradient(ellipse at 20% 0%, #1a3a1a 0%, "+T.bg+" 60%)"};

  if(!session) return <><style>{CSS}</style><LoginScreen onLogin={handleLogin}/><Toast msg={toast}/></>;

  if(session==="instructor") return (
    <><style>{CSS}</style>
    <div style={bg}>
      <div style={{position:"fixed",top:12,right:12,zIndex:100}}><button onClick={handleLogout} style={{background:"rgba(0,0,0,0.4)",border:"1px solid "+T.border,color:T.muted,borderRadius:8,padding:"5px 13px",fontSize:12}}>Sign Out</button></div>
      {view==="scan"           && <ScanScreen          gear={gear} cats={cats} types={types} lists={lists} usage={usage} currentUser={currentUser} onScanResult={handleScanResult} onQuickSignIn={()=>go("quickSignIn")}/>}
      {view==="quickSignIn"    && <QuickSignInScreen   gear={gear} usage={usage} currentUser={currentUser} onSignIn={doSignIn} onReport={handleQuickReport} onSignAll={handleSignAll} onBucketSignIn={handleBucketSignIn} onBucketReport={handleBucketReport} onBack={()=>go("scan")}/>}
      {view==="detail"         && selected && <GearDetailScreen      item={selected} gear={gear} onBack={()=>go("scan")} onSignOut={handleSignOut} onSignIn={handleSignIn} onReport={()=>go("report")} lastAct={lastAct}/>}
      {view==="monitoredDetail"&& selected && <MonitoredDetailScreen item={selected} gear={gear} onBack={()=>go("scan")} onReport={()=>go("report")}/>}
      {view==="sized"          && flowCtx?.type && <SizedPoolScreen  type={flowCtx.type} gear={gear} onBack={()=>go("scan")} onSubmit={handleSizedSubmit} onReportDamage={handleSizedDamage}/>}
      {view==="fuelLog"        && selected && <FuelLogScreen         tank={selected} gear={gear} cats={cats} fuelLog={fuelLog} onBack={()=>go("scan")} onSubmit={handleFuelSubmit}/>}
      {view==="list"           && flowCtx?.list && <ListDetailScreen list={flowCtx.list} gear={gear} cats={cats} onBack={()=>go("scan")} onSignOutAll={handleListSignOut} onSignInAll={handleListSignIn} onReportItem={handleListReport}/>}
      {view==="report"         && selected && <ReportScreen          item={selected} onBack={()=>go(fromQuick?"quickSignIn":behaviourOf(selected,cats)==="monitored_only"?"monitoredDetail":"detail")} onSubmit={handleReport} saving={saving}/>}
    </div>
    <Toast msg={toast}/></>
  );

  return (
    <><style>{CSS}</style>
    <div style={bg}>
      <div style={{position:"fixed",top:12,right:12,zIndex:100}}><button onClick={handleLogout} style={{background:"rgba(0,0,0,0.4)",border:"1px solid "+T.border,color:T.muted,borderRadius:8,padding:"5px 13px",fontSize:12}}>Sign Out</button></div>
      <Dashboard
        gear={gear} setGear={setGear} cats={cats} setCats={setCats}
        locations={locations} setLocations={setLocations}
        lists={lists} setLists={setLists} usage={usage} setUsage={setUsage}
        reports={reports} setReports={setReports} repairs={repairs} setRepairs={setRepairs}
        workflow={workflow} setWorkflow={setWorkflow}
        prevPurchases={prevPurchases} setPrevPurchases={setPrevPurchases}
        retired={retired} setRetired={setRetired}
        fuelLog={fuelLog} setFuelLog={setFuelLog}
        instructors={instructors} setInstructors={setInstructors}
        showToast={showToast} gearFilter={gearFilter} setGearFilter={setGearFilter}
        onOpenGearFiltered={openGearFiltered}
        loading={loading} dbReady={dbReady}
      />
    </div>
    <Toast msg={toast}/></>
  );
}
