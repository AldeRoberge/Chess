"""Render labeled training frames from the CC-BY glTF chess packs with Blender.
Run using ml/.venv-render/Scripts/python.exe (bpy + python-chess required).
"""
import argparse
import json
import math
import random
from pathlib import Path

import bpy
import chess
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector, Matrix
from PIL import Image

SQUARE = 0.0575
TYPES = {'pawn':'p', 'knight':'n', 'bishop':'b', 'rook':'r', 'queen':'q', 'king':'k'}
LIGHTING = ('daylight', 'dim', 'bright', 'warm', 'cool', 'side-lit', 'hard-shadow', 'uneven')

def vary_lighting(scene, rand, index):
    """Vary actual illumination and shadow geometry, not just final pixel gain."""
    name = LIGHTING[index % len(LIGHTING)]
    ambient = {'dim':0.025, 'bright':0.55, 'hard-shadow':0.035, 'uneven':0.045}.get(name, 0.16)
    tint = (1.0,0.53,0.22) if name == 'warm' else (0.45,0.68,1.0) if name == 'cool' else (0.85,0.9,1.0)
    background = scene.world.node_tree.nodes['Background']
    background.inputs[0].default_value = (*tint,1)
    background.inputs[1].default_value = ambient * rand.uniform(0.8,1.2)
    lights = [o for o in scene.objects if o.type == 'LIGHT']
    angle = rand.uniform(-math.pi,math.pi)
    for i,obj in enumerate(lights):
        a = angle + i*2.5
        low = name in ('side-lit','hard-shadow','uneven')
        obj.location = (math.sin(a)*0.6,math.cos(a)*0.6,rand.uniform(0.22,0.38) if low else rand.uniform(0.6,1.1))
        obj.rotation_euler = (Vector((rand.uniform(-0.1,0.1),rand.uniform(-0.1,0.1),0))-obj.location).to_track_quat('-Z','Y').to_euler()
        power = 5 if name == 'dim' else 45 if name == 'bright' else 24
        obj.data.energy = power*rand.uniform(0.7,1.3)*(0.05 if i and low else 1)
        obj.data.size = rand.uniform(0.02,0.08) if name == 'hard-shadow' else rand.uniform(0.15,0.35) if low else rand.uniform(0.4,0.9)
        obj.data.color = tint
    scene.view_settings.exposure = rand.uniform(-0.4,0.3)
    return {'profile':name,'ambient':float(background.inputs[1].default_value),'exposure':scene.view_settings.exposure,
            'lights':[{'position':list(o.location),'watts':o.data.energy,'size':o.data.size,'color':list(o.data.color)} for o in lights]}

def bounds(obj):
    points = [obj.matrix_world @ p.co for p in obj.data.vertices]
    return Vector([min(p[i] for p in points) for i in range(3)]), Vector([max(p[i] for p in points) for i in range(3)])

def material(name, color, roughness=0.55):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

def cube(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    return obj

def load_templates(path):
    bpy.ops.import_scene.gltf(filepath=str(path.resolve()))
    bpy.context.view_layer.update()
    # Some packs batch every pawn/rook of a side into one mesh. Split those
    # before selecting a template, otherwise one labeled pawn renders eight.
    if path.parent.name in ('chess_kit', 'chess_set'):
        for obj in list(bpy.context.scene.objects):
            if obj.type != 'MESH' or 'Board' in obj.name:
                continue
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True); bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.remove_doubles(threshold=0.0001)
            bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
        bpy.context.view_layer.update()
    if path.parent.name == 'chess_kit':
        # This kit is a six-piece lineup along Y. Disconnected caps and bases
        # belong to the same piece; group by lineup location, not connectivity.
        groups = [[] for _ in range(6)]
        centers = [-9.73, -4.88, 0.02, 4.33, 8.80, 12.76]
        for obj in list(bpy.context.scene.objects):
            if obj.type == 'MESH':
                lo, hi = bounds(obj)
                groups[min(range(6), key=lambda i: abs((lo.y+hi.y)/2-centers[i]))].append(obj)
        for kind, objects in zip('kqbnrp', groups):
            if not objects: raise ValueError(f'Chess Kit missing {kind}')
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects: obj.select_set(True)
            bpy.context.view_layer.objects.active = objects[0]
            bpy.ops.object.join()
            obj = bpy.context.object
            obj.name = next(name for name, letter in TYPES.items() if letter == kind) + '_1_'
            obj.data.materials.clear()
            obj.data.materials.append(material('Kit ivory', (0.75,0.68,0.52)))
            for face in obj.data.polygons: face.material_index = 0
            black = obj.copy(); black.data = obj.data.copy()
            bpy.context.collection.objects.link(black)
            black.name = obj.name.replace('_1_', '_2_')
            black.data.materials.clear()
            black.data.materials.append(material('Kit dark wood', (0.065,0.032,0.015)))
        bpy.context.view_layer.update()
    templates = {}
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        names = obj.name.lower() + ' ' + (obj.parent.name.lower() if obj.parent else '')
        kind = next((v for k,v in TYPES.items() if k in names), None)
        if not kind:
            continue
        color = 'b' if 'black' in names or '_2_' in names else 'w'
        key = color + kind
        if key in templates:
            continue
        # Bake glTF hierarchy transforms, preserving UVs, normals and all material slots.
        mesh = obj.data.copy()
        mesh.transform(obj.matrix_world)
        copy = bpy.data.objects.new('template_' + key, mesh)
        bpy.context.collection.objects.link(copy)
        templates[key] = copy
    missing = set(c+t for c in 'wb' for t in 'pnbrqk') - templates.keys()
    if missing:
        raise ValueError(f'{path.parent.name}: missing named pieces {sorted(missing)}')
    king_lo, king_hi = bounds(templates['wk'])
    factor = 0.09 / (king_hi.z - king_lo.z)
    for obj in templates.values():
        lo, hi = bounds(obj)
        center = Vector(((lo.x+hi.x)/2, (lo.y+hi.y)/2, lo.z))
        obj.data.transform(Matrix.Scale(factor, 4) @ Matrix.Translation(-center))
        obj.hide_render = True
    keep = set(templates.values())
    for obj in list(bpy.context.scene.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    return templates

def random_position(rand):
    board = chess.Board()
    for _ in range(rand.randrange(0, 110)):
        if board.is_game_over():
            break
        board.push(rand.choice(list(board.legal_moves)))
    return board

def setup_scene(rand, width, height, samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.use_persistent_data = True
    # Prefer CUDA when available; CPU is a supported fallback.
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'CUDA'; prefs.get_devices()
        gpu = [d for d in prefs.devices if d.type == 'CUDA']
        for device in prefs.devices: device.use = device.type == 'CUDA'
        if gpu: scene.cycles.device = 'GPU'
    except (KeyError, TypeError, RuntimeError):
        pass
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('Room ambient')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.65, 0.7, 0.8, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.2
    scene.world = world
    light = material('Light wood squares', (0.63,0.48,0.30))
    dark = material('Dark wood squares', (0.12,0.065,0.032))
    table = material('Table', (0.24,0.20,0.17))
    cube('Table', (0,0,-0.025), (1.4,1.4,0.04), table)
    for row in range(8):
        for col in range(8):
            cube(f'Square_{row}_{col}', ((col-3.5)*SQUARE,(row-3.5)*SQUARE,-0.002), (SQUARE,SQUARE,0.004), light if (row+col)%2==0 else dark)
    for i, pos in enumerate([(-0.4,-0.3,0.8),(0.5,0.4,0.65)]):
        data = bpy.data.lights.new(f'Softbox{i}', 'AREA')
        data.energy = 20 if i==0 else 10
        data.shape = 'DISK'; data.size = 0.6
        obj = bpy.data.objects.new(data.name,data); scene.collection.objects.link(obj)
        obj.location = pos; obj.rotation_euler = (-obj.location).to_track_quat('-Z','Y').to_euler()
    camera = bpy.data.objects.new('Training camera', bpy.data.cameras.new('Training camera'))
    scene.collection.objects.link(camera); scene.camera = camera
    camera.data.lens = 45
    camera.data.clip_start = 0.01
    return scene, camera, light, dark

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--assets',type=Path,default=Path(__file__).parent/'assets')
    p.add_argument('--out',type=Path,default=Path(__file__).parent/'renders'/'train')
    p.add_argument('--sets',nargs='+',default=['chess_kit','chess_set','wooden_chess_set'])
    p.add_argument('--count',type=int,default=12,help='Total frames, cycling across sets')
    p.add_argument('--seed',type=int,default=1)
    p.add_argument('--samples',type=int,default=32)
    p.add_argument('--width',type=int,default=960)
    p.add_argument('--height',type=int,default=720)
    p.add_argument('--exclude',type=Path,help='Folder whose labeled positions must not appear in this run')
    p.add_argument('--resume',action='store_true',help='Skip complete existing frames')
    args = p.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    excluded = {json.loads(f.read_text())['fen'].split()[0] for f in args.exclude.glob('*.json')} if args.exclude else set()
    rand = random.Random(args.seed)
    for si, pack in enumerate(args.sets):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        templates = load_templates(args.assets/pack/'scene.gltf')
        scene,camera,light,dark = setup_scene(rand,args.width,args.height,args.samples)
        pieces = []
        for i in range(si,args.count,len(args.sets)):
            stem = args.out/f'{args.seed:04d}-{i:06d}-{pack}'
            if args.resume and all(stem.with_suffix(ext).exists() for ext in ('.png','.gray','.json')): continue
            rand = random.Random(args.seed*100000+i)
            for obj in pieces: bpy.data.objects.remove(obj,do_unlink=True)
            pieces = []
            board = random_position(rand)
            while board.board_fen() in excluded:
                board = random_position(rand)
            for square,piece in board.piece_map().items():
                key = ('w' if piece.color else 'b') + piece.symbol().lower()
                obj = templates[key].copy(); obj.data = templates[key].data
                bpy.context.collection.objects.link(obj); obj.hide_render = False
                obj.location = ((chess.square_file(square)-3.5)*SQUARE,(3.5-chess.square_rank(square))*SQUARE,0)
                obj.rotation_euler.z = (math.pi if piece.color else 0) + rand.uniform(-0.1,0.1)
                pieces.append(obj)
            angle = rand.uniform(-math.pi,math.pi)
            radius = rand.uniform(0.25,0.5)
            camera.location = (math.sin(angle)*radius,math.cos(angle)*radius,rand.uniform(0.65,0.85))
            camera.rotation_euler = (Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
            lighting = vary_lighting(scene,rand,i//len(args.sets))
            for mat, palettes in [(light, [(0.63,0.48,0.30),(0.72,0.70,0.64),(0.45,0.53,0.42)]), (dark, [(0.12,0.065,0.032),(0.05,0.065,0.075),(0.08,0.15,0.10)])]:
                mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rand.choice(palettes), 1)
            scene.cycles.seed = args.seed*10000+i
            bpy.context.view_layer.update()
            # Fit all four board corners with margin instead of silently clipping labels.
            for attempt in range(12):
                projected = [world_to_camera_view(scene,camera,Vector((x*SQUARE,y*SQUARE,0))) for x,y in [(-4,-4),(4,-4),(4,4),(-4,4)]]
                if all(0.08 <= v.x <= 0.92 and 0.08 <= v.y <= 0.92 and v.z > 0 for v in projected): break
                camera.location *= 1.08
                bpy.context.view_layer.update()
            corners = []
            for x,y in [(-4,-4),(4,-4),(4,4),(-4,4)]:
                v = world_to_camera_view(scene,camera,Vector((x*SQUARE,y*SQUARE,0)))
                if not (0 <= v.x <= 1 and 0 <= v.y <= 1 and v.z>0):
                    raise ValueError('Board outside camera frame')
                corners.append({'x':v.x*args.width,'y':(1-v.y)*args.height})
            scene.render.filepath = str(stem.with_suffix('.png').resolve())
            bpy.ops.render.render(write_still=True)
            image = Image.open(stem.with_suffix('.png')).convert('L')
            stem.with_suffix('.gray').write_bytes(image.tobytes())
            stem.with_suffix('.json').write_text(json.dumps({'fen':board.fen(),'corners':corners,'width':args.width,'height':args.height,'set':pack,'seed':args.seed,'renderer':'Blender Cycles','samples':args.samples,'lighting':lighting}))
            print(f'SAVED {stem}',flush=True)
    print(f'Done: {args.count} labeled textured renders in {args.out}',flush=True)

if __name__ == '__main__':
    main()
