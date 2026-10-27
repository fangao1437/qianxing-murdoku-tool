import { readGil, findChildListTop, asIdList } from './gil/gilread.mjs';
const g = readGil('512-一二关美术-v308.gil');
const root = g.recs.find(x=>x.id===1073741846);
const cl = findChildListTop(root.field.sub);
const ids = asIdList(cl.payload, true) || [];
console.log('root 子控件 ' + ids.length + ' 个（按列表顺序 = 从下到上）:');
ids.forEach((id,i)=>{ const r=g.recs.find(x=>x.id===Number(id)); console.log('  ' + String(i+1).padStart(2) + '  #' + id + '  ' + (r?r.name:'??')); });
