/**
 * ZYNT PROTOCOL — Quantum-Resistant DeFi Advisor OS
 * Solana-native | Alpenglow-aware | ZKML-verified | 1940 Act Compliant
 *
 * Architecture Notes:
 * - Anchor programs: hybrid_vault.rs, regulatory_oracle.rs, audit_merkle.rs
 * - Token-2022 extensions: transfer hooks, confidential transfers, metadata
 * - SPL Account Compression: ConcurrentMerkleTree for immutable audit trails
 * - Dilithium-3 signatures via Solana syscall (libsodium-compatible shim)
 * - ZKML: Bonsol/EZKL circuits for anomaly detection (target 0.94 AUC)
 * - Pyth oracles: price feeds + confidence intervals for risk gating
 * - Alpenglow consensus: sub-400ms finality comments throughout
 * - PLONK ZK proofs for portfolio rebalancing verification
 * - WebAuthn + W3C Verifiable Credentials for Advisor DAO
 * - Service Worker: offline-first with IndexedDB state sync
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ScatterChart, Scatter, ReferenceLine
} from "recharts";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const T = {
  bg:       "#040812",
  surface:  "#070d1a",
  panel:    "#0a1220",
  border:   "#0f2040",
  borderHi: "#1a3a6e",
  accent:   "#00d4ff",
  accentDim:"#0088aa",
  green:    "#00ff88",
  amber:    "#ffaa00",
  red:      "#ff3366",
  purple:   "#8b5cf6",
  cyan2:    "#22d3ee",
  text:     "#e2e8f0",
  textDim:  "#64748b",
  textMid:  "#94a3b8",
};

// ─── MOCK DATA ─────────────────────────────────────────────────────────────────
const yieldData = Array.from({length:30},(_,i)=>({
  day:`D${i+1}`,
  aave: +(4.2+Math.sin(i/3)*0.8+Math.random()*0.3).toFixed(2),
  jupiter: +(6.1+Math.cos(i/2.5)*1.2+Math.random()*0.4).toFixed(2),
  kamino: +(5.4+Math.sin(i/4)*0.9+Math.random()*0.35).toFixed(2),
  rwa: +(3.8+Math.sin(i/6)*0.4+Math.random()*0.2).toFixed(2),
}));

const portfolioData = [
  {name:"SOL Liquid Staking",value:28,color:"#00d4ff"},
  {name:"RWA Treasury",value:22,color:"#00ff88"},
  {name:"Jupiter LP",value:18,color:"#8b5cf6"},
  {name:"Kamino Vaults",value:16,color:"#ffaa00"},
  {name:"Aave Cross-Chain",value:10,color:"#22d3ee"},
  {name:"USDC Reserve",value:6,color:"#64748b"},
];

const riskTimeline = Array.from({length:24},(_,i)=>({
  h:`${i}:00`,
  score:+(0.72+Math.sin(i/3)*0.12+Math.random()*0.05).toFixed(3),
  drawdown:+(2.1+Math.cos(i/4)*1.8+Math.random()*0.6).toFixed(2),
  vol:+(0.18+Math.sin(i/5)*0.06+Math.random()*0.02).toFixed(3),
}));

const auditTrail = [
  {id:"0xA3f…c1",ts:"09:14:02",action:"REBALANCE",proof:"π₁=valid",status:"CONFIRMED",slot:312481920},
  {id:"0xB7e…d4",ts:"09:08:55",action:"MINT_RWA",proof:"π₂=valid",status:"CONFIRMED",slot:312481744},
  {id:"0xC2a…f9",ts:"09:01:33",action:"FREEZE_ACCOUNT",proof:"π₃=valid",status:"CONFIRMED",slot:312481512},
  {id:"0xD9b…11",ts:"08:55:17",action:"YIELD_HARVEST",proof:"π₄=valid",status:"CONFIRMED",slot:312481280},
  {id:"0xE4c…82",ts:"08:48:40",action:"ORACLE_UPDATE",proof:"π₅=valid",status:"CONFIRMED",slot:312481001},
];

const clientData = [
  {id:"C-001",name:"Meridian Capital",aum:"$142M",risk:"Conservative",status:"Active",zkCred:"✓"},
  {id:"C-002",name:"Apex Family Office",aum:"$89M",risk:"Moderate",status:"Active",zkCred:"✓"},
  {id:"C-003",name:"Vortex Endowment",aum:"$231M",risk:"Aggressive",status:"Review",zkCred:"✓"},
  {id:"C-004",name:"Solaris Pension",aum:"$410M",risk:"Conservative",status:"Active",zkCred:"✓"},
  {id:"C-005",name:"Novus DAO Treasury",aum:"$67M",risk:"Moderate",status:"Pending",zkCred:"⏳"},
];

const threatLevels = [
  {subject:"Harvest Attacks",A:82,fullMark:100},
  {subject:"Oracle Manip.",A:71,fullMark:100},
  {subject:"Flash Loan",A:91,fullMark:100},
  {subject:"Sybil",A:65,fullMark:100},
  {subject:"Quantum",A:48,fullMark:100},
  {subject:"Sandwich",A:88,fullMark:100},
];

const quantumScenarios = [
  {year:2025,rsa2048:95,ecc256:92,dilithium3:99,kyber768:99},
  {year:2027,rsa2048:71,ecc256:68,dilithium3:99,kyber768:99},
  {year:2029,rsa2048:34,ecc256:29,dilithium3:98,kyber768:99},
  {year:2031,rsa2048:8,ecc256:6,dilithium3:97,kyber768:99},
  {year:2033,rsa2048:1,ecc256:1,dilithium3:97,kyber768:98},
];

const tradeBook = [
  {id:"T-4821",pair:"SOL/USDC",side:"BUY",size:"$2.4M",price:"$182.40",slippage:"0.04%",zkProof:"✓",ts:"09:12:01"},
  {id:"T-4820",pair:"JUP/USDC",side:"SELL",size:"$890K",price:"$1.241",slippage:"0.09%",zkProof:"✓",ts:"09:09:44"},
  {id:"T-4819",pair:"mSOL/SOL",side:"BUY",size:"$5.1M",price:"$1.0821",slippage:"0.02%",zkProof:"✓",ts:"09:06:12"},
  {id:"T-4818",pair:"USDC/PYUSD",side:"SELL",size:"$12M",price:"$1.0002",slippage:"0.001%",zkProof:"✓",ts:"09:01:55"},
];

const anomalyFeed = [
  {ts:"09:13:44",type:"ORACLE_DEVIATION",severity:"HIGH",detail:"SOL/USD Pyth confidence ±3.2%→gated",aucScore:0.961},
  {ts:"09:07:22",type:"DRAWDOWN_BREACH",severity:"CRITICAL",detail:"Kamino vault DD 5.1%→freeze triggered",aucScore:0.948},
  {ts:"08:52:10",type:"LEVERAGE_WARN",severity:"MED",detail:"Jupiter position 4.8x→capped at 3x",aucScore:0.921},
  {ts:"08:41:33",type:"ANOMALY_TX",severity:"LOW",detail:"Unusual transfer pattern detected",aucScore:0.887},
];

// ─── GLOBAL STYLES ─────────────────────────────────────────────────────────────
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #040812; --surface: #070d1a; --panel: #0a1220;
    --border: #0f2040; --border-hi: #1a3a6e;
    --accent: #00d4ff; --green: #00ff88; --amber: #ffaa00;
    --red: #ff3366; --purple: #8b5cf6;
    --text: #e2e8f0; --text-dim: #64748b; --text-mid: #94a3b8;
    scrollbar-width: thin; scrollbar-color: #1a3a6e #040812;
  }

  body { background: var(--bg); color: var(--text); font-family: 'JetBrains Mono', monospace; overflow-x: hidden; }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: #040812; }
  ::-webkit-scrollbar-thumb { background: #1a3a6e; border-radius: 2px; }

  @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
  @keyframes scanline { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
  @keyframes glow-accent { 0%,100%{box-shadow:0 0 8px #00d4ff44} 50%{box-shadow:0 0 20px #00d4ff88,0 0 40px #00d4ff22} }
  @keyframes float-up { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
  @keyframes quantum-flicker { 0%,100%{opacity:1} 92%{opacity:1} 93%{opacity:0.3} 94%{opacity:1} 97%{opacity:0.8} 98%{opacity:1} }

  .zynt-app { min-height: 100vh; background: var(--bg); position: relative; overflow: hidden; }
  .scanline-overlay {
    position: fixed; inset: 0; pointer-events: none; z-index: 9999;
    background: repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.04) 2px,rgba(0,0,0,0.04) 4px);
  }
  .noise-overlay {
    position: fixed; inset: 0; pointer-events: none; z-index: 9998; opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 256px;
  }

  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
    animation: float-up 0.4s ease forwards;
  }
  .panel::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent); opacity: 0.5;
  }

  .status-dot { width: 7px; height: 7px; border-radius: 50%; animation: pulse-dot 2s infinite; display: inline-block; }
  .status-dot.green { background: #00ff88; box-shadow: 0 0 6px #00ff8888; }
  .status-dot.amber { background: #ffaa00; box-shadow: 0 0 6px #ffaa0088; }
  .status-dot.red   { background: #ff3366; box-shadow: 0 0 6px #ff336688; }
  .status-dot.cyan  { background: #00d4ff; box-shadow: 0 0 6px #00d4ff88; }

  .badge {
    display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
    border-radius: 2px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  }
  .badge-green { background: #00ff8818; color: #00ff88; border: 1px solid #00ff8840; }
  .badge-amber { background: #ffaa0018; color: #ffaa00; border: 1px solid #ffaa0040; }
  .badge-red   { background: #ff336618; color: #ff3366; border: 1px solid #ff336640; }
  .badge-cyan  { background: #00d4ff18; color: #00d4ff; border: 1px solid #00d4ff40; }
  .badge-purple{ background: #8b5cf618; color: #8b5cf6; border: 1px solid #8b5cf640; }

  .btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px;
    border: 1px solid var(--border-hi); background: transparent; color: var(--accent);
    font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500;
    letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; border-radius: 2px;
    transition: all 0.15s; position: relative; overflow: hidden;
  }
  .btn:hover { background: #00d4ff12; border-color: var(--accent); box-shadow: 0 0 12px #00d4ff22; }
  .btn-primary { background: #00d4ff18; border-color: var(--accent); }
  .btn-danger  { border-color: #ff336688; color: #ff3366; }
  .btn-danger:hover { background: #ff336618; box-shadow: 0 0 12px #ff336622; }

  .ticker-bar {
    height: 28px; background: #040c18; border-bottom: 1px solid var(--border);
    overflow: hidden; display: flex; align-items: center;
  }
  .ticker-inner { display: flex; gap: 0; white-space: nowrap; animation: ticker 35s linear infinite; }
  .ticker-item { padding: 0 24px; font-size: 10px; color: var(--text-mid); letter-spacing: 0.04em; }
  .ticker-item .up { color: #00ff88; }
  .ticker-item .dn { color: #ff3366; }

  .nav-tab {
    padding: 8px 14px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--text-dim); border-bottom: 2px solid transparent; cursor: pointer; transition: all 0.15s;
    font-family: 'JetBrains Mono', monospace; white-space: nowrap;
  }
  .nav-tab:hover { color: var(--text-mid); }
  .nav-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

  .metric-card {
    padding: 16px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 2px; position: relative; overflow: hidden;
  }
  .metric-card::after {
    content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent, var(--accent) 50%, transparent);
    opacity: 0; transition: opacity 0.2s;
  }
  .metric-card:hover::after { opacity: 0.6; }

  .table-row { border-bottom: 1px solid #0a1e38; transition: background 0.1s; }
  .table-row:hover { background: #0a1828; }
  .table-cell { padding: 9px 12px; font-size: 11px; color: var(--text-mid); }

  .risk-bar { height: 4px; border-radius: 1px; overflow: hidden; background: #0f2040; }
  .risk-fill { height: 100%; border-radius: 1px; transition: width 0.5s ease; }

  .glow-box { animation: glow-accent 3s ease-in-out infinite; }
  .quantum-text { animation: quantum-flicker 8s ease-in-out infinite; }

  .sidebar-icon {
    width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
    color: var(--text-dim); cursor: pointer; border-radius: 2px; transition: all 0.15s;
    font-size: 16px; position: relative;
  }
  .sidebar-icon:hover { color: var(--accent); background: #00d4ff0a; }
  .sidebar-icon.active { color: var(--accent); background: #00d4ff14; }
  .sidebar-icon.active::before {
    content:''; position:absolute; left:0; top:8px; bottom:8px; width:2px;
    background: var(--accent); border-radius:0 1px 1px 0;
  }

  .zkml-gauge {
    width: 80px; height: 80px; position: relative; display: flex; align-items: center; justify-content: center;
  }

  .tooltip-custom {
    background: #040c18 !important; border: 1px solid #1a3a6e !important;
    border-radius: 2px !important; font-family: 'JetBrains Mono', monospace !important;
    font-size: 10px !important; color: #94a3b8 !important;
  }

  .compliance-stamp {
    display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
    border: 1px solid #1a3a6e; background: #070d1a; border-radius: 2px;
    font-size: 9px; color: #64748b; letter-spacing: 0.1em; text-transform: uppercase;
  }

  input, select {
    background: #070d1a; border: 1px solid #0f2040; color: #e2e8f0;
    font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 7px 10px;
    border-radius: 2px; outline: none; width: 100%;
    transition: border-color 0.15s;
  }
  input:focus, select:focus { border-color: #00d4ff66; }
  input::placeholder { color: #334155; }

  .param-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #0a1e38; }
  .param-label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
  .param-value { font-size: 12px; color: #00d4ff; font-family: 'Space Mono', monospace; }

  .zk-proof-line {
    font-family: 'Space Mono', monospace; font-size: 9px; color: #334155;
    padding: 4px 0; border-bottom: 1px solid #0a1428;
    transition: color 0.2s;
  }
  .zk-proof-line:hover { color: #475569; }
  .zk-proof-line .valid { color: #00ff8866; }

  .alpenglow-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 8px; background: #00d4ff0a; border: 1px solid #00d4ff22;
    border-radius: 2px; font-size: 9px; color: #00d4ff88; letter-spacing: 0.08em;
  }

  .shadow-widget {
    background: #040812; border: 1px solid #1a0a2e;
    border-radius: 2px; overflow: hidden;
  }
  .shadow-header { background: linear-gradient(135deg, #0d0520 0%, #040812 100%); padding: 12px 16px; border-bottom: 1px solid #1a0a2e; }

  @keyframes waveform { 0%,100%{transform:scaleY(0.3)} 50%{transform:scaleY(1)} }
  .wave-bar { width: 3px; background: var(--purple); border-radius: 1px; transform-origin: bottom; }
`;

// ─── COMPONENTS ────────────────────────────────────────────────────────────────

const CustomTooltip = ({active,payload,label})=>{
  if(!active||!payload?.length) return null;
  return(
    <div style={{background:"#040c18",border:"1px solid #1a3a6e",padding:"8px 12px",borderRadius:2,fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>
      <div style={{color:"#64748b",marginBottom:4}}>{label}</div>
      {payload.map((p,i)=><div key={i} style={{color:p.color||"#00d4ff"}}>{p.name}: {p.value}</div>)}
    </div>
  );
};

// ─── TICKER ───────────────────────────────────────────────────────────────────
const TickerBar = ()=>{
  const items=[
    {sym:"SOL",p:"$182.40",ch:"+2.14%",up:true},{sym:"JUP",p:"$1.241",ch:"+0.88%",up:true},
    {sym:"mSOL",p:"$197.12",ch:"+2.09%",up:true},{sym:"PYTH",p:"$0.3821",ch:"-0.44%",up:false},
    {sym:"RAY",p:"$2.841",ch:"+3.12%",up:true},{sym:"BONK",p:"$0.0000281",ch:"+8.4%",up:true},
    {sym:"W",p:"$0.441",ch:"-1.22%",up:false},{sym:"HNT",p:"$3.912",ch:"+0.91%",up:true},
    {sym:"USDC",p:"$1.0001",ch:"0.00%",up:true},{sym:"BTC",p:"$109,284",ch:"+1.02%",up:true},
  ];
  return(
    <div className="ticker-bar">
      <div style={{padding:"0 10px",fontSize:9,color:"#1a3a6e",fontWeight:700,letterSpacing:"0.1em",whiteSpace:"nowrap",borderRight:"1px solid #0f2040",marginRight:8,minWidth:70}}>LIVE FEEDS</div>
      <div className="ticker-inner">
        {[...items,...items].map((it,i)=>(
          <span key={i} className="ticker-item">
            <span style={{color:"#475569"}}>{it.sym}</span>{" "}
            <span style={{color:"#94a3b8"}}>{it.p}</span>{" "}
            <span className={it.up?"up":"dn"}>{it.ch}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

// ─── HEADER ───────────────────────────────────────────────────────────────────
const Header = ({onSection})=>{
  const [ts,setTs]=useState(new Date());
  useEffect(()=>{ const iv=setInterval(()=>setTs(new Date()),1000); return()=>clearInterval(iv); },[]);
  return(
    <header style={{background:"#040c18",borderBottom:"1px solid #0f2040",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100}}>
      <div style={{display:"flex",alignItems:"center",gap:16}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {/* Logo */}
          <svg width="28" height="28" viewBox="0 0 28 28">
            <polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke="#00d4ff" strokeWidth="1.5"/>
            <polygon points="14,6 22,10 22,18 14,22 6,18 6,10" fill="none" stroke="#00d4ff44" strokeWidth="1"/>
            <circle cx="14" cy="14" r="3" fill="#00d4ff"/>
            <line x1="14" y1="6" x2="14" y2="22" stroke="#00d4ff33" strokeWidth="0.5"/>
            <line x1="6" y1="10" x2="22" y2="18" stroke="#00d4ff33" strokeWidth="0.5"/>
            <line x1="22" y1="10" x2="6" y2="18" stroke="#00d4ff33" strokeWidth="0.5"/>
          </svg>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,color:"#e2e8f0",letterSpacing:"0.04em",lineHeight:1}}>ZYNT</div>
            <div style={{fontSize:8,color:"#1a3a6e",letterSpacing:"0.15em",textTransform:"uppercase"}}>PROTOCOL</div>
          </div>
        </div>
        <div style={{width:1,height:28,background:"#0f2040"}}/>
        <div style={{fontSize:9,color:"#334155",letterSpacing:"0.08em"}}>
          <span style={{color:"#1a3a6e"}}>NET</span> SOLANA_MAINNET_BETA
        </div>
        <div className="alpenglow-badge">
          ⚡ Alpenglow <span style={{color:"#00ff88"}}>≤400ms</span>
        </div>
        <div className="alpenglow-badge" style={{borderColor:"#8b5cf622",color:"#8b5cf688",background:"#8b5cf60a"}}>
          🔐 Dilithium-3
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:16}}>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:10,color:"#00d4ff",fontFamily:"'Space Mono',monospace"}}>{ts.toLocaleTimeString("en-US",{hour12:false})}</div>
          <div style={{fontSize:8,color:"#334155",letterSpacing:"0.1em"}}>UTC {ts.toLocaleDateString()}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",background:"#00ff8808",border:"1px solid #00ff8820",borderRadius:2}}>
          <span className="status-dot green"/>
          <span style={{fontSize:9,color:"#00ff8888",letterSpacing:"0.1em"}}>SYSTEMS NOMINAL</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",background:"#0a1220",border:"1px solid #0f2040",borderRadius:2}}>
          <span style={{fontSize:18}}>👤</span>
          <div>
            <div style={{fontSize:10,color:"#94a3b8"}}>J. Harrington, CFA</div>
            <div style={{fontSize:8,color:"#334155",letterSpacing:"0.08em"}}>RIA_LICENSE_VERIFIED · WebAuthn</div>
          </div>
        </div>
      </div>
    </header>
  );
};

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
const Sidebar = ({active,onNav})=>{
  const items=[
    {id:"dashboard",icon:"⬡",label:"Dashboard"},
    {id:"yield",icon:"◈",label:"Yield / RWA"},
    {id:"risk",icon:"⬟",label:"Risk Fortress"},
    {id:"clients",icon:"◉",label:"Client Hub"},
    {id:"simulator",icon:"⟁",label:"Simulator"},
    {id:"optimizer",icon:"◐",label:"Optimizer"},
    {id:"trade",icon:"▷",label:"Trade Desk"},
    {id:"dao",icon:"⬡",label:"Advisor DAO"},
  ];
  return(
    <div style={{width:48,background:"#040c18",borderRight:"1px solid #0f2040",display:"flex",flexDirection:"column",alignItems:"center",padding:"12px 0",gap:4,position:"sticky",top:60,height:"calc(100vh - 88px)",overflowY:"auto"}}>
      {items.map(it=>(
        <div key={it.id} className={`sidebar-icon${active===it.id?" active":""}`} onClick={()=>onNav(it.id)} title={it.label} style={{fontSize:18}}>
          {it.icon}
        </div>
      ))}
      <div style={{flex:1}}/>
      <div style={{width:28,height:1,background:"#0f2040",margin:"8px 0"}}/>
      <div className="sidebar-icon" title="Settings" style={{fontSize:14}}>⚙</div>
      <div className="sidebar-icon" title="Audit Log" style={{fontSize:14}}>⊟</div>
      <div style={{fontSize:8,color:"#1a3a6e",letterSpacing:"0.08em",textAlign:"center",padding:"4px 0",lineHeight:1.4}}>v3.1<br/>PROD</div>
    </div>
  );
};

// ─── COMPLIANCE FOOTER ────────────────────────────────────────────────────────
const ComplianceLine = ()=>(
  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
    {["1940 ACT COMPLIANT","SEC ETF ALIGNED","SOC2 TYPE II","PLONK VERIFIED","SPL-COMPRESSED AUDIT","PYTH ORACLE FEED"].map(l=>(
      <span key={l} className="compliance-stamp">✓ {l}</span>
    ))}
  </div>
);

// ─── ZKML GAUGE ───────────────────────────────────────────────────────────────
const ZKMLGauge = ({value,label,color="#00d4ff"})=>{
  const pct=Math.round(value*100);
  const r=32,c=2*Math.PI*r,dash=c*(value);
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
      <div style={{position:"relative",width:80,height:80}}>
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={r} fill="none" stroke="#0f2040" strokeWidth="5"/>
          <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={`${dash} ${c}`} strokeDashoffset={c/4}
            strokeLinecap="round" style={{transition:"stroke-dasharray 1s ease"}}/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          <div style={{fontSize:13,color,fontFamily:"'Space Mono',monospace",fontWeight:700}}>{pct}%</div>
        </div>
      </div>
      <div style={{fontSize:9,color:"#475569",textAlign:"center",letterSpacing:"0.06em",textTransform:"uppercase"}}>{label}</div>
    </div>
  );
};

// ─── QUANTUM SHADOW WIDGET ────────────────────────────────────────────────────
const QuantumShadowWidget = ()=>{
  const [year,setYear]=useState(2027);
  const scenario=quantumScenarios.find(s=>s.year===year)||quantumScenarios[1];
  const bars=[
    {label:"RSA-2048",val:scenario.rsa2048,color:"#ff3366"},
    {label:"ECC-256",val:scenario.ecc256,color:"#ffaa00"},
    {label:"Dilithium-3",val:scenario.dilithium3,color:"#00ff88"},
    {label:"Kyber-768",val:scenario.kyber768,color:"#00d4ff"},
  ];
  return(
    <div className="shadow-widget">
      <div className="shadow-header">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:12,fontWeight:700,color:"#8b5cf6",letterSpacing:"0.08em"}}>QUANTUM SHADOW SIMULATOR</div>
            <div style={{fontSize:9,color:"#4c3a6e",marginTop:2,letterSpacing:"0.06em"}}>Cryptographic Resistance Projection · Grover/Shor Models</div>
          </div>
          <span className="badge badge-purple">ZKML VERIFIED</span>
        </div>
      </div>
      <div style={{padding:16}}>
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          {quantumScenarios.map(s=>(
            <button key={s.year} className="btn" style={{padding:"4px 10px",fontSize:10,borderColor:year===s.year?"#8b5cf6":"#0f2040",color:year===s.year?"#8b5cf6":"#334155"}} onClick={()=>setYear(s.year)}>
              {s.year}
            </button>
          ))}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {bars.map(b=>(
            <div key={b.label}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:10,color:"#64748b",letterSpacing:"0.06em"}}>{b.label}</span>
                <span style={{fontSize:10,color:b.color,fontFamily:"'Space Mono',monospace"}}>{b.val}%</span>
              </div>
              <div className="risk-bar">
                <div className="risk-fill" style={{width:`${b.val}%`,background:b.color,boxShadow:`0 0 6px ${b.color}44`}}/>
              </div>
            </div>
          ))}
        </div>
        <div style={{marginTop:12,padding:"8px",background:"#0a0518",border:"1px solid #1a0a2e",borderRadius:2}}>
          <div style={{fontSize:9,color:"#6b4c9e",lineHeight:1.6}}>
            <span style={{color:"#8b5cf6"}}>ZYNT STATUS</span> — Dilithium-3 CRYSTALS signatures deployed via Solana syscall shim. Post-quantum secure against CRQC adversaries modeled through {year+4}. PLONK circuits use quantum-resistant hash commitments.
          </div>
        </div>
        <div style={{marginTop:8}}>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={quantumScenarios}>
              <XAxis dataKey="year" tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false}/>
              <YAxis domain={[0,100]} tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} width={28}/>
              <Line type="monotone" dataKey="rsa2048" stroke="#ff3366" strokeWidth={1} dot={false}/>
              <Line type="monotone" dataKey="dilithium3" stroke="#00ff88" strokeWidth={1.5} dot={false}/>
              <Line type="monotone" dataKey="kyber768" stroke="#00d4ff" strokeWidth={1} dot={false}/>
              <Tooltip content={<CustomTooltip/>}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ─── AUDIT TRAIL ──────────────────────────────────────────────────────────────
const AuditTrailPanel = ()=>(
  <div className="panel" style={{padding:0}}>
    <div style={{padding:"12px 16px",borderBottom:"1px solid #0f2040",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",letterSpacing:"0.08em"}}>MERKLE AUDIT TRAIL</div>
        <div style={{fontSize:8,color:"#334155",marginTop:1}}>SPL Account Compression · ConcurrentMerkleTree · immutable</div>
      </div>
      <span className="badge badge-green">LIVE</span>
    </div>
    <div>
      {auditTrail.map((a,i)=>(
        <div key={i} className="table-row" style={{display:"grid",gridTemplateColumns:"80px 70px 1fr 100px 90px 100px",padding:"0"}}>
          <div className="table-cell" style={{color:"#475569",fontFamily:"'Space Mono',monospace",fontSize:10}}>{a.ts}</div>
          <div className="table-cell" style={{fontSize:10,color:"#00d4ff88",fontFamily:"'Space Mono',monospace"}}>{a.id}</div>
          <div className="table-cell"><span className="badge badge-cyan" style={{fontSize:9}}>{a.action}</span></div>
          <div className="table-cell zk-proof-line"><span className="valid">{a.proof}</span></div>
          <div className="table-cell"><span className="badge badge-green" style={{fontSize:9}}>{a.status}</span></div>
          <div className="table-cell" style={{fontSize:9,color:"#334155",fontFamily:"'Space Mono',monospace"}}>#{a.slot}</div>
        </div>
      ))}
    </div>
    <div style={{padding:"8px 16px",borderTop:"1px solid #0a1428",display:"flex",gap:16,alignItems:"center"}}>
      {/* Alpenglow comment: sub-400ms slot finality means audit entries confirm in <1 block */}
      <div style={{fontSize:8,color:"#1a3a6e",letterSpacing:"0.08em"}}>// Alpenglow: finality ≤400ms · anchor confirm_slot verified</div>
      <div style={{marginLeft:"auto",fontSize:8,color:"#334155"}}>ROOT: 8kj…f2a</div>
    </div>
  </div>
);

// ─── ANOMALY FEED ─────────────────────────────────────────────────────────────
const AnomalyFeed = ()=>(
  <div className="panel" style={{padding:0}}>
    <div style={{padding:"12px 16px",borderBottom:"1px solid #0f2040",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0"}}>ZKML ANOMALY DETECTION</div>
        <div style={{fontSize:8,color:"#334155",marginTop:1}}>Bonsol circuits · target AUC 0.94 · Pyth confidence gating</div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <ZKMLGauge value={0.961} label="AUC" color="#00ff88"/>
      </div>
    </div>
    <div>
      {anomalyFeed.map((a,i)=>{
        const col=a.severity==="CRITICAL"?"#ff3366":a.severity==="HIGH"?"#ffaa00":a.severity==="MED"?"#8b5cf6":"#64748b";
        return(
          <div key={i} className="table-row" style={{padding:"10px 16px",display:"grid",gridTemplateColumns:"70px 120px 1fr 100px",gap:8,alignItems:"center"}}>
            <div style={{fontSize:9,color:"#334155",fontFamily:"'Space Mono',monospace"}}>{a.ts}</div>
            <div style={{fontSize:9,color:col,fontFamily:"'Space Mono',monospace",fontWeight:700}}>{a.type}</div>
            <div style={{fontSize:10,color:"#64748b"}}>{a.detail}</div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:"#00d4ff",fontFamily:"'Space Mono',monospace"}}>AUC {a.aucScore}</div>
              <div style={{fontSize:8,color:col,letterSpacing:"0.08em"}}>{a.severity}</div>
            </div>
          </div>
        );
      })}
    </div>
    {/* Risk params: 5% drawdown, 0.85 score freeze, 3-5x leverage cap */}
    <div style={{padding:"8px 16px",borderTop:"1px solid #0a1428",display:"flex",gap:16,flexWrap:"wrap"}}>
      <span style={{fontSize:9,color:"#334155"}}>DD_THRESH: <span style={{color:"#ff3366"}}>5.0%</span></span>
      <span style={{fontSize:9,color:"#334155"}}>SCORE_FREEZE: <span style={{color:"#ffaa00"}}>0.85</span></span>
      <span style={{fontSize:9,color:"#334155"}}>LEVERAGE_CAP: <span style={{color:"#8b5cf6"}}>3–5×</span></span>
      <span style={{fontSize:9,color:"#334155"}}>PYTH_CONF: <span style={{color:"#00d4ff"}}>±2.5%</span></span>
    </div>
  </div>
);

// ─── SECTIONS ─────────────────────────────────────────────────────────────────

const SectionDashboard = ()=>{
  const metrics=[
    {label:"Total AUM",val:"$944.2M",sub:"↑2.14% 24h",col:"#00d4ff"},
    {label:"Avg Yield",val:"5.71%",sub:"AAVE+JUP+KAM blend",col:"#00ff88"},
    {label:"Risk Score",val:"0.724",sub:"ZKML verified",col:"#ffaa00"},
    {label:"Active Clients",val:"147",sub:"CRM synced",col:"#8b5cf6"},
    {label:"ZK Proofs",val:"18,291",sub:"PLONK verified today",col:"#00d4ff"},
    {label:"Slot",val:"312,481,944",sub:"Alpenglow ≤400ms",col:"#22d3ee"},
  ];
  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* Metrics */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10}}>
        {metrics.map((m,i)=>(
          <div key={i} className="metric-card glow-box" style={{animationDelay:`${i*0.4}s`}}>
            <div style={{fontSize:8,color:"#334155",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>{m.label}</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:m.col,lineHeight:1}}>{m.val}</div>
            <div style={{fontSize:9,color:"#475569",marginTop:4}}>{m.sub}</div>
          </div>
        ))}
      </div>
      {/* Main charts row */}
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12}}>
        <div className="panel" style={{padding:0}}>
          <div style={{padding:"12px 16px",borderBottom:"1px solid #0f2040"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0"}}>YIELD STREAMS — 30D</div>
            <div style={{fontSize:8,color:"#334155",marginTop:1}}>Aave · Jupiter · Kamino · RWA Treasury</div>
          </div>
          <div style={{padding:16}}>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={yieldData}>
                <defs>
                  <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00d4ff" stopOpacity={0.2}/>
                    <stop offset="100%" stopColor="#00d4ff" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gj" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00ff88" stopOpacity={0.15}/>
                    <stop offset="100%" stopColor="#00ff88" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#0a1e38" strokeDasharray="3 3"/>
                <XAxis dataKey="day" tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} interval={4}/>
                <YAxis tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} width={28} unit="%"/>
                <Tooltip content={<CustomTooltip/>}/>
                <Area type="monotone" dataKey="aave" stroke="#00d4ff" strokeWidth={1.5} fill="url(#ga)" name="Aave"/>
                <Area type="monotone" dataKey="jupiter" stroke="#00ff88" strokeWidth={1.5} fill="url(#gj)" name="Jupiter"/>
                <Area type="monotone" dataKey="kamino" stroke="#8b5cf6" strokeWidth={1} fill="none" name="Kamino"/>
                <Area type="monotone" dataKey="rwa" stroke="#ffaa00" strokeWidth={1} fill="none" name="RWA"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel" style={{padding:0}}>
          <div style={{padding:"12px 16px",borderBottom:"1px solid #0f2040"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0"}}>PORTFOLIO ALLOCATION</div>
            <div style={{fontSize:8,color:"#334155",marginTop:1}}>Token-2022 vaults · Merkle verified</div>
          </div>
          <div style={{padding:16,display:"flex",flexDirection:"column",alignItems:"center"}}>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={portfolioData} cx="50%" cy="50%" innerRadius={45} outerRadius={68} paddingAngle={2} dataKey="value">
                  {portfolioData.map((e,i)=><Cell key={i} fill={e.color} opacity={0.85}/>)}
                </Pie>
                <Tooltip content={<CustomTooltip/>}/>
              </PieChart>
            </ResponsiveContainer>
            <div style={{width:"100%",display:"flex",flexDirection:"column",gap:4}}>
              {portfolioData.map((p,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:6,height:6,borderRadius:1,background:p.color}}/>
                    <span style={{fontSize:9,color:"#64748b"}}>{p.name}</span>
                  </div>
                  <span style={{fontSize:9,color:p.color,fontFamily:"'Space Mono',monospace"}}>{p.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Bottom row */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <AuditTrailPanel/>
        <QuantumShadowWidget/>
      </div>
      <AnomalyFeed/>
      <ComplianceLine/>
    </div>
  );
};

const SectionYield = ()=>(
  <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
      {[
        {proto:"Aave v3",apy:"4.81%",tvl:"$12.4B",status:"Active",color:"#00d4ff"},
        {proto:"Jupiter Perps",apy:"6.92%",tvl:"$2.1B",status:"Active",color:"#00ff88"},
        {proto:"Kamino Finance",apy:"5.44%",tvl:"$890M",status:"Active",color:"#8b5cf6"},
        {proto:"RWA Treasury",apy:"4.12%",tvl:"$3.2B",status:"Compliance OK",color:"#ffaa00"},
      ].map((p,i)=>(
        <div key={i} className="panel" style={{padding:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0",fontFamily:"'Syne',sans-serif"}}>{p.proto}</div>
            <span className="status-dot green"/>
          </div>
          <div style={{fontFamily:"'Space Mono',monospace",fontSize:22,fontWeight:700,color:p.color,marginBottom:6}}>{p.apy}</div>
          <div style={{fontSize:9,color:"#334155",marginBottom:8}}>TVL {p.tvl}</div>
          <div className="risk-bar">
            <div className="risk-fill" style={{width:`${60+Math.random()*30}%`,background:p.color}}/>
          </div>
          <div style={{marginTop:8,fontSize:8,color:"#475569",letterSpacing:"0.06em"}}>{p.status}</div>
        </div>
      ))}
    </div>
    <div className="panel" style={{padding:0}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid #0f2040"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0"}}>YIELD OPTIMIZER — Pyth Oracle Feeds</div>
        <div style={{fontSize:8,color:"#334155",marginTop:1}}>// Alpenglow finality: rebalance triggers settle in ≤2 slots (~800ms)</div>
      </div>
      <div style={{padding:16}}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={yieldData}>
            <defs>
              {["#00d4ff","#00ff88","#8b5cf6","#ffaa00"].map((c,i)=>(
                <linearGradient key={i} id={`gy${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={0.25}/>
                  <stop offset="100%" stopColor={c} stopOpacity={0}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="#0a1e38" strokeDasharray="3 3"/>
            <XAxis dataKey="day" tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} interval={3}/>
            <YAxis tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} width={30} unit="%"/>
            <Tooltip content={<CustomTooltip/>}/>
            <Area type="monotone" dataKey="aave" stroke="#00d4ff" strokeWidth={2} fill="url(#gy0)" name="Aave"/>
            <Area type="monotone" dataKey="jupiter" stroke="#00ff88" strokeWidth={2} fill="url(#gy1)" name="Jupiter"/>
            <Area type="monotone" dataKey="kamino" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#gy2)" name="Kamino"/>
            <Area type="monotone" dataKey="rwa" stroke="#ffaa00" strokeWidth={1.5} fill="url(#gy3)" name="RWA"/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
    <div className="panel" style={{padding:16}}>
      <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:12}}>RWA INTEGRATION — 1940 Act Compliant Asset Wrappers</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        {[
          {asset:"US Treasury T-Bills",yield:"5.24%",wrap:"Token-2022 + transfer hook",compliance:"SEC §3(a)(2)"},
          {asset:"Investment Grade Corp",yield:"4.88%",wrap:"SPL Compressed NFT receipt",compliance:"§4(a)(2) Exempt"},
          {asset:"Real Estate Equity",yield:"7.12%",wrap:"Merkle-verified fractional",compliance:"Reg D 506(c)"},
        ].map((r,i)=>(
          <div key={i} style={{padding:12,background:"#070d1a",border:"1px solid #0f2040",borderRadius:2}}>
            <div style={{fontSize:11,color:"#e2e8f0",marginBottom:6}}>{r.asset}</div>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:16,color:"#00ff88",marginBottom:4}}>{r.yield}</div>
            <div style={{fontSize:8,color:"#334155",marginBottom:4}}>{r.wrap}</div>
            <div className="compliance-stamp">{r.compliance}</div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const SectionRisk = ()=>(
  <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
      {/* Risk Score Panel */}
      <div className="panel" style={{padding:16}}>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>RISK FORTRESS PARAMETERS</div>
        <div style={{fontSize:8,color:"#334155",marginBottom:12}}>Regulatory Oracle · ZKML gating</div>
        {[
          {label:"Max Drawdown Threshold",val:"5.00%",status:"OK",col:"#00ff88"},
          {label:"Score Freeze Trigger",val:"0.85",status:"ARMED",col:"#ffaa00"},
          {label:"Leverage Cap (min)",val:"3×",status:"ENFORCED",col:"#00d4ff"},
          {label:"Leverage Cap (max)",val:"5×",status:"ENFORCED",col:"#00d4ff"},
          {label:"Pyth Confidence Band",val:"±2.5%",status:"LIVE",col:"#8b5cf6"},
          {label:"AUC Anomaly Target",val:"0.940",status:"0.961",col:"#00ff88"},
        ].map((p,i)=>(
          <div key={i} className="param-row">
            <span className="param-label">{p.label}</span>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span className="param-value">{p.val}</span>
              <span style={{fontSize:8,color:p.col,letterSpacing:"0.06em"}}>{p.status}</span>
            </div>
          </div>
        ))}
      </div>
      {/* Threat Radar */}
      <div className="panel" style={{padding:16}}>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>THREAT SURFACE</div>
        <div style={{fontSize:8,color:"#334155",marginBottom:8}}>ZKML prediction model · Bonsol circuits</div>
        <ResponsiveContainer width="100%" height={220}>
          <RadarChart data={threatLevels}>
            <PolarGrid stroke="#0f2040"/>
            <PolarAngleAxis dataKey="subject" tick={{fontSize:8,fill:"#475569"}}/>
            <Radar name="Threat" dataKey="A" stroke="#ff3366" fill="#ff3366" fillOpacity={0.15}/>
            <Tooltip content={<CustomTooltip/>}/>
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {/* ZKML Gauges */}
      <div className="panel" style={{padding:16}}>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>ZKML CIRCUIT STATUS</div>
        <div style={{fontSize:8,color:"#334155",marginBottom:16}}>EZKL-compatible verifiable models</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,justifyItems:"center"}}>
          <ZKMLGauge value={0.961} label="Anomaly AUC" color="#00ff88"/>
          <ZKMLGauge value={0.724} label="Risk Score" color="#ffaa00"/>
          <ZKMLGauge value={0.891} label="Oracle Conf." color="#00d4ff"/>
          <ZKMLGauge value={0.997} label="Proof Valid." color="#8b5cf6"/>
        </div>
        <div style={{marginTop:16,padding:8,background:"#040c18",border:"1px solid #0a1e38",borderRadius:2}}>
          <div style={{fontSize:8,color:"#1a3a6e",lineHeight:1.6}}>
            // Bonsol circuit: anomaly_detector.ezkl<br/>
            // Verification key: vk_anomaly_v2.bin<br/>
            // SNARK backend: plonky2 + grumpkin<br/>
            // Proof size: 4.2 KB · verify time: 12ms
          </div>
        </div>
      </div>
    </div>
    {/* Risk Timeline */}
    <div className="panel" style={{padding:0}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid #0f2040",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0"}}>RISK TIMELINE — 24H</div>
          <div style={{fontSize:8,color:"#334155",marginTop:1}}>Score · Drawdown · Volatility · Pyth feeds</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <ReferenceLine y={0.85} stroke="#ff336644" strokeDasharray="3 3"/>
          <span className="badge badge-red">DD WATCH</span>
          <span className="badge badge-amber">SCORE 0.724</span>
        </div>
      </div>
      <div style={{padding:16}}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={riskTimeline}>
            <CartesianGrid stroke="#0a1e38" strokeDasharray="3 3"/>
            <XAxis dataKey="h" tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} interval={3}/>
            <YAxis tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} width={35}/>
            <Tooltip content={<CustomTooltip/>}/>
            <ReferenceLine y={0.85} stroke="#ff336666" strokeDasharray="4 4" label={{value:"FREEZE",position:"right",fontSize:8,fill:"#ff3366"}}/>
            <Line type="monotone" dataKey="score" stroke="#ffaa00" strokeWidth={2} dot={false} name="Risk Score"/>
            <Line type="monotone" dataKey="drawdown" stroke="#ff3366" strokeWidth={1.5} dot={false} name="Drawdown %"/>
            <Line type="monotone" dataKey="vol" stroke="#8b5cf6" strokeWidth={1} dot={false} name="Volatility"/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
    <AnomalyFeed/>
  </div>
);

const SectionClients = ()=>(
  <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"flex",gap:10}}>
      <input placeholder="Search clients, entities, credentials…" style={{maxWidth:320}}/>
      <button className="btn btn-primary">+ New Client</button>
      <button className="btn">⊕ Import VC</button>
      <div style={{marginLeft:"auto",display:"flex",gap:8}}>
        <span className="badge badge-green">147 Active</span>
        <span className="badge badge-amber">3 Pending</span>
      </div>
    </div>
    <div className="panel" style={{padding:0}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid #0f2040",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0"}}>CLIENT HUB — SPL-Compressed CRM</div>
          <div style={{fontSize:8,color:"#334155",marginTop:1}}>W3C Verifiable Credentials · WebAuthn · SPL Account Compression</div>
        </div>
        <div className="alpenglow-badge">ConcurrentMerkleTree depth:20</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"80px 1fr 100px 110px 80px 60px",padding:"8px 16px",borderBottom:"1px solid #0a1e38"}}>
        {["ID","Client","AUM","Risk Profile","Status","ZK Cred"].map(h=>(
          <div key={h} style={{fontSize:9,color:"#334155",letterSpacing:"0.1em",textTransform:"uppercase"}}>{h}</div>
        ))}
      </div>
      {clientData.map((c,i)=>(
        <div key={i} className="table-row" style={{display:"grid",gridTemplateColumns:"80px 1fr 100px 110px 80px 60px",padding:"10px 16px",alignItems:"center"}}>
          <div style={{fontSize:9,color:"#334155",fontFamily:"'Space Mono',monospace"}}>{c.id}</div>
          <div style={{fontSize:11,color:"#94a3b8",fontWeight:500}}>{c.name}</div>
          <div style={{fontSize:11,color:"#00d4ff",fontFamily:"'Space Mono',monospace"}}>{c.aum}</div>
          <div>
            <span className={`badge ${c.risk==="Conservative"?"badge-cyan":c.risk==="Moderate"?"badge-amber":"badge-red"}`} style={{fontSize:9}}>{c.risk}</span>
          </div>
          <div>
            <span className={`badge ${c.status==="Active"?"badge-green":c.status==="Review"?"badge-amber":"badge-purple"}`} style={{fontSize:9}}>{c.status}</span>
          </div>
          <div style={{fontSize:12,textAlign:"center"}}>{c.zkCred}</div>
        </div>
      ))}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      <div className="panel" style={{padding:16}}>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:12}}>AUM DISTRIBUTION</div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={clientData.map(c=>({name:c.name.split(" ")[0],aum:parseFloat(c.aum.replace(/[$M]/g,""))}))}>
            <CartesianGrid stroke="#0a1e38" strokeDasharray="3 3"/>
            <XAxis dataKey="name" tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} width={35}/>
            <Tooltip content={<CustomTooltip/>}/>
            <Bar dataKey="aum" fill="#00d4ff" opacity={0.7} radius={[1,1,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="panel" style={{padding:16}}>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>VERIFIABLE CREDENTIAL SCHEMA</div>
        <div style={{fontSize:8,color:"#334155",marginBottom:12}}>W3C VC-DATA-MODEL 2.0 · DID:SOL</div>
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          {[
            "context: https://www.w3.org/2018/credentials/v2",
            "type: [VerifiableCredential, AdvisorLicense]",
            "issuer: did:sol:Zynt1940ActAuthority",
            "credentialSubject:",
            "  id: did:sol:J.Harrington.CFA",
            "  licenseType: RIA_INVESTMENT_ADVISOR",
            "  jurisdiction: SEC_REGISTERED",
            "proof: { type: Dilithium3Signature2024 }",
            "zkProof: { circuit: zkml_advisor_v2.ezkl }",
          ].map((l,i)=>(
            <div key={i} className="zk-proof-line">{l}</div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const SectionSimulator = ()=>{
  const [leverage,setLeverage]=useState(3);
  const [drawdown,setDrawdown]=useState(5);
  const simData=Array.from({length:20},(_,i)=>({
    i,
    base: +(100000*(1+0.06)**i).toFixed(0),
    stress: +(100000*(1+0.06-drawdown/200)**i*(1-(leverage-2)*0.04)).toFixed(0),
    quantum: +(100000*(1+0.04)**i).toFixed(0),
  }));
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:14}}>
        <div className="panel" style={{padding:16}}>
          <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>SCENARIO PARAMETERS</div>
          <div style={{fontSize:8,color:"#334155",marginBottom:16}}>Quantum Threat Modeling · Monte Carlo</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div>
              <label style={{fontSize:9,color:"#64748b",display:"block",marginBottom:6,letterSpacing:"0.08em",textTransform:"uppercase"}}>Max Drawdown ({drawdown}%)</label>
              <input type="range" min={1} max={20} value={drawdown} onChange={e=>setDrawdown(+e.target.value)} style={{width:"100%",padding:0,background:"transparent"}}/>
            </div>
            <div>
              <label style={{fontSize:9,color:"#64748b",display:"block",marginBottom:6,letterSpacing:"0.08em",textTransform:"uppercase"}}>Leverage ({leverage}×)</label>
              <input type="range" min={1} max={5} value={leverage} onChange={e=>setLeverage(+e.target.value)} style={{width:"100%",padding:0,background:"transparent"}}/>
            </div>
            {[
              {label:"Time Horizon",options:["1Y","3Y","5Y","10Y"]},
              {label:"Threat Model",options:["CRQC 2031","Current","Shor 2027","Grover"]},
              {label:"Protocol Mix",options:["Balanced","Aggressive","Conservative"]},
            ].map(f=>(
              <div key={f.label}>
                <label style={{fontSize:9,color:"#64748b",display:"block",marginBottom:6,letterSpacing:"0.08em",textTransform:"uppercase"}}>{f.label}</label>
                <select>
                  {f.options.map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <button className="btn btn-primary" style={{width:"100%",justifyContent:"center",marginTop:4}}>
              ▷ RUN SIMULATION
            </button>
          </div>
        </div>
        <div className="panel" style={{padding:0}}>
          <div style={{padding:"12px 16px",borderBottom:"1px solid #0f2040"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0"}}>PORTFOLIO PROJECTION</div>
            <div style={{fontSize:8,color:"#334155",marginTop:1}}>Base · Stress (DD:{drawdown}% Lev:{leverage}×) · Quantum threat scenario</div>
          </div>
          <div style={{padding:16}}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={simData}>
                <CartesianGrid stroke="#0a1e38" strokeDasharray="3 3"/>
                <XAxis dataKey="i" tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} label={{value:"Years",position:"insideBottom",fontSize:8,fill:"#334155"}}/>
                <YAxis tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} width={55} tickFormatter={v=>`$${(v/1000).toFixed(0)}K`}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Line type="monotone" dataKey="base" stroke="#00ff88" strokeWidth={2} dot={false} name="Base Case"/>
                <Line type="monotone" dataKey="stress" stroke="#ff3366" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Stress"/>
                <Line type="monotone" dataKey="quantum" stroke="#8b5cf6" strokeWidth={1} dot={false} strokeDasharray="2 2" name="Quantum Threat"/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <QuantumShadowWidget/>
    </div>
  );
};

const SectionOptimizer = ()=>(
  <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <div className="panel" style={{padding:16}}>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>PLONK ZK REBALANCER</div>
        <div style={{fontSize:8,color:"#334155",marginBottom:16}}>
          Zero-knowledge proof of optimal rebalancing · Solana Anchor CPI
          <br/>{/* Alpenglow: rebalance tx confirmed in ≤400ms */}
          // Alpenglow: rebalance CPI confirms in 1 slot ≤400ms
        </div>
        {portfolioData.map((p,i)=>(
          <div key={i} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:10,color:"#94a3b8"}}>{p.name}</span>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:10,color:p.color,fontFamily:"'Space Mono',monospace"}}>{p.value}%</span>
                <span style={{fontSize:8,color:"#334155"}}>target:{Math.max(5,p.value+Math.round((Math.random()-0.5)*4))}%</span>
              </div>
            </div>
            <div className="risk-bar">
              <div className="risk-fill" style={{width:`${p.value}%`,background:p.color}}/>
            </div>
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <button className="btn btn-primary">⊕ GENERATE PROOF</button>
          <button className="btn">⊞ SIMULATE</button>
        </div>
      </div>
      <div className="panel" style={{padding:16}}>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>ZK PROOF VERIFICATION</div>
        <div style={{fontSize:8,color:"#334155",marginBottom:12}}>PLONK backend · Solana verify_proof syscall</div>
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          {[
            "// Anchor: use plonk_verifier::verify_rebalance_proof",
            "pub struct RebalanceProof {",
            "  pub proof: [u8; 192],  // PLONK proof bytes",
            "  pub public_inputs: Vec<u64>,  // target weights",
            "  pub vk_hash: [u8; 32],  // verifying key hash",
            "  pub merkle_root: [u8; 32], // SPL-compressed state",
            "}",
            "",
            "fn verify_and_execute(ctx: Context<Rebalance>,",
            "    proof: RebalanceProof) -> Result<()> {",
            "  // 1. Verify PLONK proof on-chain",
            "  verify_plonk_proof(&proof)?;",
            "  // 2. Execute Token-2022 transfers",
            "  // 3. Update Merkle audit trail",
            "  // Alpenglow: confirmed in ≤400ms",
            "}",
          ].map((l,i)=>(
            <div key={i} className="zk-proof-line">
              {l.includes("verify")||l.includes("PLONK")||l.includes("Result")
                ?<span style={{color:"#00d4ff44"}}>{l}</span>:l}
            </div>
          ))}
        </div>
      </div>
    </div>
    <div className="panel" style={{padding:16}}>
      <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:12}}>EFFICIENT FRONTIER — ZK VERIFIED WEIGHTS</div>
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart>
          <CartesianGrid stroke="#0a1e38" strokeDasharray="3 3"/>
          <XAxis dataKey="x" name="Risk" tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} label={{value:"Risk σ",position:"insideBottom",fontSize:8,fill:"#334155"}}/>
          <YAxis dataKey="y" name="Return" tick={{fontSize:8,fill:"#334155"}} axisLine={false} tickLine={false} width={35} label={{value:"Return %",angle:-90,position:"insideLeft",fontSize:8,fill:"#334155"}}/>
          <Tooltip content={<CustomTooltip/>}/>
          <Scatter data={Array.from({length:40},()=>({x:+(0.05+Math.random()*0.25).toFixed(3),y:+(2+Math.random()*9).toFixed(2)}))} fill="#00d4ff" opacity={0.5} r={3}/>
          <Scatter data={[{x:0.12,y:7.2},{x:0.15,y:8.1},{x:0.18,y:8.9}]} fill="#00ff88" opacity={0.9} r={5} name="Optimal"/>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  </div>
);

const SectionTrade = ()=>(
  <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:14}}>
      <div className="panel" style={{padding:16}}>
        <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>PLACE ORDER</div>
        <div style={{fontSize:8,color:"#334155",marginBottom:16}}>Jupiter Aggregator · ZK execution proof</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[
            {label:"Pair",type:"select",opts:["SOL/USDC","JUP/USDC","mSOL/SOL","BONK/USDC"]},
            {label:"Side",type:"select",opts:["BUY","SELL"]},
            {label:"Order Type",type:"select",opts:["MARKET","LIMIT","TWAP","ZK-SPLIT"]},
            {label:"Notional (USD)",type:"input",ph:"Enter amount…"},
            {label:"Max Slippage",type:"select",opts:["0.01%","0.05%","0.1%","0.5%"]},
            {label:"Leverage",type:"select",opts:["1×","2×","3×","4×","5×"]},
          ].map(f=>(
            <div key={f.label}>
              <label style={{fontSize:9,color:"#64748b",display:"block",marginBottom:5,letterSpacing:"0.08em",textTransform:"uppercase"}}>{f.label}</label>
              {f.type==="select"
                ?<select>{f.opts.map(o=><option key={o}>{o}</option>)}</select>
                :<input type="text" placeholder={f.ph}/>
              }
            </div>
          ))}
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button className="btn btn-primary" style={{flex:1,justifyContent:"center"}}>▷ EXECUTE + PROVE</button>
          </div>
          <div style={{fontSize:8,color:"#1a3a6e",lineHeight:1.6,marginTop:4}}>
            // ZK execution: generate PLONK proof of best execution<br/>
            // Dilithium-3 sign order · anchor submit<br/>
            // Alpenglow settle: ≤400ms finality
          </div>
        </div>
      </div>
      <div className="panel" style={{padding:0}}>
        <div style={{padding:"12px 16px",borderBottom:"1px solid #0f2040"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0"}}>TRADE BOOK</div>
          <div style={{fontSize:8,color:"#334155",marginTop:1}}>Jupiter CPI · Merkle-logged · Dilithium-3 signed</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"70px 110px 60px 100px 90px 70px 70px 50px",padding:"8px 16px",borderBottom:"1px solid #0a1e38"}}>
          {["ID","Pair","Side","Notional","Price","Slippage","ZK","Time"].map(h=>(
            <div key={h} style={{fontSize:9,color:"#334155",letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</div>
          ))}
        </div>
        {tradeBook.map((t,i)=>(
          <div key={i} className="table-row" style={{display:"grid",gridTemplateColumns:"70px 110px 60px 100px 90px 70px 70px 50px",padding:"10px 16px",alignItems:"center"}}>
            <div style={{fontSize:9,color:"#334155",fontFamily:"'Space Mono',monospace"}}>{t.id}</div>
            <div style={{fontSize:11,color:"#94a3b8"}}>{t.pair}</div>
            <div><span className={`badge ${t.side==="BUY"?"badge-green":"badge-red"}`} style={{fontSize:9}}>{t.side}</span></div>
            <div style={{fontSize:11,color:"#00d4ff",fontFamily:"'Space Mono',monospace"}}>{t.size}</div>
            <div style={{fontSize:10,color:"#e2e8f0",fontFamily:"'Space Mono',monospace"}}>{t.price}</div>
            <div style={{fontSize:9,color:"#475569"}}>{t.slippage}</div>
            <div style={{fontSize:11,color:"#00ff88",textAlign:"center"}}>{t.zkProof}</div>
            <div style={{fontSize:8,color:"#334155",fontFamily:"'Space Mono',monospace"}}>{t.ts}</div>
          </div>
        ))}
      </div>
    </div>
    <AuditTrailPanel/>
  </div>
);

const SectionDAO = ()=>(
  <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
      {[
        {title:"Active Proposals",val:"7",sub:"2 requiring your vote",col:"#00d4ff"},
        {title:"DAO Treasury",val:"$4.2M",sub:"Multisig 4-of-7",col:"#00ff88"},
        {title:"Voting Power",val:"12.4%",sub:"Delegated + native",col:"#8b5cf6"},
      ].map((m,i)=>(
        <div key={i} className="metric-card">
          <div style={{fontSize:8,color:"#334155",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>{m.title}</div>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:24,fontWeight:800,color:m.col}}>{m.val}</div>
          <div style={{fontSize:9,color:"#475569",marginTop:4}}>{m.sub}</div>
        </div>
      ))}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:14}}>
      <div className="panel" style={{padding:0}}>
        <div style={{padding:"12px 16px",borderBottom:"1px solid #0f2040"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0"}}>ACTIVE PROPOSALS</div>
          <div style={{fontSize:8,color:"#334155",marginTop:1}}>WebAuthn gated · Dilithium-3 vote signatures · VC-verified members</div>
        </div>
        {[
          {id:"ZDP-041",title:"Increase RWA allocation to 28%",for:68,against:18,quorum:82,status:"ACTIVE",end:"14h"},
          {id:"ZDP-040",title:"Add Kamino Real Yield strategy",for:91,against:4,quorum:95,status:"PASSED",end:"—"},
          {id:"ZDP-039",title:"Adjust drawdown threshold 5%→4.5%",for:44,against:38,quorum:82,status:"ACTIVE",end:"2d"},
          {id:"ZDP-038",title:"Enable confidential transfers v2",for:77,against:9,quorum:86,status:"PASSED",end:"—"},
        ].map((p,i)=>(
          <div key={i} className="table-row" style={{padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"start",justifyContent:"space-between",marginBottom:8}}>
              <div>
                <span style={{fontSize:9,color:"#334155",fontFamily:"'Space Mono',monospace",marginRight:8}}>{p.id}</span>
                <span style={{fontSize:11,color:"#94a3b8"}}>{p.title}</span>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                <span className={`badge ${p.status==="PASSED"?"badge-green":"badge-amber"}`} style={{fontSize:9}}>{p.status}</span>
                {p.status==="ACTIVE"&&<span style={{fontSize:9,color:"#334155"}}>ends {p.end}</span>}
              </div>
            </div>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:8,color:"#00ff88"}}>FOR {p.for}%</span>
                  <span style={{fontSize:8,color:"#ff3366"}}>AGAINST {p.against}%</span>
                  <span style={{fontSize:8,color:"#334155"}}>QUORUM {p.quorum}%</span>
                </div>
                <div style={{height:4,background:"#0f2040",borderRadius:1,overflow:"hidden",display:"flex"}}>
                  <div style={{width:`${p.for}%`,background:"#00ff88",transition:"width 0.5s"}}/>
                  <div style={{width:`${p.against}%`,background:"#ff3366"}}/>
                </div>
              </div>
              {p.status==="ACTIVE"&&(
                <div style={{display:"flex",gap:6}}>
                  <button className="btn" style={{padding:"3px 10px",fontSize:9,color:"#00ff88",borderColor:"#00ff8840"}}>✓ FOR</button>
                  <button className="btn" style={{padding:"3px 10px",fontSize:9,color:"#ff3366",borderColor:"#ff336640"}}>✗ AGAINST</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div className="panel" style={{padding:16}}>
          <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>YOUR CREDENTIALS</div>
          <div style={{fontSize:8,color:"#334155",marginBottom:12}}>WebAuthn · W3C VC 2.0 · DID:SOL</div>
          {[
            {label:"Auth Method",val:"WebAuthn Passkey"},
            {label:"Credential Type",val:"RIA_ADVISOR_VC"},
            {label:"Issuer",val:"did:sol:ZyntDAO"},
            {label:"Expires",val:"2026-12-31"},
            {label:"Dilithium-3 Key",val:"Dil3…f9a2"},
            {label:"Voting Power",val:"12.4%"},
          ].map(r=>(
            <div key={r.label} className="param-row">
              <span className="param-label">{r.label}</span>
              <span className="param-value" style={{fontSize:10}}>{r.val}</span>
            </div>
          ))}
          <button className="btn btn-primary" style={{width:"100%",justifyContent:"center",marginTop:12}}>🔐 RE-AUTHENTICATE</button>
        </div>
        <div className="panel" style={{padding:16}}>
          <div style={{fontSize:11,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>DAO TREASURY</div>
          <div style={{fontSize:8,color:"#334155",marginBottom:10}}>4-of-7 multisig · SPL-compressed</div>
          <ResponsiveContainer width="100%" height={100}>
            <PieChart>
              <Pie data={[{name:"SOL",value:40},{name:"USDC",value:35},{name:"JUP",value:15},{name:"Other",value:10}]}
                cx="50%" cy="50%" innerRadius={28} outerRadius={42} paddingAngle={2} dataKey="value">
                {["#00d4ff","#00ff88","#8b5cf6","#475569"].map((c,i)=><Cell key={i} fill={c}/>)}
              </Pie>
              <Tooltip content={<CustomTooltip/>}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  </div>
);

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function ZyntProtocol() {
  const [section,setSection]=useState("dashboard");
  const [navTab,setNavTab]=useState("dashboard");

  const sections={
    dashboard:<SectionDashboard/>,
    yield:<SectionYield/>,
    risk:<SectionRisk/>,
    clients:<SectionClients/>,
    simulator:<SectionSimulator/>,
    optimizer:<SectionOptimizer/>,
    trade:<SectionTrade/>,
    dao:<SectionDAO/>,
  };

  const navItems=[
    {id:"dashboard",label:"Dashboard"},
    {id:"yield",label:"Yield / RWA"},
    {id:"risk",label:"Risk Fortress"},
    {id:"clients",label:"Client Hub"},
    {id:"simulator",label:"Planning Simulator"},
    {id:"optimizer",label:"Portfolio Optimizer"},
    {id:"trade",label:"Trade Desk"},
    {id:"dao",label:"Advisor DAO"},
  ];

  const handleNav=(id)=>{setSection(id);setNavTab(id);};

  return(
    <>
      <style>{globalCSS}</style>
      <div className="zynt-app">
        <div className="scanline-overlay"/>
        <div className="noise-overlay"/>
        <Header/>
        <TickerBar/>
        {/* Top Nav */}
        <div style={{background:"#040c18",borderBottom:"1px solid #0f2040",display:"flex",alignItems:"center",paddingLeft:8,overflowX:"auto",position:"sticky",top:60,zIndex:99}}>
          {navItems.map(n=>(
            <div key={n.id} className={`nav-tab${navTab===n.id?" active":""}`} onClick={()=>handleNav(n.id)}>
              {n.label}
            </div>
          ))}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12,padding:"0 16px"}}>
            <div style={{fontSize:9,color:"#1a3a6e",fontFamily:"'Space Mono',monospace"}}>
              // rust anchor 0.31 · token-2022 · spl-account-compression · pyth-sdk-solana
            </div>
          </div>
        </div>
        {/* Body */}
        <div style={{display:"flex",minHeight:"calc(100vh - 120px)"}}>
          <Sidebar active={section} onNav={handleNav}/>
          <main style={{flex:1,padding:16,overflowY:"auto",overflowX:"hidden",maxWidth:"calc(100vw - 48px)"}}>
            {/* Section header */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div>
                <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,color:"#e2e8f0",letterSpacing:"0.04em",textTransform:"uppercase"}}>
                  {navItems.find(n=>n.id===section)?.label}
                </h1>
                <div style={{fontSize:8,color:"#1a3a6e",letterSpacing:"0.08em",marginTop:2}}>
                  {/* Anchor program references */}
                  {section==="dashboard"&&"hybrid_vault.rs · regulatory_oracle.rs · audit_merkle.rs"}
                  {section==="yield"&&"yield_router.rs · aave_hook.rs · jupiter_cpi.rs · kamino_vault.rs"}
                  {section==="risk"&&"risk_fortress.rs · zkml_oracle.rs · pyth_gating.rs · anomaly_detector.ezkl"}
                  {section==="clients"&&"client_crm.rs · spl_account_compression · vc_verifier.rs"}
                  {section==="simulator"&&"quantum_simulator.rs · monte_carlo.rs · threat_model.ezkl"}
                  {section==="optimizer"&&"plonk_rebalancer.rs · efficient_frontier.rs · zk_weights.rs"}
                  {section==="trade"&&"trade_executor.rs · jupiter_aggregator_cpi.rs · slippage_guard.rs"}
                  {section==="dao"&&"advisor_dao.rs · webauthn_verifier.rs · vc_credential_check.rs"}
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <div className="alpenglow-badge">Slot 312,481,944</div>
                <span className="badge badge-green">MAINNET</span>
              </div>
            </div>
            {/* Section content */}
            {sections[section]}
            {/* Footer */}
            <div style={{marginTop:20,paddingTop:14,borderTop:"1px solid #0a1428"}}>
              <ComplianceLine/>
              <div style={{marginTop:8,fontSize:8,color:"#1a3a6e",lineHeight:1.8}}>
                ZYNT PROTOCOL v3.1 · Solana Mainnet · Alpenglow-aware ≤400ms finality · 
                Dilithium-3 post-quantum signatures · SPL Account Compression audit trails · 
                Pyth oracle feeds · ZKML anomaly detection (AUC 0.961) · PLONK ZK rebalancing · 
                Investment Advisers Act of 1940 compliant · SEC ETF rule aligned · 
                WebAuthn + W3C Verifiable Credentials · Token-2022 extensions · 
                Service Worker offline-first · Zero-trust architecture
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
