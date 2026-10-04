/**
 * D01: the Three.js side of the 3D view, loaded lazily by View3D.
 *
 * Model axes go straight into the world: X right, Y up on the plan, Z is
 * height, camera up is +Z. Nothing is rotated here — every prism is extruded
 * from the footprint polygon geometry already computed, so a 37° object is
 * the same shape it is on the canvas (D-010, D-081).
 *
 * #59: an object whose type has a 3D model is drawn as that model, fitted to
 * its size (models.ts); the prism stays as an invisible proxy that catches the
 * click, so picking works the same for models and boxes. Objects of one model
 * and one size share a fitted geometry and are drawn as one InstancedMesh.
 *
 * Zone names are sprites in the same scene, not page elements: the PNG that
 * "Скачать картинку 3D" saves is the canvas itself, so it carries them. They are
 * kept in their own group, apart from the prisms, and never take a click.
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
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  DirectionalLight,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  Scene as ThreeScene,
  Shape,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TOLERANCE, type Ref } from '../../contracts/model';
import { fitModel, loadModels, modelSource, type FittedPart } from './models';
import { EYE_HEIGHT_M, type VisitorResult } from './visitor';
import { isSelected, type Scene, type SceneLabel, type SceneModel, type ScenePrism } from './scene';

type Props = { scene: Scene; visitor: VisitorResult; selection: Ref | null; onSelect: (ref: Ref) => void; fileName: string };

type Stage = {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  world: ThreeScene;
  sun: DirectionalLight;
  group: Group;
  /** Instanced models; their geometry belongs to `fitted`, not to the meshes. */
  models: Group;
  /** Zone name sprites; the pick ray looks at `group` only. */
  labels: Group;
  /** Fitted geometry by model and size, kept while the scene still uses it. */
  fitted: Map<string, FittedPart[]>;
  /** Room reflections for model materials. */
  environment: Texture;
  render: () => void;
  dispose: () => void;
};

const BACKGROUND = '#F4F6F8';
const SELECTED_COLOR = '#FFD43B';
const EDGE_COLOR = '#343A40';
/** Prisms with outlines: solid things whose edges help read the volumes. */
const OUTLINED: ReadonlySet<ScenePrism['kind']> = new Set(['wall', 'object']);

/**
 * #59: how each kind of prism takes the light. Matte floor and walls, a slight
 * sheen on equipment, glass in openings; equipment and walls cast the soft
 * shadow that grounds them, floor and zones receive it.
 */
const SURFACE: Record<ScenePrism['kind'], { roughness: number; metalness: number; cast: boolean; receive: boolean }> = {
  floor: { roughness: 0.95, metalness: 0, cast: false, receive: true },
  zone: { roughness: 0.9, metalness: 0, cast: false, receive: true },
  wall: { roughness: 0.85, metalness: 0, cast: true, receive: true },
  opening: { roughness: 0.15, metalness: 0.1, cast: false, receive: false },
  object: { roughness: 0.5, metalness: 0.15, cast: true, receive: true },
};
/** Above the slabs of nested zones (2 cm per level), so the floor ring of a selection shows. */
const OUTLINE_LIFT_M = 0.05;
/** Facets meeting at a smaller angle are one surface: no edge line between them. */
const EDGE_ANGLE_DEG = 30;
/** A wall in front of the camera is a hint of glass, not a screen. */
const FADED_WALL_OPACITY = 0.12;
/** Zone name: texture pixels per metre and the font in the same pixels (≈ 0,33 м высота букв). */
const LABEL_PX_PER_M = 80;
const LABEL_FONT_PX = 26;
const LABEL_PAD_PX = 8;
const LABEL_COLOR = '#343A40';
/** Names are drawn after everything, so a wall or a shelf never hides one. */
const LABEL_ORDER = 10;
/** Share of the room environment in the light: reflections without washing out. */
const ENVIRONMENT_INTENSITY = 0.5;
/** Shadow map side: 2048 keeps the edges soft but not blurry on a 15 m room. */
const SHADOW_MAP = 2048;

export default function View3DCanvas({ scene, visitor, selection, onSelect, fileName }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const framed = useRef<string | null>(null);
  // Overview camera kept while the visitor stands at the entrance.
  const [visitorMode, setVisitorMode] = useState(false);
  const visitorRef = useRef(false);
  const saved = useRef<{ position: Vector3; target: Vector3 } | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // Контекст отобрали: рисовать нечем, и чёрный холст надо заменить словами.
  const [lost, setLost] = useState(false);
  // Счётчик пересборки: контекст вернули — сцена собирается заново с нуля.
  const [generation, setGeneration] = useState(0);
  // Счётчик загрузок моделей: файл пришёл — коробки меняются на модели.
  const [modelsLoaded, setModelsLoaded] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    const names = new Set(scene.prisms.flatMap((prism) => (prism.model === undefined ? [] : [prism.model.name])));
    const missing = [...names].filter((name) => modelSource(name) === undefined);
    if (missing.length > 0) void loadModels(missing).then(() => setModelsLoaded((value) => value + 1));
    const placed: { model: SceneModel; base_m: number }[] = [];
    for (const prism of scene.prisms) {
      // Пока модель не пришла или её файла нет, объект остаётся коробкой.
      const drawn = prism.model !== undefined && modelSource(prism.model.name) ? prism.model : undefined;
      if (drawn !== undefined) placed.push({ model: drawn, base_m: prism.base_m });
      current.group.add(...prismMeshes(prism, isSelected(prism, selection), drawn !== undefined));
    }
    placeModels(current, placed);
    placeLabels(current.labels, scene.labels);
    // Machine-readable, like the section's counts: objects that stand as models.
    current.renderer.domElement.dataset['modelsCount'] = String(placed.length);
    current.renderer.domElement.dataset['labelsCount'] = String(current.labels.children.length);
    // Re-frame only when the room changes: moving an object must not yank the
    // camera the user has just placed.
    const key = JSON.stringify([scene.bounds, scene.ceilingHeight_m]);
    if (framed.current !== key && !visitorRef.current) {
      frame(current, scene);
      framed.current = key;
    }
    current.render();
    // `generation` — новая сцена на новом контексте: её надо наполнить заново.
  }, [scene, selection, generation, lost, modelsLoaded]);

  const poseKey = 'pose' in visitor ? JSON.stringify(visitor.pose) : null;
  // Pose is read from the current plan: a moved entrance moves the camera too.
  useEffect(() => {
    const current = stage.current;
    if (!current || lost || !visitorMode || !('pose' in visitor)) return;
    const { position, heading } = visitor.pose;
    current.camera.position.set(position[0], position[1], EYE_HEIGHT_M);
    current.controls.target.set(position[0] + heading[0] * 3, position[1] + heading[1] * 3, EYE_HEIGHT_M);
    current.camera.lookAt(current.controls.target);
    current.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `poseKey` is the pose's value
  }, [visitorMode, poseKey, generation, lost]);

  const enterVisitor = (): void => {
    const current = stage.current;
    if (!current) return;
    saved.current = { position: current.camera.position.clone(), target: current.controls.target.clone() };
    current.controls.enabled = false;
    visitorRef.current = true;
    setVisitorMode(true);
  };

  const leaveVisitor = (): void => {
    const current = stage.current;
    visitorRef.current = false;
    setVisitorMode(false);
    if (!current) return;
    current.controls.enabled = true;
    if (saved.current !== null) {
      current.camera.position.copy(saved.current.position);
      current.controls.target.copy(saved.current.target);
      current.controls.update();
    }
    current.render();
  };

  const savePicture = (): void => {
    const current = stage.current;
    if (!current) return;
    // A canvas keeps its picture only until the frame is shown: draw, then read at once.
    current.render();
    current.renderer.domElement.toBlob((blob) => {
      if (blob === null) {
        setSaveError('Картинка 3D не собралась: холст вернул пустой файл. План и вид не изменились, можно повторить.');
        return;
      }
      setSaveError(null);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

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
      {lost ? null : (
        <div className="view3d__tools">
          <button
            type="button"
            className="files__button"
            onClick={enterVisitor}
            disabled={!('pose' in visitor)}
            aria-pressed={visitorMode}
            title={'pose' in visitor ? 'Камера у входа на высоте 1,6 м, взгляд в зал' : visitor.reason}
          >
            Глазами посетителя
          </button>
          <button type="button" className="files__button" onClick={leaveVisitor} disabled={!visitorMode}>
            Обзор
          </button>
          <button type="button" className="files__button" onClick={savePicture}>
            Скачать картинку 3D
          </button>
          {saveError === null ? null : (
            <p className="view3d__status" role="alert" data-testid="view3d-save-error">
              {saveError}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function createStage(container: HTMLDivElement): Stage {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.domElement.dataset['testid'] = 'view3d-canvas';
  renderer.domElement.setAttribute('aria-label', 'Сцена 3D: клик выбирает объект, перетаскивание вращает, колесо приближает');
  container.appendChild(renderer.domElement);

  const world = new ThreeScene();
  world.background = new Color(BACKGROUND);
  // Soft room light for reflections on models: metal, glass and screens read as
  // such. Not the scene's environment — that would wash out the zone colours.
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  const camera = new PerspectiveCamera(50, 1, 0.1, 500);
  camera.up.set(0, 0, 1);

  const sky = new HemisphereLight('#FFFFFF', '#B0B8C0', 1.3);
  const sun = new DirectionalLight('#FFF6E8', 1.8);
  sun.position.set(-6, -10, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  world.add(sky, sun, sun.target);

  const group = new Group();
  const models = new Group();
  const labels = new Group();
  world.add(group, models, labels);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  // The camera stays above the floor: from below, the plan is a grey slab (#108).
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  const render = () => {
    fadeWalls(group, camera.position, controls.target);
    renderer.render(world, camera);
  };
  controls.addEventListener('change', render);

  const stage: Stage = {
    renderer,
    camera,
    controls,
    world,
    sun,
    group,
    models,
    labels,
    fitted: new Map(),
    environment,
    render,
    dispose: () => {
      controls.removeEventListener('change', render);
      controls.dispose();
      clearGroup(group);
      placeLabels(labels, []);
      placeModels(stage, []);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
  resize(stage, container);
  return stage;
}

/** A wall band's line: the centre of its footprint and the unit normal of its long side. */
type WallLine = { cx: number; cy: number; nx: number; ny: number };

function wallLine(polygon: ScenePrism['polygon']): WallLine {
  let best = { dx: 1, dy: 0, length: 0 };
  polygon.forEach(([x, y], index) => {
    const [nx, ny] = polygon[(index + 1) % polygon.length]!;
    const length = Math.hypot(nx - x, ny - y);
    if (length > best.length) best = { dx: nx - x, dy: ny - y, length };
  });
  const cx = polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length;
  const cy = polygon.reduce((sum, [, y]) => sum + y, 0) / polygon.length;
  return { cx, cy, nx: -best.dy / best.length, ny: best.dx / best.length };
}

/**
 * #59: dollhouse view. A wall that stands between the camera and the point it
 * orbits around turns to glass, so the room is seen through it; its edges stay.
 */
function fadeWalls(group: Group, camera: Vector3, target: Vector3): void {
  for (const child of group.children) {
    const line = child.userData['wallLine'] as WallLine | undefined;
    if (line === undefined || !(child instanceof Mesh || child instanceof LineSegments)) continue;
    const side = (x: number, y: number) => (x - line.cx) * line.nx + (y - line.cy) * line.ny;
    const across = side(camera.x, camera.y) * side(target.x, target.y) < 0;
    const material = child.material as MeshStandardMaterial | LineBasicMaterial;
    if (material.transparent === across) continue;
    material.transparent = across;
    // Band edges of a faded wall would cross the room with lines: they fade further.
    material.opacity = across ? (child instanceof Mesh ? FADED_WALL_OPACITY : FADED_WALL_OPACITY / 2) : 1;
    material.depthWrite = !across;
    material.needsUpdate = true;
  }
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
      // A wall faded to glass is looked through, so it is clicked through too.
      if (hit.object.userData['wallLine'] !== undefined && (hit.object.material as Material).transparent) continue;
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

  // The sun keeps its angle and follows the room; its shadow box covers the
  // whole room and nothing more, so the shadow map is spent on the plan.
  const { sun } = stage;
  sun.position.set(cx - 6, cy - 10, 14);
  sun.target.position.set(cx, cy, 0);
  sun.target.updateMatrixWorld();
  const box = sun.shadow.camera;
  box.left = -radius;
  box.right = radius;
  box.top = radius;
  box.bottom = -radius;
  box.near = 0.5;
  box.far = Math.hypot(6, 10, 14) + radius * 2;
  box.updateProjectionMatrix();
}

/**
 * One InstancedMesh per fitted part for all objects of one model and size.
 * Fitted geometry the scene no longer uses is released here.
 */
function placeModels(stage: Stage, placed: { model: SceneModel; base_m: number }[]): void {
  for (const child of [...stage.models.children]) {
    if (child instanceof InstancedMesh) child.dispose();
    stage.models.remove(child);
  }
  const batches = new Map<string, { model: SceneModel; matrices: Matrix4[] }>();
  for (const { model, base_m } of placed) {
    const key = `${model.name}|${model.size_m.join('|')}`;
    const batch = batches.get(key) ?? { model, matrices: [] };
    // Columns are the object's local axes, so the model turns with the footprint.
    batch.matrices.push(new Matrix4().set(
      model.xAxis[0], model.yAxis[0], 0, model.center[0],
      model.xAxis[1], model.yAxis[1], 0, model.center[1],
      0, 0, 1, base_m,
      0, 0, 0, 1,
    ));
    batches.set(key, batch);
  }
  const fitted = new Map<string, FittedPart[]>();
  for (const [key, { model, matrices }] of batches) {
    const source = modelSource(model.name);
    if (!source) continue;
    const parts = stage.fitted.get(key) ?? fitModel(source, model.size_m);
    fitted.set(key, parts);
    for (const part of parts) {
      if (part.material instanceof MeshStandardMaterial) {
        part.material.envMap = stage.environment;
        part.material.envMapIntensity = ENVIRONMENT_INTENSITY;
      }
      const mesh = new InstancedMesh(part.geometry, part.material, matrices.length);
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      stage.models.add(mesh);
    }
  }
  for (const [key, parts] of stage.fitted) {
    if (!fitted.has(key)) parts.forEach((part) => part.geometry.dispose());
  }
  stage.fitted = fitted;
}

/** Replaces the zone names. A texture is the sprite's own: it goes with the sprite. */
function placeLabels(group: Group, labels: SceneLabel[]): void {
  for (const child of [...group.children]) {
    if (child instanceof Sprite) {
      child.material.map?.dispose();
      child.material.dispose();
    }
    group.remove(child);
  }
  for (const label of labels) {
    const sprite = labelSprite(label);
    if (sprite !== null) group.add(sprite);
  }
}

/** Lines that fit `maxWidth`; one word longer than that stays on its own line. */
function wrapLine(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    const next = line === '' ? word : `${line} ${word}`;
    if (line !== '' && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  return line === '' ? lines : [...lines, line];
}

/**
 * The name (and the heat reading under it) drawn to a canvas, uppercase as on the
 * 2D plan, with a white halo so it reads on any floor colour. A name wider than
 * its zone shrinks to fit rather than run over the neighbours.
 */
function labelSprite(label: SceneLabel): Sprite | null {
  const canvas = window.document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const font = `600 ${LABEL_FONT_PX}px system-ui, sans-serif`;
  const maxWidth = label.width_m * LABEL_PX_PER_M;
  context.font = font;
  const lines = wrapLine(context, label.text.toLocaleUpperCase('ru'), maxWidth);
  if (label.value !== undefined) lines.push(label.value);
  const lineHeight = LABEL_FONT_PX * 1.2;
  const widest = Math.max(...lines.map((line) => context.measureText(line).width));
  canvas.width = Math.ceil(widest + LABEL_PAD_PX * 2);
  canvas.height = Math.ceil(lines.length * lineHeight + LABEL_PAD_PX * 2);
  // A resized canvas forgets its state.
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = 6;
  context.strokeStyle = '#FFFFFF';
  context.fillStyle = LABEL_COLOR;
  lines.forEach((line, index) => {
    const y = LABEL_PAD_PX + lineHeight * (index + 0.5);
    context.strokeText(line, canvas.width / 2, y);
    context.fillText(line, canvas.width / 2, y);
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, toneMapped: false }));
  const fit = Math.min(1, maxWidth / widest);
  sprite.scale.set((canvas.width / LABEL_PX_PER_M) * fit, (canvas.height / LABEL_PX_PER_M) * fit, 1);
  sprite.position.set(label.center[0], label.center[1], label.z_m);
  sprite.renderOrder = LABEL_ORDER;
  sprite.name = `label:${label.ref.id}`;
  return sprite;
}

/**
 * A prism as meshes. `proxy`: a model stands in its place, so the prism is
 * invisible and only catches the click; a selected one still shows its edges.
 */
function prismMeshes(prism: ScenePrism, selected: boolean, proxy = false): (Mesh | LineSegments)[] {
  if (prism.polygon.length < 3) return [];
  const shape = new Shape(prism.polygon.map(([x, y]) => new Vector2(x, y)));
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(prism.height_m, 0.001),
    bevelEnabled: false,
  });
  const surface = SURFACE[prism.kind];
  const material = new MeshStandardMaterial({
    color: selected ? SELECTED_COLOR : prism.color,
    roughness: surface.roughness,
    metalness: surface.metalness,
    transparent: prism.opacity < 1,
    opacity: prism.opacity,
    visible: !proxy,
  });
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = surface.cast && !proxy;
  mesh.receiveShadow = surface.receive;
  mesh.position.z = prism.base_m;
  mesh.name = `${prism.ref.kind}:${prism.ref.id}`;
  // Raycasting gets the concrete mesh, while selection lives in the document.
  // Keep their link on the mesh itself; outlines deliberately stay decorative
  // and never catch a pick.
  mesh.userData['ref'] = prism.ref;
  if (prism.kind === 'wall') mesh.userData['wallLine'] = wallLine(prism.polygon);
  if ((proxy || !OUTLINED.has(prism.kind)) && !selected) return [mesh];

  // Only real corners: a round object's 24 facets would draw 24 vertical stripes.
  const outline = new EdgesGeometry(geometry, EDGE_ANGLE_DEG);
  if (prism.kind === 'object' && prism.base_m < OUTLINE_LIFT_M) {
    // The bottom ring of a floor object would hide under the zone slabs: lift
    // that ring only, the top stays on the object.
    const position = outline.getAttribute('position');
    const lift = Math.min(OUTLINE_LIFT_M - prism.base_m, prism.height_m / 2);
    for (let index = 0; index < position.count; index += 1) {
      if (position.getZ(index) < TOLERANCE.coordinate_m) position.setZ(index, lift);
    }
  }
  const edges = new LineSegments(outline, new LineBasicMaterial({ color: selected ? '#E67700' : EDGE_COLOR }));
  edges.position.z = prism.base_m;
  // A selected wall keeps its outline even when it turns to glass.
  if (prism.kind === 'wall' && !selected) edges.userData['wallLine'] = mesh.userData['wallLine'];
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
