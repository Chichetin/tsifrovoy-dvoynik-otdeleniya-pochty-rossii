"""
#59: builds the 3D models of the object catalog into public/models/<name>.glb.

    ~/.local/opt/blender-5.2.2-linux-x64/blender -b -P scripts/models/build.py -- [name ...] [--preview DIR]

Every model is built at its type's default size from data/catalog/object-types.json:
footprint centre at the origin, base at z = 0, the front (where the user stands
or looks from) towards +Y — at 0° an object looks along local +Y (D-010).

How the 3D view fits a model to another size lives in the model itself, as glTF
extras (read by src/features/view3d/model-fit.ts):

- root node `size`: [x, y, z] the model was built at, metres.
- root node `fit`: "slice" — margins keep their size and the middle stretches
  (`margins` = [x0, x1, y0, y1, z0, z1] in metres); "contain" — uniform scale
  that fits the box, for small devices that must keep their proportions.
- mesh node `repeat`: {axis: [gap0, gap1, pitch]} — the node is one copy of a
  row (shelf, seat, parcels); the view repeats it along a track from gap0 to
  size - gap1 at about `pitch`. `skipTop` leaves the top point of the z track
  empty: nothing stands on the top shelf.

Poly Haven models (CC0, polyhaven.com) are downloaded into a temp cache.
"""

import bpy
import bmesh
import json
import math
import os
import sys
import tempfile
import urllib.request
from contextlib import contextmanager
from mathutils import Euler, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CATALOG = os.path.join(ROOT, "data", "catalog", "object-types.json")
OUT = os.path.join(ROOT, "public", "models")
CACHE = os.path.join(tempfile.gettempdir(), "pochta-polyhaven")
FONT = os.path.join(bpy.utils.system_resource("DATAFILES", path="fonts"), "Inter.woff2")

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = ARGS[ARGS.index("--preview") + 1] if "--preview" in ARGS else None
ONLY = [a for a in ARGS if not a.startswith("--") and a != PREVIEW]


# --- materials ---------------------------------------------------------------

def linear(hex_color):
    def channel(c):
        c = int(c, 16) / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    h = hex_color.lstrip("#")
    return (channel(h[0:2]), channel(h[2:4]), channel(h[4:6]), 1.0)


def mat(name, color, rough=0.5, metal=0.0, emit=None, strength=1.0, alpha=1.0):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = linear(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = linear(emit)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    return m


WHITE = lambda: mat("white", "#ECEEF1", 0.35)
LIGHT = lambda: mat("light_gray", "#D5D8DC", 0.45)
GRAPHITE = lambda: mat("graphite", "#2B2F36", 0.45)
BLACK = lambda: mat("black", "#141619", 0.5)
FABRIC = lambda: mat("fabric", "#30353D", 0.95)
STEEL = lambda: mat("steel", "#B8BCC2", 0.28, 1.0)
DARK_STEEL = lambda: mat("dark_steel", "#5A5F66", 0.38, 0.8)
POST_BLUE = lambda: mat("post_blue", "#0055A6", 0.4, 0.1)
OAK = lambda: mat("oak", "#C9A27E", 0.5)
RUBBER = lambda: mat("rubber", "#1E1F22", 0.9)
SCREEN = lambda: mat("screen_off", "#07090C", 0.12)
GLASS = lambda: mat("glass", "#BFD7E3", 0.05, alpha=0.3)
YELLOW = lambda: mat("yellow", "#F5C400", 0.5)
INK = lambda: mat("ink", "#1A2B45", 0.6)
LED_GREEN = lambda: mat("led_green", "#2EE65A", 0.3, emit="#2EE65A", strength=3)
LED_RED = lambda: mat("led_red", "#FF3030", 0.3, emit="#FF3030", strength=3)
LED_AMBER = lambda: mat("led_amber", "#FFB020", 0.3, emit="#FFB020", strength=3)
GLOW_WHITE = lambda: mat("glow_white", "#FFFFFF", 0.3, emit="#FFFFFF", strength=1.2)
GLOW_BLUE = lambda: mat("glow_blue", "#1C6FD1", 0.2, emit="#1C6FD1", strength=1.2)
GLOW_PALE = lambda: mat("glow_pale", "#E8F0FA", 0.2, emit="#E8F0FA", strength=0.9)


# --- parts -------------------------------------------------------------------

PARTS = {}
SPECS = {}
CURRENT = ["body"]


def put(o):
    PARTS.setdefault(CURRENT[0], []).append(o)
    return o


@contextmanager
def row(name, spec):
    """Parts made inside belong to one repeated row node."""
    SPECS[name] = spec
    CURRENT[0] = name
    try:
        yield
    finally:
        CURRENT[0] = "body"


def finish(o, material, bevel, rot, segments=3):
    o.rotation_euler = [math.radians(r) for r in rot]
    if bevel:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = segments
        m.limit_method = "ANGLE"
        o.modifiers.new("normals", "WEIGHTED_NORMAL").keep_sharp = True
    o.data.materials.append(material)
    return put(o)


def box(size, at, material, bevel=0.0, rot=(0, 0, 0), segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, material, bevel, rot, segments)


def cyl(radius, depth, at, material, bevel=0.0, rot=(0, 0, 0), vertices=32, scale=(1, 1)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=at)
    o = bpy.context.object
    o.scale = (scale[0], scale[1], 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    return finish(o, material, bevel, rot, 4)


def sphere(radius, at, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=radius, location=at)
    o = bpy.context.object
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    return finish(o, material, 0, (0, 0, 0))


def poly(points, y, thickness, material, z0=0.0):
    """Flat shape in the XZ plane facing +Y: a sign, an icon."""
    mesh = bpy.data.meshes.new("poly")
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, z0 + z)) for x, z in points]
    face = bm.faces.new(verts)
    bm.normal_update()
    if face.normal.y < 0:
        bmesh.ops.reverse_faces(bm, faces=[face])
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new("poly", mesh)
    bpy.context.scene.collection.objects.link(o)
    o.modifiers.new("solid", "SOLIDIFY").thickness = thickness
    o.data.materials.append(material)
    return put(o)


def wedge(x0, x1, y0, y1, z0, z_low, z_high, material):
    """Solid that rises along +Y from z_low to z_high: a ramp."""
    mesh = bpy.data.meshes.new("wedge")
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z_low), (x1, y0, z_low), (x1, y1, z_high), (x0, y1, z_high)]]
    for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new("wedge", mesh)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material)
    return put(o)


def text(body, size, at, material, rot=(90, 0, 180), align="CENTER", depth=0.0008):
    """Text facing +Y by default; converted to a mesh at bake time."""
    bpy.ops.object.text_add(location=at, rotation=[math.radians(r) for r in rot])
    t = bpy.context.object
    t.data.body = body
    t.data.font = bpy.data.fonts.load(FONT, check_existing=True)
    t.data.size = size
    t.data.align_x = align
    t.data.align_y = "CENTER"
    t.data.extrude = depth
    t.data.resolution_u = 3
    t.data.materials.append(material)
    return put(t)


def keys(cols, rows, key, gap, origin, material, plane="xy", rot=(0, 0, 0)):
    """A grid of small keys around `origin`: keypads and keyboards."""
    out = []
    w = cols * key[0] + (cols - 1) * gap
    h = rows * key[1] + (rows - 1) * gap
    for c in range(cols):
        for r in range(rows):
            u = -w / 2 + key[0] / 2 + c * (key[0] + gap)
            v = -h / 2 + key[1] / 2 + r * (key[1] + gap)
            if plane == "xy":
                at = (origin[0] + u, origin[1] + v, origin[2])
                size = (key[0], key[1], key[2])
            else:
                at = (origin[0] + u, origin[1], origin[2] + v)
                size = (key[0], key[2], key[1])
            out.append(box(size, at, material, bevel=min(key) * 0.15, rot=rot))
    return out


def tilt(objs, pivot, degrees):
    """Rotates parts about the X axis through `pivot`: screens leaning back."""
    rot = math.radians(degrees)
    for o in objs:
        local = o.location - Vector(pivot)
        local.rotate(Euler((rot, 0, 0)))
        o.location = Vector(pivot) + local
        o.rotation_euler[0] += rot


def since(count):
    """Parts made since the group had `count` parts."""
    return PARTS[CURRENT[0]][count:]


def mark():
    return len(PARTS.get(CURRENT[0], []))


# --- Poly Haven --------------------------------------------------------------

def ph_fetch(asset):
    """Downloads the 1k glTF of a Poly Haven model into the cache once."""
    folder = os.path.join(CACHE, asset)
    gltf = os.path.join(folder, asset + ".gltf")
    if os.path.exists(gltf):
        return gltf
    files = json.loads(download(f"https://api.polyhaven.com/files/{asset}"))["gltf"]["1k"]["gltf"]
    os.makedirs(os.path.join(folder, "textures"), exist_ok=True)
    for path, entry in list(files["include"].items()) + [(asset + ".gltf", files)]:
        with open(os.path.join(folder, path), "wb") as f:
            f.write(download(entry["url"]))
    return gltf


def download(url):
    # The API refuses Python's default User-Agent.
    request = urllib.request.Request(url, headers={"User-Agent": "pochta-models-build"})
    with urllib.request.urlopen(request) as response:
        return response.read()


def ph_import(asset, texture=512):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ph_fetch(asset))
    objs = [o for o in set(bpy.data.objects) - before if o.type == "MESH"]
    for image in bpy.data.images:
        if image.size[0] > texture:
            image.scale(texture, texture)
    select(objs)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    for p in [p for p in set(bpy.data.objects) - before if p.type != "MESH"]:
        bpy.data.objects.remove(p)
    return o


def bounds(o):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    return (Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))),
            Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs))))


def place(o, size, base=0.0):
    """Scales a mesh to exactly `size` and stands it centred on z = base."""
    lo, hi = bounds(o)
    for v in o.data.vertices:
        for a in range(3):
            t = (v.co[a] - lo[a]) / (hi[a] - lo[a])
            v.co[a] = (base + t * size[a]) if a == 2 else (t - 0.5) * size[a]
    o.data.update()
    return o


def stretch(o, axis, size, margins):
    """9-slice of one axis in Blender: the same rule the view applies."""
    lo, hi = bounds(o)
    L = hi[axis] - lo[axis]
    m0, m1 = margins
    k = (size - m0 - m1) / (L - m0 - m1)
    for v in o.data.vertices:
        t = v.co[axis] - lo[axis]
        n = t if t <= m0 else (t - L + size if t >= L - m1 else m0 + (t - m0) * k)
        v.co[axis] = (lo[axis] + n) if axis == 2 else (n - size / 2)
    o.data.update()


# --- scene helpers -----------------------------------------------------------

def select(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def bake(objs, name):
    select(objs)
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    o.data.name = name
    return o


def track(spec, size):
    """Positions of a row along one axis: the same rule the view applies."""
    gap0, gap1, pitch = spec
    span = size - gap0 - gap1
    count = 1 if span <= 0 else max(1, round(span / pitch) + 1)
    step = span / (count - 1) if count > 1 else 0
    return [i * step for i in range(count)]


# --- models ------------------------------------------------------------------

def workplace(W, D, H):
    top = 0.03
    box((W, D, top), (0, 0, H - top / 2), OAK(), 0.004)
    for y in (-(D / 2 - 0.05), D / 2 - 0.05):
        box((0.05, 0.05, H - top), (-W / 2 + 0.06, y, (H - top) / 2), STEEL(), 0.004)
    px = W / 2 - 0.25
    box((0.43, D - 0.06, H - top - 0.01), (px, 0, (H - top) / 2), WHITE(), 0.006)
    for i, z in enumerate((0.13, 0.36, 0.58)):
        box((0.4, 0.012, 0.2), (px, D / 2 - 0.025, z), LIGHT(), 0.003)
        box((0.14, 0.02, 0.014), (px, D / 2 - 0.012, z + 0.06), STEEL(), 0.003)
    box((W - 0.6, 0.015, 0.38), (-0.17, -D / 2 + 0.05, H - top - 0.2), LIGHT(), 0.003)
    return {"fit": "slice", "margins": [0.1, 0.48, 0.06, 0.06, 0.0, 0.035]}


def chair(W, D, H):
    for i in range(5):
        a = math.radians(90 + i * 72)
        d = Vector((math.cos(a), math.sin(a), 0))
        spoke = box((0.27, 0.045, 0.03), (d.x * 0.135, d.y * 0.135, 0.075), BLACK(), 0.008)
        spoke.rotation_euler[2] = a
        cyl(0.025, 0.03, (d.x * 0.26, d.y * 0.26, 0.028), RUBBER(), rot=(90, 0, math.degrees(a)))
    cyl(0.022, 0.32, (0, 0, 0.24), STEEL())
    cyl(0.035, 0.14, (0, 0, 0.16), BLACK())
    box((0.22, 0.24, 0.05), (0, 0, 0.42), BLACK(), 0.01)
    box((0.5, 0.48, 0.08), (0, 0.02, 0.49), FABRIC(), 0.03, segments=4)
    box((0.46, 0.06, 0.5), (0, -0.23, 0.83), FABRIC(), 0.03, segments=4)
    box((0.06, 0.03, 0.32), (0, -0.265, 0.55), BLACK(), 0.008)
    for x in (-0.26, 0.26):
        box((0.03, 0.04, 0.17), (x, 0.0, 0.58), BLACK(), 0.006)
        box((0.06, 0.24, 0.03), (x, 0.02, 0.67), RUBBER(), 0.012)
    return {"fit": "contain"}


def computer(W, D, H):
    sy = -0.1
    box((0.2, 0.16, 0.012), (0, sy + 0.02, 0.006), GRAPHITE(), 0.004)
    box((0.04, 0.025, 0.2), (0, sy - 0.03, 0.11), GRAPHITE(), 0.005)
    box((0.4, 0.03, 0.25), (0, sy, 0.31), BLACK(), 0.006)
    box((0.38, 0.003, 0.225), (0, sy + 0.0155, 0.315), GLOW_BLUE())
    box((0.22, 0.002, 0.13), (-0.04, sy + 0.0175, 0.32), GLOW_PALE())
    box((0.22, 0.002, 0.018), (-0.04, sy + 0.0178, 0.39), mat("glow_bar", "#0055A6", 0.3, emit="#0055A6", strength=1.0))
    box((0.3, 0.12, 0.016), (-0.04, 0.13, 0.008), GRAPHITE(), 0.004)
    keys(12, 4, (0.019, 0.019, 0.007), 0.004, (-0.04, 0.13, 0.019), BLACK())
    sphere(0.03, (0.16, 0.14, 0.012), BLACK(), scale=(1, 1.7, 0.55))
    return {"fit": "contain"}


def pos_terminal(W, D, H):
    cyl(0.07, 0.015, (0, -0.03, 0.0075), GRAPHITE())
    cyl(0.014, 0.07, (0, -0.03, 0.05), STEEL())
    n = mark()
    box((0.09, 0.18, 0.045), (0, 0, 0.12), GRAPHITE(), 0.012)
    box((0.07, 0.06, 0.003), (0, -0.045, 0.1435), mat("pos_screen", "#79B8FF", 0.2, emit="#79B8FF", strength=1.2))
    keys(3, 4, (0.016, 0.012, 0.004), 0.004, (0, 0.035, 0.144), LIGHT())
    box((0.07, 0.01, 0.006), (0, 0.091, 0.105), BLACK())
    tilt(since(n), (0, -0.03, 0.12), -32)
    return {"fit": "contain"}


def printer(W, D, H):
    body = mat("printer_body", "#DADDE1", 0.42)
    box((W, D, 0.22), (0, 0, 0.11), body, 0.01)
    box((W - 0.04, 0.006, 0.09), (0, D / 2 + 0.001, 0.075), LIGHT(), 0.003)
    box((0.12, 0.008, 0.016), (0, D / 2 + 0.004, 0.1), GRAPHITE(), 0.003)
    box((W - 0.06, D - 0.08, 0.05), (0, -0.02, 0.245), BLACK())
    box((0.3, 0.24, 0.004), (0, 0.0, 0.226), WHITE())
    box((W, D, 0.11), (0, 0, 0.325), body, 0.01)
    box((W - 0.01, D - 0.01, 0.02), (0, 0, 0.39), GRAPHITE(), 0.006)
    n = mark()
    box((0.2, 0.07, 0.02), (0.1, D / 2 - 0.03, 0.385), GRAPHITE(), 0.005)
    box((0.08, 0.045, 0.002), (0.07, D / 2 - 0.03, 0.396), mat("panel_screen", "#5BA8FF", 0.2, emit="#5BA8FF", strength=1.2))
    sphere(0.006, (0.165, D / 2 - 0.03, 0.396), LED_GREEN())
    tilt(since(n), (0.1, D / 2 - 0.03, 0.385), -20)
    return {"fit": "contain"}


def label_printer(W, D, H):
    box((0.23, 0.19, 0.1), (0, 0, 0.05), GRAPHITE(), 0.012)
    box((0.225, 0.185, 0.09), (0, -0.003, 0.145), mat("lid", "#3D434B", 0.35), 0.04, segments=6)
    box((0.12, 0.004, 0.01), (0, 0.096, 0.1), BLACK())
    n = mark()
    box((0.1, 0.05, 0.0015), (0, 0.12, 0.1), WHITE())
    tilt(since(n), (0, 0.096, 0.1), -25)
    sphere(0.006, (0.08, 0.096, 0.06), LED_GREEN())
    box((0.025, 0.006, 0.015), (0.05, 0.096, 0.06), LIGHT(), 0.002)
    return {"fit": "contain"}


def cashier_window(W, D, H, sign="КАССА"):
    front = -D / 2
    box((W, 0.04, H - 0.03), (0, front + 0.02, (H - 0.03) / 2), WHITE(), 0.006)
    box((W + 0.002, 0.042, 0.12), (0, front + 0.02, H - 0.25), POST_BLUE())
    box((W, 0.26, 0.03), (0, front + 0.13, H - 0.015), OAK(), 0.006)
    box((W, 0.6, 0.03), (0, D / 2 - 0.3, 0.735), OAK(), 0.006)
    for x in (-W / 2 + 0.015, W / 2 - 0.015):
        box((0.03, D - 0.04, 0.72), (x, 0.02, 0.36), LIGHT(), 0.004)
        box((0.03, 0.26, H - 0.75), (x, front + 0.13, 0.75 + (H - 0.75) / 2), LIGHT(), 0.004)
    box((0.5, 0.5, 0.7), (W / 2 - 0.29, D / 2 - 0.28, 0.35), LIGHT(), 0.006)
    for z in (0.2, 0.45):
        box((0.12, 0.015, 0.014), (W / 2 - 0.29, D / 2 - 0.025, z), STEEL(), 0.003)
    box((W - 0.2, 0.004, 0.02), (0, front - 0.001, 0.08), DARK_STEEL())
    text(sign, 0.09, (0, front - 0.002, 0.62), POST_BLUE(), rot=(90, 0, 0))
    return {"fit": "slice", "margins": [0.1, 0.56, 0.3, 0.5, 0.05, 0.05]}


def pvz_counter(W, D, H):
    fit = cashier_window(W, D, H, sign="ВЫДАЧА ЗАКАЗОВ")
    parcel = ph_import("cardboard_box_01")
    decimate(parcel, 0.06)
    place(parcel, (0.34, 0.28, 0.24), 0.75)
    parcel.location = (-W / 2 + 0.4, D / 2 - 0.25, 0)
    put(parcel)
    return fit


def atm(W, D, H):
    body = mat("atm_body", "#3A3F47", 0.4, 0.3)
    box((W, D, H - 0.2), (0, 0, (H - 0.2) / 2), body, 0.012)
    box((W, D - 0.05, 0.2), (0, -0.025, H - 0.1), body, 0.012)
    box((W - 0.04, 0.1, 0.03), (0, D / 2 - 0.02, H - 0.21), mat("atm_hood", "#22262B", 0.4), 0.006)
    box((W - 0.06, 0.006, 0.5), (0, D / 2 + 0.003, H - 0.48), mat("atm_face", "#C9CED4", 0.3, 0.8), 0.004)
    box((0.34, 0.004, 0.26), (0, D / 2 + 0.007, H - 0.42), GLOW_BLUE())
    text("Вставьте карту", 0.026, (0, D / 2 + 0.0095, H - 0.4), GLOW_WHITE())
    for side in (-1, 1):
        for k in range(4):
            box((0.03, 0.01, 0.02), (side * 0.22, D / 2 + 0.008, H - 0.33 - k * 0.05), STEEL(), 0.003)
    n = mark()
    box((W - 0.06, 0.16, 0.03), (0, D / 2 + 0.06, 0.98), mat("atm_face", "#C9CED4", 0.3, 0.8), 0.006)
    keys(3, 4, (0.03, 0.022, 0.008), 0.006, (-0.1, D / 2 + 0.06, 0.998), STEEL())
    box((0.1, 0.012, 0.012), (0.17, D / 2 + 0.06, 0.998), BLACK())
    sphere(0.005, (0.23, D / 2 + 0.06, 0.998), LED_GREEN())
    tilt(since(n), (0, D / 2, 0.98), -15)
    box((0.26, 0.012, 0.03), (0, D / 2 + 0.001, 0.78), BLACK(), 0.004)
    box((0.3, 0.01, 0.006), (0, D / 2 + 0.004, 0.81), LED_GREEN())
    box((W - 0.04, 0.004, 0.06), (0, D / 2 + 0.001, 0.12), POST_BLUE())
    return {"fit": "slice", "margins": [0.08, 0.08, 0.04, 0.12, 0.2, 0.75]}


def safe(W, D, H):
    steel = mat("safe_steel", "#4A4F57", 0.45, 0.7)
    box((W, D - 0.02, H), (0, -0.01, H / 2), steel, 0.015)
    box((W - 0.06, 0.03, H - 0.06), (0, D / 2 - 0.02, H / 2), steel, 0.01)
    y = D / 2 - 0.004
    cyl(0.06, 0.03, (0.12, y + 0.01, H * 0.6), DARK_STEEL(), 0.004, rot=(90, 0, 0), vertices=48)
    cyl(0.045, 0.012, (0.12, y + 0.03, H * 0.6), STEEL(), 0.002, rot=(90, 0, 0), vertices=48)
    for a in range(3):
        spoke = box((0.18, 0.012, 0.012), (-0.08, y + 0.025, H * 0.6), STEEL(), 0.004)
        spoke.rotation_euler[1] = math.radians(a * 60)
    cyl(0.025, 0.03, (-0.08, y + 0.02, H * 0.6), STEEL(), rot=(90, 0, 0))
    for z in (0.15, H - 0.15):
        cyl(0.015, 0.08, (-W / 2 + 0.035, y + 0.005, z), STEEL())
    return {"fit": "slice", "margins": [0.06, 0.06, 0.04, 0.06, 0.04, 0.04]}


def kiosk_screen(width, height, y, z, title, lines, accent):
    """Screen panel facing +Y: header, light buttons with text."""
    out = [box((width, 0.004, height), (0, y, z), GLOW_PALE())]
    out.append(box((width, 0.005, height * 0.2), (0, y + 0.0005, z + height * 0.4), accent))
    out.append(text(title, height * 0.075, (0, y + 0.004, z + height * 0.4), GLOW_WHITE()))
    step = height * 0.62 / max(1, len(lines))
    for i, line in enumerate(lines):
        zz = z + height * 0.18 - i * step
        out.append(box((width * 0.8, 0.005, step * 0.72), (0, y + 0.0007, zz), accent))
        out.append(text(line, height * 0.06, (0, y + 0.004, zz), GLOW_WHITE()))
    return out


def payment_terminal(W, D, H):
    box((0.5, 0.46, 0.06), (0, 0, 0.03), DARK_STEEL(), 0.01)
    box((0.44, 0.34, 0.98), (0, -0.02, 0.55), GRAPHITE(), 0.02)
    box((0.445, 0.345, 0.04), (0, -0.02, 0.93), POST_BLUE())
    n = mark()
    box((0.5, 0.2, 0.46), (0, -0.04, 1.26), GRAPHITE(), 0.02)
    kiosk_screen(0.42, 0.34, 0.0625, 1.27, "Оплата услуг",
                 ["Коммунальные платежи", "Связь и интернет", "Штрафы и налоги"], GLOW_BLUE())
    tilt(since(n), (0, -0.04, 1.04), 12)
    n = mark()
    box((0.3, 0.16, 0.03), (0, 0.19, 1.0), GRAPHITE(), 0.008)
    keys(3, 4, (0.026, 0.02, 0.006), 0.006, (-0.05, 0.19, 1.018), STEEL())
    box((0.08, 0.04, 0.008), (0.09, 0.19, 1.016), BLACK())
    tilt(since(n), (0, 0.15, 1.0), -18)
    box((0.12, 0.01, 0.012), (0, 0.155, 0.84), BLACK())
    text("ОПЛАТА", 0.05, (0, 0.152, 0.7), GLOW_WHITE())
    return {"fit": "slice", "margins": [0.06, 0.06, 0.06, 0.06, 0.08, 0.6]}


def queue_terminal(W, D, H):
    box((0.48, 0.42, 0.03), (0, 0, 0.015), STEEL(), 0.008)
    box((0.4, 0.3, 0.92), (0, -0.02, 0.49), WHITE(), 0.04, segments=5)
    box((0.402, 0.302, 0.05), (0, -0.02, 0.12), POST_BLUE())
    n = mark()
    box((0.46, 0.13, 0.42), (0, -0.04, 1.17), WHITE(), 0.03, segments=5)
    kiosk_screen(0.38, 0.32, 0.027, 1.18, "Электронная очередь",
                 ["Отправления", "Получение", "Платежи"], GLOW_BLUE())
    tilt(since(n), (0, -0.04, 0.96), 15)
    box((0.14, 0.02, 0.014), (0, 0.13, 0.82), STEEL(), 0.003)
    box((0.11, 0.022, 0.004), (0, 0.13, 0.82), BLACK())
    text("Возьмите талон", 0.026, (0, 0.131, 0.76), INK())
    return {"fit": "slice", "margins": [0.05, 0.05, 0.05, 0.05, 0.06, 0.55]}


def mailbox(W, D, H):
    box((0.25, 0.2, 0.015), (0, 0, 0.0075), DARK_STEEL(), 0.004)
    box((0.07, 0.07, 0.7), (0, -0.02, 0.36), DARK_STEEL(), 0.006)
    box((0.38, 0.28, 0.46), (0, 0, 0.94), POST_BLUE(), 0.03, segments=4)
    box((0.4, 0.3, 0.04), (0, 0, 1.18), POST_BLUE(), 0.015)
    box((0.25, 0.012, 0.045), (0, 0.142, 1.07), STEEL(), 0.004)
    box((0.21, 0.014, 0.012), (0, 0.143, 1.07), BLACK())
    box((0.27, 0.004, 0.11), (0, 0.141, 0.92), WHITE(), 0.002)
    text("ПОЧТА", 0.06, (0, 0.1435, 0.92), POST_BLUE())
    cyl(0.012, 0.01, (0.12, 0.143, 0.78), STEEL(), rot=(90, 0, 0))
    return {"fit": "slice", "margins": [0.05, 0.05, 0.04, 0.04, 0.0, 0.52]}


def info_display(W, D, H):
    box((W, D, H), (0, 0, H / 2), GRAPHITE(), 0.01)
    box((W - 0.06, 0.004, H - 0.06), (0, D / 2, H / 2), mat("led_panel", "#050607", 0.2))
    y = D / 2 + 0.0025
    # Seen from the front (+Y), the viewer's left is +X.
    text("ТАЛОН", 0.055, (W / 4, y, H - 0.1), LED_AMBER())
    text("ОКНО", 0.055, (-W / 4, y, H - 0.1), LED_AMBER())
    for i, (ticket, window) in enumerate((("А012", "1"), ("Б034", "2"), ("В101", "3"))):
        z = H - 0.22 - i * 0.14
        text(ticket, 0.08, (W / 4, y, z), LED_GREEN())
        text("→", 0.07, (0, y, z), LED_GREEN())
        text(window, 0.08, (-W / 4, y, z), LED_GREEN())
    return {"fit": "slice", "margins": [0.05, 0.05, 0.0, 0.0, 0.05, 0.05]}


def media_panel(W, D, H):
    box((W, 0.04, H), (0, -D / 2 + 0.03, H / 2), BLACK(), 0.006)
    box((0.3, 0.04, 0.2), (0, -D / 2 + 0.01, H / 2), DARK_STEEL())
    y = -D / 2 + 0.051
    box((W - 0.03, 0.003, H - 0.03), (0, y, H / 2), mat("promo", "#0E5BB8", 0.2, emit="#0E5BB8", strength=1.1))
    box((W * 0.36, 0.003, H * 0.6), (-W * 0.27, y + 0.0007, H * 0.46), GLOW_PALE())
    box((W - 0.03, 0.003, 0.05), (0, y + 0.0004, 0.06), mat("promo_bar", "#F5C400", 0.3, emit="#F5C400", strength=1.1))
    # Seen from the front (+Y), the viewer's left is +X.
    text("Отправьте посылку", 0.05, (W * 0.44, y + 0.0035, H * 0.68), GLOW_WHITE(), align="LEFT")
    text("за 5 минут", 0.05, (W * 0.44, y + 0.0035, H * 0.57), GLOW_WHITE(), align="LEFT")
    text("Посылки · Платежи · Подписка", 0.026, (W * 0.44, y + 0.0035, H * 0.36), GLOW_WHITE(), align="LEFT")
    for i in range(3):
        box((W * 0.28, 0.003, 0.02), (-W * 0.27, y + 0.0012, H * (0.62 - i * 0.12)), mat("promo_line", "#9DB4CF", 0.4))
    return {"fit": "slice", "margins": [0.04, 0.04, 0.0, 0.0, 0.04, 0.04]}


def bench(W, D, H):
    for x in (-W / 2 + 0.14, W / 2 - 0.14):
        box((0.05, 0.05, 0.3), (x, -0.02, 0.16), DARK_STEEL(), 0.006)
        box((0.07, 0.44, 0.02), (x, 0, 0.01), DARK_STEEL(), 0.006)
    box((W - 0.12, 0.06, 0.05), (0, -0.02, 0.32), DARK_STEEL(), 0.006)
    pitch = 0.53
    with row("seat", {"x": [W / 2 - pitch, W / 2 - pitch, pitch]}):
        x = -pitch
        box((0.06, 0.3, 0.05), (x, 0, 0.375), DARK_STEEL(), 0.005)
        box((0.5, 0.45, 0.035), (x, 0.0, 0.4325), mat("seat_steel", "#9EA4AB", 0.35, 0.9), 0.012)
        box((0.46, 0.4, 0.004), (x, 0.0, 0.4505), mat("seat_grip", "#7D838A", 0.6, 0.8))
    return {"fit": "slice", "margins": [0.22, 0.22, 0.03, 0.03, 0.0, 0.05]}


def camera(W, D, H):
    o = ph_import("security_camera_02")
    lo, hi = bounds(o)
    # Poly Haven's camera looks along -Y; the catalog's looks along +Y (D-010).
    o.rotation_euler[2] = math.pi
    select([o])
    bpy.ops.object.transform_apply(rotation=True)
    s = min(W / (hi.x - lo.x), D / (hi.y - lo.y), H / (hi.z - lo.z))
    place(o, ((hi.x - lo.x) * s, (hi.y - lo.y) * s, (hi.z - lo.z) * s))
    put(o)
    return {"fit": "contain"}


def alarm_panel(W, D, H):
    box((W, D, H), (0, 0, H / 2), mat("alarm_body", "#E3E5E8", 0.4), 0.01)
    y = D / 2
    box((0.18, 0.004, 0.06), (0, y, H - 0.1), mat("lcd", "#7CFF8A", 0.3, emit="#7CFF8A", strength=0.6))
    text("ОХРАНА  ВКЛ", 0.016, (0, y + 0.0025, H - 0.1), INK())
    keys(3, 4, (0.03, 0.022, 0.008), 0.008, (0, y + 0.002, 0.14), GRAPHITE(), plane="xz")
    sphere(0.006, (-0.09, y + 0.002, H - 0.035), LED_RED())
    sphere(0.006, (-0.065, y + 0.002, H - 0.035), LED_GREEN())
    cyl(0.009, 0.006, (0.11, y + 0.002, 0.04), STEEL(), rot=(90, 0, 0))
    return {"fit": "contain"}


def fire_sensor(W, D, H):
    cyl(0.06, 0.012, (0, 0, H - 0.006), WHITE(), 0.002, vertices=48)
    cyl(0.05, 0.032, (0, 0, H - 0.028), WHITE(), 0.006, vertices=48)
    cyl(0.052, 0.008, (0, 0, H - 0.022), LIGHT(), vertices=48)
    cyl(0.02, 0.004, (0, 0, 0.002), LIGHT(), vertices=32)
    sphere(0.004, (0.035, 0, 0.012), LED_RED())
    return {"fit": "contain"}


def socket(W, D, H):
    box((W, D * 0.5, H), (0, -D / 4, H / 2), WHITE(), 0.006)
    cyl(0.025, 0.006, (0, 0.001, H / 2), LIGHT(), rot=(90, 0, 0), vertices=48)
    for x in (-0.01, 0.01):
        cyl(0.0025, 0.004, (x, 0.0045, H / 2), BLACK(), rot=(90, 0, 0), vertices=12)
    for z in (-0.02, 0.02):
        box((0.008, 0.004, 0.004), (0, 0.004, H / 2 + z), STEEL())
    return {"fit": "contain"}


def rack_levels(o, W, D, H):
    """Splits a Poly Haven shelf unit into the frame and one shelf level."""
    select([o])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    thin, frame = [], []
    for p in list(bpy.context.selected_objects):
        lo, hi = bounds(p)
        (thin if hi.z - lo.z < 0.05 and lo.z > 0.08 else frame).append(((lo.z + hi.z) / 2, hi.z, p))
    levels, last = {}, None
    for z, top, p in sorted(thin, key=lambda item: item[0]):
        if last is None or z - last > 0.08:
            key = z
        levels.setdefault(key, []).append((top, p))
        last = z
    keys_ = sorted(levels)
    pitch = (keys_[-1] - keys_[0]) / (len(keys_) - 1)
    for k in keys_[1:]:
        for _, p in levels[k]:
            bpy.data.objects.remove(p)
    shelf = [p for _, p in levels[keys_[0]]]
    board_top = max(top for top, _ in levels[keys_[0]])
    spec = [keys_[0], H - keys_[-1], pitch]
    return [p for _, _, p in frame], shelf, spec, board_top


def parcel_rack(W, D, H):
    o = ph_import("steel_frame_shelves_01")
    place(o, (W, D, H))
    frame, shelf, z_spec, board_top = rack_levels(o, W, D, H)
    PARTS["body"] = frame
    PARTS["shelf"] = shelf
    SPECS["shelf"] = {"z": z_spec}
    big = ph_import("cardboard_box_01")
    decimate(big, 0.06)
    small = big.copy()
    small.data = big.data.copy()
    bpy.context.scene.collection.objects.link(small)
    cell = W / 2
    place(big, (0.32, 0.3, 0.26), board_top)
    big.location.x = -cell / 2 - 0.1
    place(small, (0.18, 0.22, 0.17), board_top)
    small.location.x = -cell / 2 + 0.17
    small.rotation_euler[2] = math.radians(12)
    PARTS["parcels"] = [big, small]
    SPECS["parcels"] = {"x": [cell / 2, cell / 2, cell], "z": z_spec, "skipTop": True}
    return {"fit": "slice", "margins": [0.06, 0.06, 0.04, 0.04, 0.12, 0.04]}


def decimate(o, ratio):
    m = o.modifiers.new("decimate", "DECIMATE")
    m.ratio = ratio
    select([o])
    bpy.ops.object.modifier_apply(modifier=m.name)


def goods_rack(W, D, H):
    shelf_z, pitch = 0.1, 0.4
    box((W, 0.02, H - 0.08), (0, -D / 2 + 0.01, H / 2 + 0.04), mat("pegboard", "#DADDE0", 0.6), 0.003)
    for x in (-W / 2 + 0.02, W / 2 - 0.02):
        box((0.04, D, H), (x, 0, H / 2), WHITE(), 0.006)
    box((W, D, 0.08), (0, 0, 0.04), WHITE(), 0.006)
    box((W, D, 0.03), (0, 0, H - 0.015), WHITE(), 0.006)
    box((W - 0.06, 0.004, 0.12), (0, D / 2 - 0.02, H - 0.1), POST_BLUE())
    text("ТОВАРЫ", 0.06, (0, D / 2 - 0.0175, H - 0.1), GLOW_WHITE())
    z_spec = [shelf_z, H - (shelf_z + 3 * pitch), pitch]
    with row("shelf", {"z": z_spec}):
        box((W - 0.08, D - 0.03, 0.02), (0, 0.01, shelf_z), WHITE(), 0.003)
        box((W - 0.08, 0.006, 0.035), (0, D / 2 - 0.003, shelf_z - 0.005), POST_BLUE())
    colors = ["#E03131", "#FAB005", "#1C7ED6", "#37B24D", "#F76707", "#7048E8"]
    cell = W / 3
    with row("goods", {"x": [cell / 2, cell / 2, cell], "z": z_spec}):
        x0 = -W / 2 + cell / 2
        base = shelf_z + 0.01
        for i, (dx, size) in enumerate(((-0.09, (0.08, 0.2, 0.16)), (0.0, (0.07, 0.18, 0.22)), (0.09, (0.09, 0.22, 0.12)))):
            c = colors[(i * 2) % len(colors)]
            box(size, (x0 + dx, 0.02, base + size[2] / 2), mat(f"goods_{c}", c, 0.45), 0.004)
    return {"fit": "slice", "margins": [0.05, 0.05, 0.03, 0.03, 0.08, 0.2]}


def scales(W, D, H):
    box((W - 0.02, D - 0.08, 0.05), (0, -0.03, 0.025), GRAPHITE(), 0.006)
    box((W - 0.04, D - 0.1, 0.012), (0, -0.03, 0.062), STEEL(), 0.004)
    n = mark()
    box((0.16, 0.05, 0.08), (0, D / 2 - 0.03, 0.06), GRAPHITE(), 0.008)
    box((0.12, 0.003, 0.03), (0, D / 2 - 0.004, 0.07), mat("lcd_dark", "#0A0F0A", 0.2))
    text("2,350 кг", 0.016, (0, D / 2 - 0.0015, 0.07), LED_RED())
    tilt(since(n), (0, D / 2 - 0.03, 0.02), 15)
    return {"fit": "contain"}


def info_stand(W, D, H):
    for x in (-W / 2 + 0.04, W / 2 - 0.04):
        box((0.06, D, 0.03), (x, 0, 0.015), DARK_STEEL(), 0.006)
        cyl(0.015, H - 0.03, (x, 0, H / 2), STEEL())
    box((W - 0.08, 0.03, 1.12), (0, 0, H - 0.6), POST_BLUE(), 0.006)
    y = 0.016
    box((W - 0.12, 0.004, 1.08), (0, y, H - 0.6), WHITE())
    box((W - 0.12, 0.006, 0.14), (0, y + 0.001, H - 0.13), POST_BLUE())
    text("ИНФОРМАЦИЯ", 0.07, (0, y + 0.0045, H - 0.13), GLOW_WHITE())
    for i, x in enumerate((-0.19, 0.19)):
        box((0.33, 0.003, 0.45), (x, y + 0.002, H - 0.5), LIGHT())
        box((0.29, 0.004, 0.05), (x, y + 0.003, H - 0.32), mat("poster_head", "#1C7ED6", 0.5))
        for k in range(5):
            box((0.27, 0.004, 0.012), (x, y + 0.003, H - 0.4 - k * 0.05), mat("poster_line", "#8A929C", 0.6))
    box((W - 0.16, 0.06, 0.16), (0, 0.045, H - 1.05), GLASS())
    for i, c in enumerate(("#1C7ED6", "#FAB005", "#37B24D", "#E03131")):
        box((0.12, 0.01, 0.15), (-0.27 + i * 0.18, 0.04, H - 1.04), mat(f"leaflet_{c}", c, 0.5))
    return {"fit": "slice", "margins": [0.07, 0.07, 0.0, 0.0, 0.0, 1.2]}


def ramp(W, D, H):
    wedge(-W / 2 + 0.04, W / 2 - 0.04, -D / 2, D / 2, 0, 0.005, H, mat("anti_slip", "#8A9096", 0.95))
    for x0, x1 in ((-W / 2, -W / 2 + 0.04), (W / 2 - 0.04, W / 2)):
        wedge(x0, x1, -D / 2, D / 2, 0, 0.03, H, DARK_STEEL())
    rise = H / D
    for y0 in (-D / 2, D / 2 - 0.1):
        z0 = 0.005 + (y0 + D / 2) * rise
        wedge(-W / 2 + 0.04, W / 2 - 0.04, y0, y0 + 0.1, z0 - 0.002, z0 + 0.0015, z0 + 0.1 * rise + 0.0015, YELLOW())
    return {"fit": "slice", "margins": [0.05, 0.05, 0.0, 0.0, 0.0, 0.0]}


def switchboard(W, D, H):
    body = mat("cabinet", "#C3C7CC", 0.42, 0.35)
    box((W, D - 0.012, H), (0, -0.006, H / 2), body, 0.008)
    box((W - 0.02, 0.012, H - 0.02), (0, D / 2 - 0.006, H / 2), body, 0.004)
    y = D / 2
    box((0.025, 0.03, 0.12), (W / 2 - 0.06, y + 0.012, H / 2), BLACK(), 0.006)
    for i in range(4):
        box((0.18, 0.004, 0.012), (0, y + 0.001, 0.06 + i * 0.025), DARK_STEEL())
    t = 0.14
    tri = [(-t / 2, 0), (t / 2, 0), (0, t * 0.87)]
    poly(tri, y + 0.002, 0.002, BLACK(), z0=H - 0.3)
    inner = [(-t / 2 + 0.014, 0.008), (t / 2 - 0.014, 0.008), (0, t * 0.87 - 0.02)]
    poly(inner, y + 0.004, 0.002, YELLOW(), z0=H - 0.3)
    bolt = [(0.008, 0.095), (-0.02, 0.05), (-0.002, 0.05), (-0.012, 0.018), (0.02, 0.062), (0.002, 0.062)]
    poly(bolt, y + 0.006, 0.002, BLACK(), z0=H - 0.3)
    box((0.14, 0.004, 0.05), (0, y + 0.002, H - 0.06), WHITE())
    text("ЩР-1", 0.03, (0, y + 0.0045, H - 0.06), INK())
    return {"fit": "slice", "margins": [0.05, 0.1, 0.0, 0.0, 0.05, 0.32]}


def hvac(W, D, H):
    galv = mat("galvanized", "#C9CDD1", 0.4, 0.9)
    box((W - 0.2, D, H), (0, 0, H / 2), galv, 0.006)
    for i in range(3):
        box((W - 0.2, D + 0.006, 0.012), (0, 0, 0.08 + i * 0.12), galv, 0.002)
    for side in (-1, 1):
        x = side * (W / 2 - 0.05)
        cyl(0.13, 0.1, (x, 0, H / 2), galv, rot=(0, 90, 0), vertices=40)
        cyl(0.145, 0.015, (side * (W / 2 - 0.1), 0, H / 2), galv, rot=(0, 90, 0), vertices=40)
    box((0.3, 0.006, 0.24), (0, D / 2 + 0.002, H / 2), mat("access", "#B4B9BE", 0.45, 0.8), 0.003)
    for dx in (-0.13, 0.13):
        for dz in (-0.1, 0.1):
            cyl(0.006, 0.004, (dx, D / 2 + 0.006, H / 2 + dz), STEEL(), rot=(90, 0, 0), vertices=12)
    box((0.1, 0.002, 0.05), (0.25, D / 2 + 0.002, H - 0.08), WHITE())
    return {"fit": "slice", "margins": [0.16, 0.16, 0.04, 0.04, 0.04, 0.04]}


def water_heater(W, D, H):
    r = min(W, D) / 2 - 0.01
    cyl(r, H - 0.08, (0, 0, H / 2 + 0.03), WHITE(), 0.06, vertices=64)
    cyl(r + 0.002, 0.03, (0, 0, 0.2), LIGHT(), vertices=64)
    cyl(0.05, 0.012, (0, r - 0.004, 0.32), GRAPHITE(), 0.003, rot=(90, 0, 0), vertices=40)
    cyl(0.03, 0.004, (0, r + 0.004, 0.32), mat("thermo", "#3D9BFF", 0.3, emit="#3D9BFF", strength=1.5), rot=(90, 0, 0), vertices=32)
    for x, c in ((-0.07, "#1C7ED6"), (0.07, "#E03131")):
        cyl(0.012, 0.07, (x, 0, 0.035), STEEL(), vertices=16)
        cyl(0.016, 0.015, (x, 0, 0.05), mat(f"pipe_{c}", c, 0.5), vertices=16)
    box((0.3, 0.03, 0.06), (0, -r + 0.01, H * 0.75), DARK_STEEL(), 0.004)
    return {"fit": "contain"}


MODELS = {
    "ot_workplace": ("workplace", workplace),
    "ot_chair": ("chair", chair),
    "ot_computer": ("computer", computer),
    "ot_pos_terminal": ("pos-terminal", pos_terminal),
    "ot_printer": ("printer", printer),
    "ot_label_printer": ("label-printer", label_printer),
    "ot_cashier_window": ("cashier-window", cashier_window),
    "ot_payment_terminal": ("payment-terminal", payment_terminal),
    "ot_queue_terminal": ("queue-terminal", queue_terminal),
    "ot_mailbox": ("mailbox", mailbox),
    "ot_info_display": ("info-display", info_display),
    "ot_media_panel": ("media-panel", media_panel),
    "ot_bench": ("bench", bench),
    "ot_camera": ("camera", camera),
    "ot_alarm_panel": ("alarm-panel", alarm_panel),
    "ot_fire_sensor": ("fire-sensor", fire_sensor),
    "ot_socket": ("socket", socket),
    "ot_parcel_rack": ("parcel-rack", parcel_rack),
    "ot_goods_rack": ("goods-rack", goods_rack),
    "ot_scales": ("scales", scales),
    "ot_info_stand": ("info-stand", info_stand),
    "ot_ramp": ("ramp", ramp),
    "ot_switchboard": ("switchboard", switchboard),
    "ot_hvac": ("hvac", hvac),
    "ot_water_heater": ("water-heater", water_heater),
}

# Types of the organizers' example that our catalog does not have; sizes are
# the ones src/persistence/organizer-import.ts gives them.
EXAMPLE_TYPES = {
    "pvz-counter": (pvz_counter, (2.0, 0.8, 1.1)),
    "atm": (atm, (0.7, 0.5, 1.6)),
    "safe": (safe, (0.6, 0.6, 0.8)),
}


# --- build -------------------------------------------------------------------

def build(name, make, W, D, H):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    PARTS.clear()
    SPECS.clear()
    CURRENT[0] = "body"
    fit = make(W, D, H)
    root = bpy.data.objects.new("model", None)
    bpy.context.scene.collection.objects.link(root)
    root["size"] = [W, D, H]
    root["fit"] = fit["fit"]
    if "margins" in fit:
        root["margins"] = fit["margins"]
    nodes = []
    for group, objs in PARTS.items():
        objs = [o for o in objs if o is not None and o.name in bpy.data.objects]
        if not objs:
            continue
        o = bake(objs, group)
        if group in SPECS:
            o["repeat"] = SPECS[group]
        o.parent = root
        nodes.append(o)
    if PREVIEW:
        render_preview(name, nodes, W, D, H)
    select([root] + nodes)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_extras=True,
        export_apply=True, export_yup=True, export_image_format="JPEG", export_jpeg_quality=80,
    )
    tris = sum(sum(len(p.vertices) - 2 for p in n.data.polygons) for n in nodes)
    print(f"MODEL {name}: {os.path.getsize(path) / 1024:.0f} KB, {tris} tris, fit={fit['fit']}")


def render_preview(name, nodes, W, D, H):
    """Thumbnail with every row copy in place: a check by eye, not shipped."""
    copies = []
    for n in nodes:
        spec = n.get("repeat")
        if not spec:
            continue
        spec = spec.to_dict()
        xs = track(spec["x"], W) if "x" in spec else [0]
        zs = track(spec["z"], H) if "z" in spec else [0]
        if spec.get("skipTop") and "z" in spec:
            zs = zs[:-1]
        for dx in xs:
            for dz in zs:
                if dx == 0 and dz == 0:
                    continue
                c = n.copy()
                bpy.context.scene.collection.objects.link(c)
                c.location = (dx, 0, dz)
                copies.append(c)
    scene = bpy.context.scene
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.9, 0.92, 0.95, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(45), math.radians(10), math.radians(140)))
    bpy.context.object.data.energy = 3
    bpy.context.object.data.angle = math.radians(10)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    bpy.context.object.data.materials.append(mat("preview_floor", "#E6E8EB", 0.8))
    size = max(W, D, H)
    target = Vector((0, 0, H / 2))
    eye = target + Vector((0.9, 1.6, 0.9)).normalized() * size * 2.3
    bpy.ops.object.camera_add(location=eye)
    cam = bpy.context.object
    cam.rotation_euler = (target - eye).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 50
    scene.camera = cam
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    scene.render.resolution_x = 360
    scene.render.resolution_y = 360
    scene.render.filepath = os.path.join(PREVIEW, name + ".png")
    bpy.ops.render.render(write_still=True)
    for c in copies:
        bpy.data.objects.remove(c)


def main():
    catalog = {t["id"]: t for t in json.load(open(CATALOG, encoding="utf-8"))}
    for type_id, (name, make) in MODELS.items():
        if ONLY and name not in ONLY:
            continue
        t = catalog[type_id]
        W, D = t["defaultSize_m"]
        build(name, make, W, D, t["defaultHeight_m"])
    for name, (make, (W, D, H)) in EXAMPLE_TYPES.items():
        if ONLY and name not in ONLY:
            continue
        build(name, make, W, D, H)


main()
