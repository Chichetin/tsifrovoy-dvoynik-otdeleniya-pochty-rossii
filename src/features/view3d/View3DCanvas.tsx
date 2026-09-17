/**
 * D01: the Three.js side of the 3D view, loaded lazily by View3D.
 *
 * Model axes go straight into the world: X right, Y up on the plan, Z is
 * height, camera up is +Z. Nothing is rotated here — every prism is extruded
 * from the footprint polygon geometry already computed, so a 37° object is
 * the same shape it is on the canvas (D-010, D-081).
 *
 * Rendering is on demand: a frame is drawn after the scene changes and while
 * the camera moves, not in a loop. Every geometry, material and the renderer
 * itself are disposed on unmount.
 */

import { useEffect, useRef } from 'react';
import {
  Color,
  DirectionalLight,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene as ThreeScene,
  Shape,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Ref } from '../../contracts/model';
import { isSelected, type Scene, type ScenePrism } from './scene';

type Props = { scene: Scene; selection: Ref | null };

type Stage = {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  world: ThreeScene;
  group: Group;
  render: () => void;
  dispose: () => void;
};

const BACKGROUND = '#F4F6F8';
const SELECTED_COLOR = '#FFD43B';
const EDGE_COLOR = '#343A40';
/** Prisms with outlines: solid things whose edges help read the volumes. */
const OUTLINED: ReadonlySet<ScenePrism['kind']> = new Set(['wall', 'object']);

export default function View3DCanvas({ scene, selection }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const framed = useRef<string | null>(null);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    // A renderer that cannot start throws here and lands in View3D's
    // LoadFailure boundary — the message says why, the 2D editor stays.
    const created = createStage(container);
    stage.current = created;
    // The scene effect below runs after this one and fills the group; a
    // resize of the panel only needs a new frame.
    const observer = new ResizeObserver(() => {
      resize(created, container);
      created.render();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      created.dispose();
      stage.current = null;
      framed.current = null;
    };
  }, []);

  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    clearGroup(current.group);
    for (const prism of scene.prisms) {
      current.group.add(...prismMeshes(prism, isSelected(prism, selection)));
    }
    // Re-frame only when the room changes: moving an object must not yank the
    // camera the user has just placed.
    const key = JSON.stringify([scene.bounds, scene.ceilingHeight_m]);
    if (framed.current !== key) {
      frame(current, scene);
      framed.current = key;
    }
    current.render();
  }, [scene, selection]);

  return <div className="view3d__canvas-host" ref={host} />;
}

function createStage(container: HTMLDivElement): Stage {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.dataset['testid'] = 'view3d-canvas';
  renderer.domElement.setAttribute('aria-label', 'Сцена 3D: перетаскивание вращает, колесо приближает');
  container.appendChild(renderer.domElement);

  const world = new ThreeScene();
  world.background = new Color(BACKGROUND);
  const camera = new PerspectiveCamera(50, 1, 0.1, 500);
  camera.up.set(0, 0, 1);

  const sky = new HemisphereLight('#FFFFFF', '#B0B8C0', 1.1);
  const sun = new DirectionalLight('#FFFFFF', 1.2);
  sun.position.set(-6, -10, 14);
  world.add(sky, sun);

  const group = new Group();
  world.add(group);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  const render = () => renderer.render(world, camera);
  controls.addEventListener('change', render);

  const stage: Stage = {
    renderer,
    camera,
    controls,
    world,
    group,
    render,
    dispose: () => {
      controls.removeEventListener('change', render);
      controls.dispose();
      clearGroup(group);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
  resize(stage, container);
  return stage;
}

function resize(stage: Stage, container: HTMLDivElement): void {
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  stage.renderer.setSize(width, height, false);
  stage.camera.aspect = width / height;
  stage.camera.updateProjectionMatrix();
}

/**
 * Camera looks at the room from its south side. The distance comes from the
 * sphere around the room and the narrower of the two view angles, so the
 * whole floor fits whatever the panel's aspect ratio is.
 */
function frame(stage: Stage, scene: Scene): void {
  const { minX, minY, maxX, maxY } = scene.bounds;
  const width = Math.max(maxX - minX, 1);
  const depth = Math.max(maxY - minY, 1);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radius = Math.hypot(width, depth, scene.ceilingHeight_m) / 2;
  const vertical = (stage.camera.fov * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * stage.camera.aspect);
  const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.05;
  // Direction: back and up, 0.8 along -Y to 0.6 up — a three-quarter view.
  stage.camera.position.set(cx, cy - distance * 0.8, distance * 0.6);
  stage.controls.target.set(cx, cy, 0);
  stage.controls.update();
}

function prismMeshes(prism: ScenePrism, selected: boolean): (Mesh | LineSegments)[] {
  if (prism.polygon.length < 3) return [];
  const shape = new Shape(prism.polygon.map(([x, y]) => new Vector2(x, y)));
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(prism.height_m, 0.001),
    bevelEnabled: false,
  });
  const material = new MeshLambertMaterial({
    color: selected ? SELECTED_COLOR : prism.color,
    transparent: prism.opacity < 1,
    opacity: prism.opacity,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.z = prism.base_m;
  mesh.name = `${prism.ref.kind}:${prism.ref.id}`;
  if (!OUTLINED.has(prism.kind) && !selected) return [mesh];

  const edges = new LineSegments(
    new EdgesGeometry(geometry),
    new LineBasicMaterial({ color: selected ? '#E67700' : EDGE_COLOR }),
  );
  edges.position.z = prism.base_m;
  return [mesh, edges];
}

function clearGroup(group: Group): void {
  for (const child of [...group.children]) {
    if (child instanceof Mesh || child instanceof LineSegments) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }
    group.remove(child);
  }
}
