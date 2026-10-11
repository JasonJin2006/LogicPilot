import React, {useEffect,useRef,useState} from 'react';
import {createScene} from './scene.js';
import {COLORS} from './model.mjs';
import {frameAt} from './simulation.mjs';
import css from './style.css';
const PACKAGE='@logicpilot/dsh-des';
const KIND='logicpilot';
export const inject=['slots','sidebarRightTabs','sidebarRight','locale'];
const fmt=n=>Number.isFinite(n)?n.toLocaleString('zh-CN',{maximumFractionDigits:1}):'—';
const names={source:'到达',queue:'队列',service:'服务',delay:'延时',sink:'离开'};
function clientModel(session){
  let state={loading:true,revision:-1,model:null,result:null,warnings:[],error:null,time:0,playing:false,speed:1},stopped=false,timer,clock,request=null;
  const listeners=new Set(),url=`/api/logicpilot-des/model?session=${encodeURIComponent(session)}`;
  const publish=next=>{state=next;for(const fn of listeners)fn();};
  async function refresh(){if(stopped||request)return;request=new AbortController();try{const response=await fetch(url+'&revision='+state.revision,{signal:request.signal});const next=await response.json();if(!response.ok)throw new Error(next.error||'读取失败');if(!stopped&&!next.unchanged&&next.revision>state.revision)publish({...state,...next,time:0,playing:false,loading:false,error:null});else if(!stopped&&state.error)publish({...state,error:null});}catch(e){if(!stopped&&e.name!=='AbortError')publish({...state,loading:false,error:e.message});}finally{request=null;}}
  const source={getSnapshot:()=>state,subscribe(fn){listeners.add(fn);if(listeners.size===1){void refresh();timer=setInterval(refresh,1200);let last=performance.now();clock=setInterval(()=>{const now=performance.now(),delta=(now-last)/1000;last=now;if(state.playing&&state.result){const time=Math.min(state.result.duration,state.time+delta*state.result.duration/40*state.speed);publish({...state,time,playing:time<state.result.duration});}},33);}return()=>{listeners.delete(fn);if(!listeners.size){clearInterval(timer);clearInterval(clock);request?.abort();}};}};
  async function command(action,model,baseRevision){const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,model,baseRevision:baseRevision??state.revision})});const next=await response.json();if(!response.ok){void refresh();throw new Error(next.error||'操作失败');}if(next.revision>=state.revision)publish({...state,...next,time:0,playing:action==='run',loading:false,error:null});return next;}
  const playback=patch=>publish({...state,...patch});
  return {source,command,refresh,playback,dispose(){stopped=true;clearInterval(timer);clearInterval(clock);request?.abort();listeners.clear();}};
}
function Icon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h6v6H4zM15 12h5v7h-5zM10 10h7v2M7 13v5h8"/></svg>;}
const Play=()=><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>;
const Pause=()=><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor"/></svg>;
const Split=()=><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M12 5.5v13"/></svg>;
const Braces=()=><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M9.5 4.5H8A2 2 0 0 0 6 6.5v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1.5M14.5 4.5H16a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1.5"/></svg>;
const Download=()=><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14"/></svg>;
const Reset=()=><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9M20.5 4v4.5H16"/></svg>;
function Header({open}){return <button className="lp-header" onClick={open} title="打开 LogicPilot 仿真面板"><Icon/>LogicPilot</button>;}
function Flow({model,result,time,selected,onSelect}){
  const counts={};for(const e of frameAt(result,time)){const key=e.segment.node;if(key)counts[key]=(counts[key]??0)+1;}
  const order=[];let id=model.nodes.find(n=>n.type==='source').id;while(id){order.push(model.nodes.find(n=>n.id===id));id=model.links.find(l=>l.from===id)?.to;}
  const cols=order.length>8?3:2,rows=Math.ceil(order.length/cols),pitchX=195,pitchY=138;
  const coords=new Map(order.map((n,i)=>[n.id,{x:30+(i%cols)*pitchX,y:42+Math.floor(i/cols)*pitchY}]));
  const width=30+(cols-1)*pitchX+158+20,height=rows*pitchY+4;
  return <div className="lp-flow"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="离散事件流程图">
    <defs><marker id="lp-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" className="lp-arrow-head"/></marker><pattern id="lp-dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" className="lp-dot"/></pattern></defs>
    <rect width="100%" height="100%" className="lp-flow-bg"/>
    {model.links.map(l=>{const a=coords.get(l.from),b=coords.get(l.to),wrap=b.y!==a.y;const path=wrap?`M${a.x+78} ${a.y+70} V${a.y+100} H${b.x+78} V${b.y-6}`:`M${a.x+158} ${a.y+35} H${b.x-7}`;return <g key={l.from}><path className="lp-link" d={path} markerEnd="url(#lp-arrow)"/>{!wrap&&l.travelSeconds>0&&<text className="lp-link-label" x={a.x+175} y={a.y+24} textAnchor="middle">{l.travelSeconds}s</text>}</g>;})}
    {order.map(n=>{const p=coords.get(n.id),util=result?.stations[n.id]?.utilization;return <g key={n.id} className={`lp-node${selected===n.id?' lp-node-on':''}`} transform={`translate(${p.x},${p.y})`} role="button" tabIndex="0" aria-label={`选择 ${n.label}`} onClick={()=>onSelect(n.id)} onKeyDown={e=>{if(e.key==='Enter')onSelect(n.id);}}>
      <rect className="lp-node-box" width="158" height="70" rx="10" style={selected===n.id?{stroke:COLORS[n.type],strokeWidth:2}:undefined}/>
      <rect x="0" y="16" width="3" height="38" rx="1.5" style={{fill:COLORS[n.type]}}/>
      <text className="lp-node-type" x="13" y="21" style={{fill:COLORS[n.type]}}>{names[n.type]}{n.servers?` · ${n.servers} 台`:''}</text>
      <text className="lp-node-label" x="13" y="43">{n.label}</text>
      <text className="lp-node-sub" x="13" y="60">{n.type==='source'?`平均间隔 ${n.interarrival}s`:n.duration?`平均处理 ${n.duration}s`:`${n.size[0]} × ${n.size[2]} m`}</text>
      {!!counts[n.id]&&<g><circle className="lp-badge" cx="144" cy="9" r="10" style={{fill:COLORS[n.type]}}/><text className="lp-badge-text" x="144" y="13" textAnchor="middle">{counts[n.id]}</text></g>}
      {util!==undefined&&<text className="lp-node-metric" x="79" y="88" textAnchor="middle">利用率 {fmt(util*100)}% · 最大等待 {result.stations[n.id].maxQueue}</text>}
    </g>;})}
  </svg></div>;
}
function Scene({model,result,time,selected,onSelect}){
  const mount=useRef(),engine=useRef(),[error,setError]=useState(null);
  useEffect(()=>{try{setError(null);engine.current=createScene(mount.current,model,onSelect);}catch(e){setError('3D 初始化失败：'+e.message);}return()=>{engine.current?.dispose();engine.current=null;};},[model]);
  useEffect(()=>{engine.current?.update(result,time,selected);},[model,result,time,selected]);
  return <div className="lp-scene"><div ref={mount} className="lp-webgl"/>{error&&<div className="lp-error">{error}</div>}<button className="lp-camera" onClick={()=>engine.current?.reset()} title="重置视角" aria-label="重置视角"><Reset/></button></div>;
}
function Inspector({node,model,revision,save,busy}){
  const [draft,setDraft]=useState(node);useEffect(()=>setDraft(node),[node]);
  if(!node||!draft)return null;
  const field=(key,value)=>setDraft({...draft,[key]:value});
  const vector=(key,label)=> <label className="lp-vector-label">{label}<div className="lp-vector">{draft[key].map((v,i)=><input key={i} aria-label={`${label} ${['X','Y','Z'][i]}`} type="number" step="0.1" value={v} onChange={e=>field(key,draft[key].map((x,j)=>j===i?Number(e.target.value):x))}/>)}</div></label>;
  return <div className="lp-inspector"><div className="lp-inspector-title"><span className="lp-dot" style={{background:COLORS[node.type]}}/>{node.label}<small>{names[node.type]}</small></div><div className="lp-fields">
    <label>名称<input value={draft.label} onChange={e=>field('label',e.target.value)}/></label>
    {vector('position','位置 X / Y / Z (m)')}{vector('size','尺寸 宽 / 高 / 深 (m)')}
    <label>方向 (°)<input type="number" value={draft.rotation} onChange={e=>field('rotation',Number(e.target.value))}/></label>
    {node.type==='source'&&<label>平均到达间隔 (s)<input type="number" min=".01" step=".1" value={draft.interarrival} onChange={e=>field('interarrival',Number(e.target.value))}/></label>}
    {['service','delay'].includes(node.type)&&<label>处理时间 / 均值 (s)<input type="number" min=".01" step=".1" value={draft.duration} onChange={e=>field('duration',Number(e.target.value))}/></label>}
    {node.type==='service'&&<label>并行服务台<input type="number" min="1" max="16" value={draft.servers} onChange={e=>field('servers',Number(e.target.value))}/></label>}
    {draft.distribution&&<label>时间分布<select value={draft.distribution} onChange={e=>field('distribution',e.target.value)}><option value="constant">固定时间</option><option value="exponential">指数分布</option></select></label>}
  </div><div className="lp-inspector-actions"><button disabled={busy} onClick={()=>save({...model,nodes:model.nodes.map(n=>n.id===node.id?draft:n)},revision)}>应用修改</button></div></div>;
}
const views=new Set(['flow','scene']);
export function Body({useTabInfo,useModel,command,initialView='flow',split,playback}){
  const info=useTabInfo?useTabInfo():null,navigation=info?.tab?.navigation;
  const state=useModel(x=>x),[view,setView]=useState(views.has(navigation?.params?.view)?navigation.params.view:initialView),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null),[json,setJson]=useState(null),[draftRev,setDraftRev]=useState(null);
  useEffect(()=>{const requested=navigation?.params?.view;if(views.has(requested))setView(requested);},[navigation?.revision]);
  const {model,result,revision,time,playing,speed}=state;
  const setTime=time=>playback({time}),setPlaying=playing=>playback({playing}),setSpeed=speed=>playback({speed});
  async function act(action,m,baseRevision){setBusy(true);setError(null);try{await command(action,m,baseRevision);if(action==='save')setJson(null);}catch(e){setError(e.message);}finally{setBusy(false);}}
  const save=(m,rev)=>act('save',m,rev);
  const download=()=>{const blob=new Blob([JSON.stringify(model,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='logicpilot-model.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  if(state.loading)return <div className="lp-root lp-loading">正在加载…</div>;
  return <div className="lp-root">
    <div className="lp-bar"><div className="lp-seg" role="tablist" aria-label="视图"><button role="tab" aria-selected={view==='flow'} className={view==='flow'?'on':''} onClick={()=>setView('flow')}>流程</button><button role="tab" aria-selected={view==='scene'} className={view==='scene'?'on':''} onClick={()=>setView('scene')}>3D</button></div><span className="lp-spacer"/>{model&&<>{split&&<button className="lp-icon" title="在新分栏中打开另一视图" aria-label="在新分栏中打开另一视图" onClick={()=>split(view==='flow'?'scene':'flow')}><Split/></button>}<button className="lp-icon" title="模型 JSON" aria-label="模型 JSON" onClick={()=>{setJson(JSON.stringify(model,null,2));setDraftRev(revision);}}><Braces/></button><button className="lp-icon" title="导出模型 JSON" aria-label="导出模型 JSON" onClick={download}><Download/></button><button className="lp-primary" disabled={busy} onClick={()=>act('run',undefined,revision)}>{busy?'运行中…':'运行仿真'}</button></>}</div>
    {(error||state.error)&&<div role="alert" className="lp-error">{error||state.error}</div>}
    {!model?<div className="lp-empty"><div className="lp-empty-icon"><Icon/></div><h3>尚未建立模型</h3><p>在对话中描述产线，LogicPilot 会生成流程与米制 3D 布局并运行仿真。</p><button className="lp-primary" disabled={busy} onClick={()=>act('example',undefined,revision)}>载入示例</button></div>:<>
      <div className="lp-head"><h2>{model.name}</h2><span className="lp-dim">{model.site.width} × {model.site.depth} m</span></div>
      {model.description&&<p className="lp-desc">{model.description}</p>}
      {json!==null?<div className="lp-json"><textarea aria-label="模型 JSON" value={json} onChange={e=>setJson(e.target.value)}/><div><button onClick={()=>setJson(null)}>取消</button><button className="lp-primary" disabled={busy} onClick={()=>{try{save(JSON.parse(json),draftRev);}catch(e){setError(e.message);}}}>保存</button></div></div>:view==='flow'?<Flow model={model} result={result} time={time} selected={selected} onSelect={setSelected}/>:<Scene model={model} result={result} time={time} selected={selected} onSelect={setSelected}/>}
      <div className="lp-playback"><button className="lp-icon" disabled={!result} onClick={()=>{if(time>=result.duration)setTime(0);setPlaying(!playing);}} aria-label={playing?'暂停回放':'播放回放'} title={playing?'暂停回放':'播放回放'}>{playing?<Pause/>:<Play/>}</button><input aria-label="仿真时间" type="range" min="0" max={result?.duration||1} step=".1" value={time} disabled={!result} onChange={e=>{setPlaying(false);setTime(Number(e.target.value));}}/><span className="lp-clock">{fmt(time)} / {fmt(result?.duration)} s</span><select aria-label="回放速度" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value=".5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></div>
      <div className="lp-metrics">{[['完成数量',result?.metrics.completed,'件'],['平均等待',result?.metrics.meanWait,'s'],['平均流动时间',result?.metrics.meanCycle,'s'],['吞吐率',result?.metrics.throughputPerHour,'件/h']].map(([title,value,unit])=><div key={title}><small>{title}</small><strong>{fmt(value)}<em>{unit}</em></strong></div>)}</div>
      <div className="lp-experiment"><label>到达数量<input aria-label="到达数量" type="number" min="1" max="500" defaultValue={model.experiment.arrivals} key={`a${revision}`} onBlur={e=>{const value=Number(e.target.value);if(value!==model.experiment.arrivals)save({...model,experiment:{...model.experiment,arrivals:value}},revision);}}/></label><label>随机种子<input aria-label="随机种子" type="number" min="0" defaultValue={model.experiment.seed} key={`s${revision}`} onBlur={e=>{const value=Number(e.target.value);if(value!==model.experiment.seed)save({...model,experiment:{...model.experiment,seed:value}},revision);}}/></label></div>
      {!!state.warnings?.length&&<div className="lp-warnings">{state.warnings.map(w=><p key={w}>{w}</p>)}</div>}
      <Inspector key={`${selected}-${revision}`} node={model.nodes.find(n=>n.id===selected)} model={model} revision={revision} save={save} busy={busy}/>
    </>}
  </div>;
}
export function apply(ctx){
  const style=document.createElement('style');style.textContent=css;document.head.append(style);ctx.effect(()=>()=>style.remove(),'logicpilot.styles');
  const models=new Map(),get=session=>{if(!models.has(session))models.set(session,clientModel(session));return models.get(session);};ctx.effect(()=>()=>{for(const m of models.values())m.dispose();models.clear();},'logicpilot.clients');
  ctx.effect(()=>ctx.sidebarRightTabs.register({id:PACKAGE,kind:KIND,multiple:false,title:()=>'LogicPilot',guide:[{id:'open',order:5,title:()=>'LogicPilot',description:()=>'流程与 3D 场景 · 离散事件仿真',icon:Icon}]}),'logicpilot.tab');
  ctx.effect(()=>ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:PACKAGE,inject:session=>({initialView:'flow',hooks:{model:get(session).source},command:get(session).command,playback:get(session).playback,split:view=>ctx.sidebarRight.openTabIn(session,KIND,{preferNewPane:true,params:{view}})})},Body)),'logicpilot.body');
  ctx.effect(()=>ctx.slots.inject('conversation.session.header.actions',()=>ctx.slots.register({name:'conversation.session.header.actions',id:'logicpilot',order:10,inject:session=>({open:()=>ctx.sidebarRight.openTabIn(session,KIND)})},Header)),'logicpilot.open');
}
