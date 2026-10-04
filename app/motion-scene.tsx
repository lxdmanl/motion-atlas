import { useEffect, useRef, type MutableRefObject } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Atlas } from './anatomy';
import type { MotionSnapshot, RigManifest, ViewState } from './contracts';
import { decodeModelResponse } from './model-download';
import { PointerTap } from './pointer-tap';

export interface SceneStats { fps: number; triangles: number; drawCalls: number; geometries: number; }
interface Props {
  atlas: Atlas; rig: RigManifest; state: ViewState;
  motion: MutableRefObject<MotionSnapshot>; resetToken: number;
  onSelect: (id: string) => void; onProgress: (n: number) => void;
  onReady: () => void; onError: (error: string) => void;
  onStats: (stats: SceneStats) => void;
  onApplied?: (state: ViewState) => void;
}
const COLORS: Record<string, string> = { skeletal: '#dfded2', muscular: '#a45452', connective: '#6ce3d1' };

export default function MotionScene(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;

  useEffect(() => {
    const el = host.current!;
    const { atlas, rig } = props;
    let disposed = false, ready = false, transitioning = true;
    let lastState: ViewState | null = null, acknowledgedState: ViewState | null = null, lastReset = -1;
    let elbow: T.Object3D | undefined, root: T.Group | undefined;
    let smoothedAngle = 0, frames = 0, elapsed = 0;
    const restRotation = new T.Quaternion(), bend = new T.Quaternion();
    const axis = new T.Vector3(rig.flexionAxis === 'x' ? 1 : 0, rig.flexionAxis === 'y' ? 1 : 0, rig.flexionAxis === 'z' ? 1 : 0);
    const abort = new AbortController();
    let renderer: T.WebGLRenderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch { latest.current.onError('無法啟動 3D。請使用啟用硬體加速的 Chrome 或 Edge。'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor('#0b1016', 0);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.32;
    renderer.domElement.setAttribute('aria-label', '可旋轉與選取的 3D 解剖模型');
    renderer.domElement.setAttribute('role', 'img');
    el.appendChild(renderer.domElement);
    const scene = new T.Scene();
    scene.fog = new T.FogExp2('#0b1016', .18);
    const camera = new T.PerspectiveCamera(35, 1, .01, 30);
    camera.position.set(-.7, 1.1, 3.05);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, .88, 0);
    controls.enableDamping = true; controls.dampingFactor = .09;
    controls.minDistance = .28; controls.maxDistance = 5;
    controls.maxPolarAngle = Math.PI * .94;
    controls.addEventListener('start', () => { transitioning = false; });
    scene.add(new T.HemisphereLight('#f6f2e9', '#344557', 1.6));
    const key = new T.DirectionalLight('#fff1de', 3.0); key.position.set(-2, 3, 4); scene.add(key);
    const rim = new T.DirectionalLight('#68c9da', 2.4); rim.position.set(2, 2, -3); scene.add(rim);
    const fill = new T.DirectionalLight('#afc1d5', 1.0); fill.position.set(3, 1, 2); scene.add(fill);
    const floor = new T.GridHelper(8, 64, '#264546', '#18262d'); floor.position.y = -.012;
    (floor.material as T.Material).transparent = true; (floor.material as T.Material).opacity = .48; scene.add(floor);
    const platform = new T.Mesh(new T.CylinderGeometry(.45, .45, .012, 96), new T.MeshStandardMaterial({ color: '#111e24', roughness: .9 }));
    platform.position.y = -.021; scene.add(platform);
    const ring = new T.Mesh(new T.RingGeometry(.445, .448, 128), new T.MeshBasicMaterial({ color: '#4bbfae', transparent: true, opacity: .45, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -.012; scene.add(ring);

    const staticBody = new T.Group(); scene.add(staticBody);
    const replaced = new Set(rig.replacedPartIds);
    const supported = new Set(Object.keys(COLORS));
    const indexById = new Map(atlas.parts.map((p, i) => [p.id, i]));
    const textureWidth = T.MathUtils.ceilPowerOfTwo(atlas.parts.length);
    const selectionData = new Uint8Array(textureWidth * 4);
    const selectionTexture = new T.DataTexture(selectionData, textureWidth, 1); selectionTexture.needsUpdate = true;
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    const staticMeshes: T.Mesh[] = [], pickers: T.Mesh[] = [], animatedMeshes: T.Mesh[] = [];
    const staticMaterials = new Map<string, T.MeshStandardMaterial>();
    for (const [system, color] of Object.entries(COLORS)) {
      const material = new T.MeshStandardMaterial({ color, roughness: system === 'skeletal' ? .53 : .62, metalness: .05, side: T.DoubleSide });
      material.onBeforeCompile = shader => {
        shader.uniforms.partSelections = { value: selectionTexture };
        shader.uniforms.selectionWidth = { value: textureWidth };
        shader.vertexShader = 'attribute float partIndex; uniform sampler2D partSelections; uniform float selectionWidth; varying float selectedPart;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nselectedPart = texture2D(partSelections, vec2((partIndex + 0.5) / selectionWidth, 0.5)).r;');
        shader.fragmentShader = 'varying float selectedPart;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.95, 0.79), selectedPart * 0.85);');
      };
      staticMaterials.set(system, material); materials.add(material);
    }

    const loadBody = async () => {
      const neededChunks = [...new Set(atlas.parts.filter(p => supported.has(p.system) && !replaced.has(p.id)).map(p => p.chunk))];
      let cursor = 0, count = 0;
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (cursor < neededChunks.length && !disposed) {
          const chunkIndex = neededChunks[cursor++], chunk = atlas.chunks[chunkIndex];
          const compressed = !!chunk.gzip && typeof DecompressionStream !== 'undefined';
          const response = await fetch(compressed ? chunk.gzip! : chunk.url, { signal: abort.signal });
          const buffer = await decodeModelResponse(response, chunk.bytes, compressed);
          if (disposed) return;
          const batches = new Map<string, T.BufferGeometry[]>();
          atlas.parts.forEach((part, i) => {
            if (part.chunk !== chunkIndex || !supported.has(part.system) || replaced.has(part.id)) return;
            const geometry = new T.BufferGeometry();
            geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(buffer, part.positions, part.vertexCount * 3), 3));
            geometry.setAttribute('normal', new T.BufferAttribute(new Int16Array(buffer, part.normals, part.vertexCount * 3), 3, true));
            geometry.setIndex(new T.BufferAttribute(new Uint32Array(buffer, part.indices, part.indexCount), 1));
            geometry.setAttribute('partIndex', new T.BufferAttribute(new Float32Array(part.vertexCount).fill(i), 1));
            geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometries.add(geometry);
            const picker = new T.Mesh(geometry, staticMaterials.get(part.system)); picker.userData = { partId: part.id, system: part.system };
            picker.updateMatrixWorld(); pickers.push(picker);
            const batch = batches.get(part.system) ?? []; batch.push(geometry); batches.set(part.system, batch);
          });
          for (const [system, batch] of batches) {
            const geometry = mergeGeometries(batch, false);
            if (!geometry) throw new Error('解剖模型組合失敗');
            geometries.add(geometry);
            const mesh = new T.Mesh(geometry, staticMaterials.get(system)); mesh.userData.system = system;
            staticMeshes.push(mesh); staticBody.add(mesh);
          }
          count++; latest.current.onProgress(Math.round(count / neededChunks.length * 78));
        }
      }));
    };
    const loadRig = async () => {
      const gltf = await new GLTFLoader().loadAsync(rig.glbUrl);
      if (disposed) {
        gltf.scene.traverse(obj => { if (obj instanceof T.Mesh) { obj.geometry.dispose(); const ms = Array.isArray(obj.material) ? obj.material : [obj.material]; ms.forEach(m => m.dispose()); } });
        return;
      }
      root = gltf.scene;
      elbow = root.getObjectByName(rig.elbowBoneName);
      if (!elbow) throw new Error('右臂骨架缺少肘關節，請重新建置模型。');
      restRotation.copy(elbow.quaternion);
      root.traverse(obj => {
        if (!(obj instanceof T.Mesh)) return;
        const id = String(obj.userData.partId ?? obj.name);
        const sourcePart = atlas.parts.find(p => p.id === id);
        const system = String(obj.userData.system ?? sourcePart?.system ?? 'connective');
        obj.userData.partId = id; obj.userData.system = system;
        const oldMaterials = Array.isArray(obj.material) ? obj.material : [obj.material]; oldMaterials.forEach(m => m.dispose());
        const material = new T.MeshStandardMaterial({ color: COLORS[system] ?? '#6ce3d1', roughness: .55, metalness: .04, side: T.DoubleSide });
        obj.material = material; obj.frustumCulled = false;
        materials.add(material); geometries.add(obj.geometry); animatedMeshes.push(obj);
      });
      scene.add(root);
    };
    Promise.all([loadBody(), loadRig()]).then(() => {
      if (disposed) return; ready = true; lastState = null; latest.current.onProgress(100); latest.current.onReady();
    }).catch(error => { if (!disposed) latest.current.onError(error instanceof Error ? error.message : '3D 模型載入失敗'); });

    const goalTarget = new T.Vector3(), goalPosition = new T.Vector3();
    const setCameraGoal = () => {
      const state = latest.current.state, arm = state.focus === 'arm';
      goalTarget.copy(arm ? new T.Vector3(...rig.elbow).add(new T.Vector3(0, .03, .06)) : new T.Vector3(0, .88, 0));
      const direction = state.view === 'front' ? new T.Vector3(0, .035, 1) : state.view === 'back' ? new T.Vector3(0, .035, -1) : state.view === 'side' ? new T.Vector3(-1, .03, .08) : new T.Vector3(-.4, .055, 1);
      const distance = arm ? Math.max(1.12, 1 / camera.aspect * .72) : Math.max(3.5, 1 / camera.aspect * 2.0);
      goalPosition.copy(goalTarget).addScaledVector(direction.normalize(), distance); transitioning = true;
    };
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); setCameraGoal();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const raycaster = new T.Raycaster(), pointer = new T.Vector2(), tap = new PointerTap();
    const down = (event: PointerEvent) => tap.down(event.pointerId, event.clientX, event.clientY, event.pointerType === 'touch' ? 12 : 5);
    const move = (event: PointerEvent) => tap.move(event.pointerId, event.clientX, event.clientY);
    const cancel = (event: PointerEvent) => tap.cancel(event.pointerId);
    const up = (event: PointerEvent) => {
      if (!ready || !tap.up(event.pointerId, event.clientX, event.clientY)) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera); scene.updateMatrixWorld(true);
      for (const mesh of animatedMeshes) {
        if (mesh instanceof T.SkinnedMesh) { mesh.computeBoundingSphere(); mesh.computeBoundingBox(); }
      }
      const layerEnabled = (mesh: T.Mesh) => latest.current.state.layers[mesh.userData.system as keyof ViewState['layers']];
      const candidates = animatedMeshes.filter(layerEnabled);
      if (latest.current.state.focus === 'body') candidates.push(...pickers.filter(layerEnabled));
      const hits = raycaster.intersectObjects(candidates, false);
      if (hits[0]) latest.current.onSelect(hits[0].object.userData.partId);
    };
    for (const [event, handler] of Object.entries({ pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel })) renderer.domElement.addEventListener(event, handler as EventListener);
    const clock = new T.Clock();
    const animate = () => {
      if (disposed) return;
      const actualDt = clock.getDelta(), dt = Math.min(actualDt, .1), state = latest.current.state, motion = latest.current.motion.current;
      const changed = lastState !== state;
      if (changed) {
        selectionData.fill(0);
        for (const id of state.selected) { const i = indexById.get(id); if (i !== undefined) selectionData[i * 4] = 255; }
        selectionTexture.needsUpdate = true;
        staticBody.visible = state.focus === 'body';
        for (const mesh of staticMeshes) mesh.visible = state.layers[mesh.userData.system as keyof ViewState['layers']];
        for (const mesh of animatedMeshes) {
          mesh.visible = state.layers[mesh.userData.system as keyof ViewState['layers']];
          const material = mesh.material as T.MeshStandardMaterial, selected = state.selected.includes(mesh.userData.partId);
          material.color.set(selected ? '#59e9c5' : COLORS[mesh.userData.system] ?? '#6ce3d1');
          material.emissive.set(selected ? '#164f41' : '#000000'); material.emissiveIntensity = selected ? .45 : 0;
        }
        if (lastState?.focus !== state.focus || lastState?.view !== state.view) setCameraGoal();
        lastState = state;
      }
      if (lastReset !== latest.current.resetToken) { setCameraGoal(); lastReset = latest.current.resetToken; }
      const fresh = Date.now() - motion.capturedAt < 600;
      const targetAngle = motion.angleDeg !== null && fresh && motion.status === 'tracking' ? motion.angleDeg : smoothedAngle;
      smoothedAngle = T.MathUtils.damp(smoothedAngle, T.MathUtils.clamp(targetAngle, 0, 130), 16, dt);
      if (motion.source === 'none' && motion.status === 'idle') smoothedAngle = T.MathUtils.damp(smoothedAngle, 0, 9, dt);
      if (elbow) elbow.quaternion.copy(restRotation).multiply(bend.setFromAxisAngle(axis, T.MathUtils.degToRad(smoothedAngle) * rig.flexionSign));
      if (transitioning) {
        const alpha = 1 - Math.exp(-7 * dt); camera.position.lerp(goalPosition, alpha); controls.target.lerp(goalTarget, alpha);
        if (camera.position.distanceToSquared(goalPosition) < .00001 && controls.target.distanceToSquared(goalTarget) < .00001) transitioning = false;
      }
      floor.visible = platform.visible = ring.visible = state.focus === 'body';
      controls.update(); renderer.render(scene, camera);
      if (ready && !transitioning && acknowledgedState !== state) { acknowledgedState = state; latest.current.onApplied?.(state); }
      frames++; elapsed += actualDt;
      if (elapsed >= 1) {
        latest.current.onStats({ fps: Math.round(frames / elapsed), triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.calls, geometries: renderer.info.memory.geometries });
        el.dataset.ready = String(ready); el.dataset.angle = smoothedAngle.toFixed(1);
        el.dataset.geometries = String(renderer.info.memory.geometries); el.dataset.textures = String(renderer.info.memory.textures);
        el.dataset.fps = String(Math.round(frames / elapsed)); el.dataset.focus = state.focus;
        el.dataset.selection = state.selected.join(',');
        frames = 0; elapsed = 0;
      }
    };
    const onVisibility = () => { renderer.setAnimationLoop(document.hidden ? null : animate); clock.getDelta(); };
    document.addEventListener('visibilitychange', onVisibility); renderer.setAnimationLoop(animate);
    const contextLost = (event: Event) => { event.preventDefault(); ready = false; latest.current.onError('3D 顯示連線中斷，請重新載入模型。'); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    return () => {
      disposed = true; abort.abort(); renderer.setAnimationLoop(null); observer.disconnect(); controls.dispose();
      document.removeEventListener('visibilitychange', onVisibility);
      const skeletons = new Set<T.Skeleton>();
      scene.traverse(obj => { if (obj instanceof T.SkinnedMesh) skeletons.add(obj.skeleton); if (obj instanceof T.Mesh || obj instanceof T.LineSegments) { geometries.add(obj.geometry); const ms = Array.isArray(obj.material) ? obj.material : [obj.material]; ms.forEach(m => materials.add(m)); } });
      skeletons.forEach(skeleton => skeleton.dispose());
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); selectionTexture.dispose();
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [props.atlas, props.rig]);
  return <div className="anatomy-canvas" ref={host} data-testid="anatomy-canvas" />;
}
