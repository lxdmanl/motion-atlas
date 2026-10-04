/** Validate delivered glTF using the same Three.js skinning path as the app. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'assets/right-arm-source.json')));
const rig = JSON.parse(fs.readFileSync(path.join(root, 'public/models/rig.json')));
const bytes = fs.readFileSync(path.join(root, 'public/models/right-arm.glb'));
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const meshes = [], bones = [];
gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); if (o.isBone) bones.push(o); });
const byId = new Map(meshes.map(m => [m.userData.partId, m]));
assert.equal(byId.size, meshes.length, 'Mesh part IDs must be unique');
assert.deepEqual([...rig.replacedPartIds].sort(), source.parts.map(p => p.id).sort());
let maxRestError = 0;
for (const part of source.parts) {
  const mesh = byId.get(part.id);
  assert.ok(mesh?.isSkinnedMesh, `Missing skinned original mesh ${part.id}`);
  mesh.skeleton.update();
  const grid = new Map(), scale = 1e5;
  for (let i = 0; i < part.positions.length; i += 3) {
    const p = part.positions.slice(i, i + 3), key = p.map(v => Math.round(v * scale)).join(',');
    const bucket = grid.get(key) || [];
    bucket.push(p); grid.set(key, bucket);
  }
  const pos = mesh.geometry.attributes.position, retained = new Set();
  // glTF may duplicate vertices at split-normal seams; triangles and positions remain original.
  assert.equal(mesh.geometry.index.count, part.indices.length, `Original triangle count changed for ${part.id}`);
  for (let i = 0; i < pos.count; i++) {
    const p = mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld);
    const k = p.toArray().map(v => Math.round(v * scale));
    let nearest = Infinity;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      for (const q of grid.get([k[0] + x, k[1] + y, k[2] + z].join(',')) || []) {
        const distance = p.distanceTo(new Vector3(...q));
        nearest = Math.min(nearest, distance);
        if (distance < 2e-6) retained.add(q);
      }
    }
    maxRestError = Math.max(maxRestError, nearest);
    assert.ok(nearest < 2e-6, `Rest alignment changed for ${part.id}: ${nearest}m`);
  }
  assert.equal(retained.size, part.positions.length / 3, `Original source positions missing for ${part.id}`);
}
for (const id of ['tendon-biceps-distal', 'tendon-triceps-distal']) {
  assert.equal(byId.get(id)?.userData.schematic, true);
  assert.equal(byId.get(id)?.userData.system, 'connective');
}
const elbow = bones.find(b => b.name === rig.elbowBoneName);
assert.ok(elbow, 'Elbow control bone must exist');
const rest = elbow.quaternion.clone();
function center(id) {
  const mesh = byId.get(id); mesh.skeleton.update();
  const sum = new Vector3();
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) sum.add(mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld));
  return sum.divideScalar(mesh.geometry.attributes.position.count).toArray();
}
const tests = [0, 60, 110].map(angle => {
  elbow.quaternion.copy(rest).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle * Math.PI / 180 * rig.flexionSign));
  gltf.scene.updateMatrixWorld(true);
  return { angle, radiusCenter: center('FJ3349'), humerusCenter: center('FJ3368') };
});
assert.ok(tests[1].radiusCenter[2] > tests[0].radiusCenter[2] + .05, 'Forearm must move anterior during flexion');
assert.ok(tests[2].radiusCenter[1] > tests[0].radiusCenter[1] + .1, 'Forearm must rise during flexion');
for (const t of tests) assert.deepEqual(t.humerusCenter, tests[0].humerusCenter, 'Shoulder and humerus must remain fixed');
const result = { passed: true, meshes: meshes.length, sourceParts: source.parts.length, schematicParts: 2, bones: bones.map(b => b.name), maxRestErrorMeters: maxRestError, tests };
fs.writeFileSync(path.join(root, 'assets/qa/validation.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
