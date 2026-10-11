import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ModelStore } from './store.mjs';
import { exampleModel } from './model.mjs';
export const name='logicpilot-des';
export const inject=['tools','systemPrompt','connection'];
const brief=s=>({revision:s.revision,model:s.model,warnings:s.warnings,result:s.result?{engine:s.result.engine,metrics:s.result.metrics,stations:s.result.stations,duration:s.result.duration,seed:s.result.seed}:null});
export function apply(ctx) {
  const store=new ModelStore(join(process.env.DSH_HOME||join(homedir(),'.dsh'),'logicpilot-des'));
  ctx.connection.fetch.register({path:'/api/logicpilot-des/model',methods:['GET','POST'],requestBody:'buffered',async fetch(request){
    try{
      const session=new URL(request.url).searchParams.get('session');
      if(request.method==='GET'){
        const state=await store.get(session),rev=new URL(request.url).searchParams.get('revision');
        return Response.json(rev!==null&&Number(rev)===state.revision?{unchanged:true,revision:state.revision}:state,{headers:{'cache-control':'no-store'}});
      }
      const text=await request.text();if(text.length>200000)throw new Error('模型文件过大');
      return Response.json(await store.change(session,JSON.parse(text)));
    }catch(e){return Response.json({error:e.message},{status:e.status??400});}
  }});
  const register=(name,description,parameters,execute)=>ctx.tools.register(defineTool({name,description,parameters,
    output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async(args,exec)=>{exec.signal?.throwIfAborted();return execute(args,String(exec.agent.id));}
  }));
  register('logicpilot_get_model','Read this session’s editable DES model, revision, metrics and a complete example/schema. Use before editing. Models are shared with the native DSH right-side LogicPilot panel.',{},async(_a,session)=>({...brief(await store.get(session)),example:exampleModel(),contract:{nodeTypes:['source','queue','service','delay','sink'],position:'[x,y,z] metres: centre on ground plane, y is base elevation',size:'[width,height,depth] metres',rotation:'yaw degrees around Y',limits:'One source and sink, a single connected acyclic chain, up to 32 nodes / 500 arrivals. Each queue must directly precede a service. FIFO unbounded queues. Independent service capacity (servers). constant or exponential durations. Link travelSeconds is simulated transport delay. No collisions/pathfinding/shared pools/breakdowns. assetRef is reserved metadata, not a loaded asset.'}}));
  register('logicpilot_set_model','Create or replace the session DES model and its metre-scale 3D layout. Obtain the schema with logicpilot_get_model. Supply baseRevision for conflict detection. Validates graph, finite sizes and site bounds. Clears old simulation results.',{baseRevision:{type:'integer',required:true},model:{type:'json',required:true}},async(a,session)=>brief(await store.change(session,{action:'save',...a})));
  register('logicpilot_simulate','Run the current session model with the seeded Visual DES engine, persist the actual event replay, and return cycle time, waiting time, throughput and station utilization. Not the C++ kernel. No external model call is needed.',{baseRevision:{type:'integer',required:true}},async(a,session)=>brief(await store.change(session,{action:'run',...a})));
  ctx.systemPrompt.section({name:'logicpilot-des',order:700,text:'For discrete-event modeling, factory/process visualization or queue simulation, use logicpilot_get_model, logicpilot_set_model and logicpilot_simulate. The user sees a native right-sidebar tab named LogicPilot with Flow and 3D views. First read the complete example and revision. Build an explicit single-chain process and coherent 3D metre-scale layout inside site bounds; make queue and equipment footprints distinct with usable spacing. Explain assumed sizes/rates; placeholders are schematic, not validated industrial geometry. Maintain IDs when editing and preserve unrelated fields. Always pass the last revision and inspect spatial warnings. Simulate after requested changes and summarize measured results, never invented numbers. Do not silently approximate unsupported branching/shared resources or claim engineering validation. Use source interarrival/duration in seconds, exponential values are means. Tool writes affect only the session modeling artifact.'});
}
