export const SCHEMA = 'logicpilot.des/v1';
export const TYPES = ['source', 'queue', 'service', 'delay', 'sink'];
export const COLORS = { source: '#54bfa4', queue: '#d2af69', service: '#759eec', delay: '#bc9de2', sink: '#66c9d5' };
const copy = value => structuredClone(value);
export function exampleModel() {
  const node = (id, label, type, x, z, size, extra = {}) => ({ id, label, type, position: [x, 0, z], size, rotation: 0, ...extra });
  return {
    schema: SCHEMA, name: '微型装配线', description: '来料经装配与检验后出库；尺寸为占位估计，可逐项调整。',
    units: { length: 'm', time: 's' }, site: { width: 28, depth: 16 },
    experiment: { arrivals: 80, seed: 42 },
    nodes: [
      node('in', '来料入口', 'source', 3, 5, [2.4, 1.2, 2], { interarrival: 18, distribution: 'exponential' }),
      node('buffer', '装配等待区', 'queue', 8, 5, [3, 0.12, 2.6]),
      node('assembly', '装配工位', 'service', 13, 5, [3.2, 1.8, 2.2], { duration: 26, distribution: 'exponential', servers: 2 }),
      node('inspectionBuffer', '检验等待区', 'queue', 18, 5, [2.4, 0.12, 2.6]),
      node('inspection', '质量检验', 'service', 23, 5, [2.4, 1.5, 2.2], { duration: 12, distribution: 'constant', servers: 1 }),
      node('out', '成品出库', 'sink', 23, 11, [3, 1, 2.4])
    ],
    links: [ ['in','buffer',3], ['buffer','assembly',0], ['assembly','inspectionBuffer',4], ['inspectionBuffer','inspection',0], ['inspection','out',4] ].map(([from,to,travelSeconds])=>({from,to,travelSeconds}))
  };
}
export function validateModel(input) {
  if (JSON.stringify(input)?.length > 200000) throw new Error('模型文件不能超过 200 KB');
  const m = copy(input), errors = [], warnings = [];
  const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('模型必须是对象');
  if (m.schema !== SCHEMA) errors.push(`schema 必须为 ${SCHEMA}`);
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120) errors.push('模型名称应为 1–120 字符');
  if (m.units?.length !== 'm' || m.units?.time !== 's') errors.push('统一使用米(m)和秒(s)');
  if (!finite(m.site?.width, 2, 1000) || !finite(m.site?.depth, 2, 1000)) errors.push('场地宽深必须为 2–1000 米');
  if (!Number.isInteger(m.experiment?.arrivals) || !finite(m.experiment.arrivals,1,500)) errors.push('到达数量应为 1–500 的整数');
  if (!Number.isInteger(m.experiment?.seed) || !finite(m.experiment.seed,0,4294967295)) errors.push('seed 应为 uint32 整数');
  if (!Array.isArray(m.nodes) || m.nodes.length < 3 || m.nodes.length > 32) throw new Error('第一版支持 3–32 个串联节点');
  if (!Array.isArray(m.links) || m.links.length !== m.nodes.length - 1) errors.push('第一版需要一条无分支串联流程，每个节点都连通');
  const ids = new Set();
  for (const n of m.nodes) {
    if (!n || typeof n !== 'object') {errors.push('节点必须为对象'); continue;}
    if (typeof n.id !== 'string' || !/^[a-zA-Z][\w-]{0,39}$/.test(n.id) || ids.has(n.id)) errors.push('节点 ID 必须唯一，使用字母开头的英文、数字或下划线');
    ids.add(n.id);
    if (!TYPES.includes(n.type)) errors.push(`${n.id}: 不支持的节点类型`);
    if (typeof n.label !== 'string' || !n.label.trim() || n.label.length > 60) errors.push(`${n.id}: label 必须为 1–60 字符`);
    if (!Array.isArray(n.position) || n.position.length !== 3 || !n.position.every(v=>finite(v,0,1000))) errors.push(`${n.id}: position 为非负 [x,y,z] 米`);
    if (!Array.isArray(n.size) || n.size.length !== 3 || !n.size.every(v=>finite(v,0.05,200))) errors.push(`${n.id}: size 为 [宽,高,深] 米，范围 0.05–200`);
    if (!finite(n.rotation, -360, 360)) errors.push(`${n.id}: rotation 为绕 Y 轴旋转角度`);
    if (n.type === 'source' && !finite(n.interarrival,0.01,3600)) errors.push(`${n.id}: interarrival 必须为 0.01–3600 秒`);
    if (['service','delay'].includes(n.type) && !finite(n.duration,0.01,3600)) errors.push(`${n.id}: duration 必须为 0.01–3600 秒`);
    if (['service','source','delay'].includes(n.type) && !['constant','exponential'].includes(n.distribution)) errors.push(`${n.id}: distribution 仅支持 constant/exponential`);
    if (n.type === 'service' && (!Number.isInteger(n.servers) || !finite(n.servers,1,16))) errors.push(`${n.id}: servers 应为 1–16 的整数`);
    if (n.assetRef !== undefined && (typeof n.assetRef !== 'string' || n.assetRef.length > 200)) errors.push(`${n.id}: assetRef 应为资产标识字符串`);
  }
  const nodes = new Map(m.nodes.filter(Boolean).map(n=>[n.id,n])), next = new Map(), incoming = new Map();
  for (const l of m.links ?? []) {
    if (!l || !nodes.has(l.from) || !nodes.has(l.to) || l.from === l.to || next.has(l.from) || incoming.has(l.to)) {errors.push('连接必须引用已存在节点；第一版不支持分支、汇流或自环'); continue;}
    if (!finite(l.travelSeconds,0,3600)) errors.push('travelSeconds 应为 0–3600 秒');
    next.set(l.from,l.to); incoming.set(l.to,l.from);
  }
  const sources = m.nodes.filter(n=>n?.type==='source'), sinks=m.nodes.filter(n=>n?.type==='sink');
  if (sources.length!==1 || sinks.length!==1) errors.push('必须且只能有一个 source 与 sink');
  const order = [], seen = new Set(); let id=sources[0]?.id;
  while (id && !seen.has(id)) {seen.add(id); order.push(id); id=next.get(id);}
  if (order.length!==m.nodes.length || id || order.at(-1)!==sinks[0]?.id || incoming.has(sources[0]?.id)) errors.push('流程必须从 source 连通所有节点并终止于 sink，无环');
  for (const n of m.nodes) if (n?.type==='queue' && nodes.get(next.get(n.id))?.type!=='service') errors.push(`${n.id}: queue 后面必须直接连接 service`);
  if (errors.length) throw new Error(errors.join('\n'));
  for (const n of m.nodes) {
    const a=n.rotation*Math.PI/180, w=Math.abs(Math.cos(a))*n.size[0]+Math.abs(Math.sin(a))*n.size[2], d=Math.abs(Math.sin(a))*n.size[0]+Math.abs(Math.cos(a))*n.size[2];
    if(n.position[0]-w/2<0 || n.position[0]+w/2>m.site.width || n.position[2]-d/2<0 || n.position[2]+d/2>m.site.depth) throw new Error(`${n.label}: 尺寸或位置超出场地边界`);
  }
  for(let i=0;i<m.nodes.length;i++) for(let j=i+1;j<m.nodes.length;j++) {
    const a=m.nodes[i],b=m.nodes[j];
    const footprint=n=>{const t=n.rotation*Math.PI/180;return [Math.abs(Math.cos(t))*n.size[0]+Math.abs(Math.sin(t))*n.size[2],Math.abs(Math.sin(t))*n.size[0]+Math.abs(Math.cos(t))*n.size[2]];};
    const [aw,ad]=footprint(a),[bw,bd]=footprint(b);
    if(Math.abs(a.position[0]-b.position[0])<(aw+bw)/2 && Math.abs(a.position[2]-b.position[2])<(ad+bd)/2 && a.position[1]<b.position[1]+b.size[1] && b.position[1]<a.position[1]+a.size[1]) warnings.push(`${a.label} 与 ${b.label} 的包围盒重叠，请检查布局`);
  }
  return { model:m, order, warnings };
}
