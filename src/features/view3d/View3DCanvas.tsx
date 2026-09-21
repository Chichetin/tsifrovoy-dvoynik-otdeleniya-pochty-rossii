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
 *
 * The GPU can take the context back at any moment — a sleeping tab, a driver
 * reset, one context too many. The canvas then goes black and keeps showing a
 * stale picture, so the loss is caught and said out loud, and when the browser
 * restores the context the whole stage is built again from the same scene.
 */

import { useEffect, useRef, useState } from 'react';
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
  Raycaster,
  Scene as ThreeScene,
  Shape,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Ref } from '../../contracts/model';
import { isSelected, type Scene, type ScenePrism } from './scene';

type Props = { scene: Scene; selection: Ref | null; onSelect: (ref: Ref) => void };

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

export default function View3DCanvas({ scene, selection, onSelect }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const framed = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // Контекст отобрали: рисовать нечем, и чёрный холст надо заменить словами.
  const [lost, setLost] = useState(false);
  // Счётчик пересборки: контекст вернули — сцена собирается заново с нуля.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    // A renderer that cannot start throws here and lands in View3D's
    // LoadFailure boundary — the message says why, the 2D editor stays.
    const created = createStage(container);
    stage.current = created;
    const canvas = created.renderer.domElement;
    const removePicking = attachPicking(created, canvas, (ref) => onSelectRef.current(ref));
    const onLost = (event: Event): void => {
      // Без preventDefault браузер не станет восстанавливать контекст вовсе.
      // Свой слушатель three тоже это делает, но он висит на рендерере, который
      // мы тут же и освобождаем: полагаться на чужой порядок обработчиков в
      // единственном месте, где решается судьба сцены, нельзя.
      event.preventDefault();
      setLost(true);
      // Рендерер на потерянном контексте больше не нужен: `dispose` снимает и
      // собственные слушатели three, поэтому восстановление делаем мы — полной
      // пересборкой сцены, а не частичной реинициализацией мёртвого рендерера.
      created.renderer.dispose();
    };
    const onRestored = (): void => {
      setLost(false);
      setGeneration((value) => value + 1);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    // The scene effect below runs after this one and fills the group; a
    // resize of the panel only needs a new frame.
    const observer = new ResizeObserver(() => {
      resize(created, container);
      created.render();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      removePicking();
      created.dispose();
      stage.current = null;
      framed.current = null;
    };
  }, [generation]);

  useEffect(() => {
    const current = stage.current;
    // Пока контекста нет, наполнять нечего: сцена соберётся при восстановлении.
    if (!current || lost) return;
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
    // `generation` — новая сцена на новом контексте: её надо наполнить заново.
  }, [scene, selection, generation, lost]);

  return (
    <>
      {lost ? (
        <p className="view3d__status" role="alert" data-testid="view3d-context-lost">
          Браузер забрал контекст WebGL, 3D-сцена сейчас не рисуется. 2D-редактор работает
          как обычно — кнопка «2D» в шапке; когда контекст вернётся, сцена соберётся заново
          из текущего плана.
        </p>
      ) : null}
      {/* Хост остаётся в DOM: на нём слушатели контекста, но чёрный холст прячем. */}
      <div
        className="view3d__canvas-host"
        ref={host}
        style={lost ? { display: 'none' } : undefined}
      />
    </>
  );
}

function createStage(container: HTMLDivElement): Stage {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.dataset['testid'] = 'view3d-canvas';
  renderer.domElement.setAttribute('aria-label', 'Сцена 3D: клик выбирает объект, перетаскивание вращает, колесо приближает');
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

/** Click without a camera drag selects the frontmost prism under the pointer. */
function attachPicking(
  stage: Stage,
  canvas: HTMLCanvasElement,
  onSelect: (ref: Ref) => void,
): () => void {
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let down: { x: number; y: number } | null = null;
  let suppressClick = false;

  const pick = (event: { clientX: number; clientY: number }): Ref | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, stage.camera);
    let room: Ref | null = null;
    for (const hit of raycaster.intersectObjects(stage.group.children, false)) {
      if (!(hit.object instanceof Mesh)) continue;
      const ref = hit.object.userData['ref'] as Ref | undefined;
      if (ref === undefined) continue;
      // The room floor lies behind almost every useful hit. Prefer a concrete
      // object/zone/wall/opening; keep the room only as the background choice.
      if (ref.kind !== 'room') return ref;
      room = ref;
    }
    return room;
  };

  const pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    down = { x: event.clientX, y: event.clientY };
    canvas.style.cursor = 'grabbing';
  };
  const pointerMove = (event: PointerEvent): void => {
    if (down !== null) return;
    canvas.style.cursor = pick(event) === null ? 'grab' : 'pointer';
  };
  const pointerUp = (event: PointerEvent): void => {
    const start = down;
    down = null;
    const ref = pick(event);
    canvas.style.cursor = ref === null ? 'grab' : 'pointer';
    suppressClick =
      start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
    if (!suppressClick && start !== null && ref !== null) onSelect(ref);
  };
  const click = (event: MouseEvent): void => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const ref = pick(event);
    if (ref !== null) onSelect(ref);
  };
  const pointerLeave = (): void => {
    down = null;
    canvas.style.cursor = 'grab';
  };

  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointerleave', pointerLeave);
  canvas.addEventListener('click', click);
  return () => {
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointerleave', pointerLeave);
    canvas.removeEventListener('click', click);
  };
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
  // Raycasting gets the concrete mesh, while selection lives in the document.
  // Keep their link on the mesh itself; outlines deliberately stay decorative
  // and never catch a pick.
  mesh.userData['ref'] = prism.ref;
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
