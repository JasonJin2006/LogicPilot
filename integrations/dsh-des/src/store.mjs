import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exampleModel, validateModel } from './model.mjs';
import { simulate } from './simulation.mjs';
export class ModelStore {
  constructor(root) { this.root=root; this.locks=new Map(); }
  path(session) {
    if(typeof session!=='string'||!session.trim()||session.length>200) throw new Error('需要有效的会话 ID');
    return join(this.root,createHash('sha256').update(session).digest('hex')+'.json');
  }
  async get(session) {
    try { return JSON.parse(await readFile(this.path(session),'utf8')); }
    catch(error) { if(error.code!=='ENOENT') throw error; return {revision:0,model:null,result:null,warnings:[]}; }
  }
  async change(session,command) {
    const previous=this.locks.get(session)??Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      const state=await this.get(session);
      if(command.baseRevision!==state.revision) {const e=new Error('模型已被其他操作修改，请刷新后重试');e.status=409;throw e;}
      let next;
      if(command.action==='save'||command.action==='example') {
        const {model,warnings}=validateModel(command.action==='example'?exampleModel():command.model);
        next={revision:state.revision+1,model,result:null,warnings};
      } else if(command.action==='run') {
        if(!state.model)throw new Error('请先创建模型');
        next={...state,revision:state.revision+1,result:{...simulate(state.model),modelRevision:state.revision}};
      } else throw new Error('未知操作');
      await mkdir(this.root,{recursive:true});
      const target=this.path(session),temp=target+'.'+randomUUID()+'.tmp';
      try { await writeFile(temp,JSON.stringify(next),'utf8');await rename(temp,target); }
      finally {await unlink(temp).catch(()=>{});}
      return next;
    });
    this.locks.set(session,task);
    try{return await task;}finally{if(this.locks.get(session)===task)this.locks.delete(session);}
  }
}
