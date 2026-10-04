/** Extract original atlas meshes without changing vertices or topology. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const atlas = JSON.parse(fs.readFileSync(path.join(root, 'public/models/atlas.json'), 'utf8'));
const sourceCommit = '1c38bf35c254a891200d3cedecfd57abebe83d8d';
const muscularIds = new Set(atlas.parts.filter(p => {
  const n = Number(p.id.slice(2));
  return n >= 1466 && n <= 1518 && /right/i.test(p.name);
}).map(p => p.id));
const carpal = /\b(radius|ulna|humerus|clavicle|scapula|metacarpal|phalanx|capitate|hamate|lunate|pisiform|scaphoid|trapezium|trapezoid|triquetral)\b/i;
const selected = atlas.parts.filter(p => muscularIds.has(p.id) || (p.system === 'skeletal' && /right/i.test(p.name) && carpal.test(p.name) && p.bounds[0][1] > .65));
const chunks = new Map();
const parts = selected.map(p => {
  if (!chunks.has(p.chunk)) chunks.set(p.chunk, fs.readFileSync(path.join(root, 'public', atlas.chunks[p.chunk].url)));
  const bytes = chunks.get(p.chunk);
  const positions = new Float32Array(bytes.buffer, bytes.byteOffset + p.positions, p.vertexCount * 3);
  const normals = new Int16Array(bytes.buffer, bytes.byteOffset + p.normals, p.vertexCount * 3);
  const indices = new Uint32Array(bytes.buffer, bytes.byteOffset + p.indices, p.indexCount);
  return { id: p.id, name: p.name, conceptId: p.conceptId, system: p.id === 'FJ1471' ? 'connective' : p.id === 'FJ1504' ? 'muscular' : p.system,
    sourceSystem: p.system, bounds: p.bounds, positions: [...positions], normals: [...normals].map(x => x / 32767), indices: [...indices] };
});
function bandMean(id, edge, width) {
  const p = parts.find(p => p.id === id), boundary = p.bounds[edge][1], points=[];
  for(let i=0;i<p.positions.length;i+=3) {
    const v=p.positions.slice(i,i+3);
    if (Math.abs(v[1]-boundary)<=width) points.push(v);
  }
  return points.reduce((a,p)=>a.map((v,i)=>v+p[i]/points.length),[0,0,0]);
}
const shoulder = bandMean('FJ3368',1,.025);
const elbow = bandMean('FJ3368',0,.025);
const distalRadius = bandMean('FJ3349',0,.025), distalUlna=bandMean('FJ3391',0,.025);
const wrist=distalRadius.map((v,i)=>(v+distalUlna[i])/2);
// The hinge is the principal medial/lateral direction of distal humeral vertices.
const hp=parts.find(p=>p.id==='FJ3368'), condyle=[];
for(let i=0;i<hp.positions.length;i+=3) if(hp.positions[i+1]<hp.bounds[0][1]+.025) condyle.push(hp.positions.slice(i,i+3).map((v,j)=>v-elbow[j]));
const covariance=Array.from({length:3},()=>[0,0,0]);
for(const v of condyle)for(let i=0;i<3;i++)for(let j=0;j<3;j++)covariance[i][j]+=v[i]*v[j];
let hingeAxis=[1,0,0];
for(let n=0;n<20;n++){hingeAxis=covariance.map(row=>row.reduce((sum,v,i)=>sum+v*hingeAxis[i],0));const len=Math.hypot(...hingeAxis);hingeAxis=hingeAxis.map(v=>v/len);}
if(hingeAxis[0]<0)hingeAxis=hingeAxis.map(v=>-v);
const output={schemaVersion:1,sourceCommit,source:'BodyParts3D 4.0 via human-atlas',units:'meters',upAxis:'Y',parts,shoulder,elbow,wrist,hingeAxis,
  calibration:'Joint centers use 25 mm end bands of original bone vertices; hinge uses distal humeral principal axis. Educational reference geometry, not patient calibration.'};
fs.mkdirSync(path.join(root,'assets'),{recursive:true});
fs.writeFileSync(path.join(root,'assets/right-arm-source.json'),JSON.stringify(output));
console.log(JSON.stringify({parts:parts.length,vertices:parts.reduce((n,p)=>n+p.positions.length/3,0),triangles:parts.reduce((n,p)=>n+p.indices.length/3,0),shoulder,elbow,wrist,hingeAxis},null,2));
