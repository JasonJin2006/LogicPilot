import { validateModel } from './model.mjs';
// Real FIFO event simulation, not a decorative animation or a native-kernel trace.
export function simulate(input) {
  const {model:m,order,warnings}=validateModel(input);
  let seed=m.experiment.seed>>>0, seq=0;
  const rand=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return (seed+0.5)/4294967296;};
  const sample=(mean,distribution)=>distribution==='constant'?mean:-Math.log(1-rand())*mean;
  const nodes=new Map(m.nodes.map(n=>[n.id,n])), links=new Map(m.links.map(l=>[l.from,l]));
  const stations=new Map(m.nodes.filter(n=>n.type==='service').map(n=>[n.id,{queue:[],slots:Array(n.servers).fill(false),busy:0,served:0,maxQueue:0}]));
  const heap=[];
  const less=(a,b)=>a.time<b.time || (a.time===b.time && a.seq<b.seq);
  const push=(event)=>{event.seq=seq++;heap.push(event);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(!less(heap[i],heap[p]))break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;while(true){let j=i*2+1;if(j>=heap.length)break;if(j+1<heap.length&&less(heap[j+1],heap[j]))j++;if(!less(heap[j],heap[i]))break;[heap[i],heap[j]]=[heap[j],heap[i]];i=j;}}return first;};
  const entities=[];let arrival=0;
  const source=nodes.get(order[0]);
  for(let i=0;i<m.experiment.arrivals;i++){arrival+=sample(source.interarrival,source.distribution);entities.push({id:i+1,arrival,completed:null,wait:0,segments:[]});push({time:arrival,kind:'enter',node:source.id,entity:i});}
  let end=0,eventCount=0;
  const advance=(e,node,t)=>{
    const link=links.get(node); if(!link){e.completed=t;return;}
    if(link.travelSeconds>0)e.segments.push({kind:'move',from:node,to:link.to,start:t,end:t+link.travelSeconds});
    push({kind:'enter',node:link.to,time:t+link.travelSeconds,entity:e.id-1,previous:node});
  };
  const startJobs=(id,t)=>{
    const station=stations.get(id),node=nodes.get(id);let slot=station.slots.indexOf(false);
    while(slot>=0 && station.queue.length){
      const job=station.queue.shift(),e=entities[job.entity];station.slots[slot]=true;
      if(t>job.time)e.segments.push({kind:'wait',node:job.waitAt,start:job.time,end:t});
      e.wait+=t-job.time;
      const duration=sample(node.duration,node.distribution);
      e.segments.push({kind:'service',node:id,start:t,end:t+duration,slot});
      station.busy+=duration;station.served++;
      push({kind:'finish',node:id,entity:job.entity,slot,time:t+duration});slot=station.slots.indexOf(false);
    }
    station.maxQueue=Math.max(station.maxQueue,station.queue.length);
  };
  while(heap.length){
    const ev=pop(),e=entities[ev.entity],n=nodes.get(ev.node);end=ev.time;eventCount++;
    if(ev.kind==='finish') {stations.get(n.id).slots[ev.slot]=false;advance(e,n.id,ev.time);startJobs(n.id,ev.time);continue;}
    if(ev.kind==='delayEnd'){advance(e,n.id,ev.time);continue;}
    if(n.type==='service'){
      const prev=nodes.get(ev.previous),waitAt=prev?.type==='queue' && links.get(prev.id).travelSeconds===0?prev.id:n.id;
      stations.get(n.id).queue.push({entity:ev.entity,time:ev.time,waitAt});startJobs(n.id,ev.time);
    } else if(n.type==='delay'){
      const duration=sample(n.duration,n.distribution);e.segments.push({kind:'service',node:n.id,start:ev.time,end:ev.time+duration,slot:0});push({kind:'delayEnd',node:n.id,entity:ev.entity,time:ev.time+duration});
    } else advance(e,n.id,ev.time);
  }
  const avg=key=>entities.reduce((sum,e)=>sum+key(e),0)/entities.length;
  return {engine:'LogicPilot Visual DES 0.1',seed:m.experiment.seed,duration:end,eventCount,warnings,
    metrics:{completed:entities.length,meanWait:avg(e=>e.wait),meanCycle:avg(e=>e.completed-e.arrival),throughputPerHour:entities.length/end*3600},
    stations:Object.fromEntries([...stations].map(([id,s])=>[id,{served:s.served,maxQueue:s.maxQueue,utilization:s.busy/(end*nodes.get(id).servers)}])),entities};
}
export function frameAt(result,time) {
  if(!result)return [];
  return result.entities.filter(e=>e.arrival<=time && e.completed>time).map(e=>({id:e.id,segment:e.segments.find(s=>s.start<=time&&time<s.end)})).filter(e=>e.segment);
}
