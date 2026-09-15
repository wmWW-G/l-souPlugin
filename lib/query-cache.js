'use strict';
/** 进程内只读查询缓存；成功结果保留至主动失效，失败不覆盖成功快照。 */
class QueryCache {
  constructor(){this.values=new Map();this.pending=new Map();this.generation=0;this.active=0;this.queue=[];}
  /** 清空查询快照并隔离旧的在途请求；无参数，无返回值，不抛异常。 */
  clear(){this.generation++;this.values.clear();this.pending.clear();}
  /** 查询同一参数仅执行一次；work返回{ok}，force跳过快照，limited启用两路并发；返回结果，异常向上传递。 */
  async read(key,work,{force=false,limited=false}={}){
    if(this.pending.has(key))return this.pending.get(key);
    if(!force&&this.values.has(key))return {...this.values.get(key),cached:true};
    const generation=this.generation;
    const task=(async()=>{
      if(limited){if(this.active>=2)await new Promise(resolve=>this.queue.push(resolve));else this.active++;}
      try{
        const result=await work();
        if(result.ok&&generation===this.generation)this.values.set(key,result);
        return result;
      }finally{if(limited){const next=this.queue.shift();if(next)next();else this.active--;}}
    })();
    this.pending.set(key,task);
    try{return await task;}finally{if(this.pending.get(key)===task)this.pending.delete(key);}
  }
}
module.exports={QueryCache};
