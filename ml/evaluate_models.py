"""Evaluate exported browser model weights directly with PyTorch, without retraining."""
import argparse
import base64
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F


def floats(value):
    return torch.from_numpy(np.frombuffer(base64.b64decode(value), dtype='<f4').copy())


def evaluate(model_path, prefix, metadata=None):
    model = json.loads(Path(model_path).read_text())
    board = 'side' in model
    side = model.get('side',model.get('crop'))
    classes = model.get('classes',13) if board else 3
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    layers=[]
    for layer in model['layers']:
        conv = board or layer['type']=='conv'
        k = layer.get('k',3)
        shape = (layer['out'],layer['in'],k,k) if conv else (layer['out'],layer['in'])
        layers.append((layer,floats(layer['w']).reshape(shape).to(device),floats(layer['b']).to(device),conv))
    x = np.fromfile(str(prefix)+'.x',dtype=np.uint8).reshape(-1,1,side,side)
    y = np.fromfile(str(prefix)+'.y',dtype=np.uint8).reshape(-1,64) if board else np.fromfile(str(prefix)+'.y',dtype=np.uint8)
    predictions=[]; colours=[]
    with torch.no_grad():
        for at in range(0,len(x),128 if board else 2048):
            v=torch.from_numpy(x[at:at+(128 if board else 2048)].astype(np.float32)/127.5).to(device)
            for layer,w,b,conv in layers:
                if conv: v=F.conv2d(v,w,b,stride=layer.get('stride',1),padding=layer.get('k',3)//2)
                else: v=F.linear(v.flatten(1),w,b)
                if layer.get('relu',not layer.get('last',False)): v=F.relu(v)
            if board:
                v=v[:,:,1:9,1:9]
                prob=v.softmax(1)
                colour_prob=torch.stack([prob[:,0],prob[:,1:7].sum(1),prob[:,7:13].sum(1)],dim=1)
                colours.append(colour_prob.argmax(1).flatten(1).cpu().numpy())
                predictions.append(v.argmax(1).flatten(1).cpu().numpy())
            else:
                predictions.append(v.argmax(1).cpu().numpy())
    pred=np.concatenate(predictions)
    truth_colour=(y>0).astype(int)+(y>6).astype(int) if board else y
    seen_colour=np.concatenate(colours) if board else pred
    if not board:
        pred=pred.reshape(-1,64);y=y.reshape(-1,64)
        seen_colour=seen_colour.reshape(-1,64);truth_colour=truth_colour.reshape(-1,64)
    correct=pred==y; color_correct=seen_colour==truth_colour
    def stats(mask):
        return {'squares':float(correct[mask].mean()),'colour':float(color_correct[mask].mean()),'exactBoards':float(correct[mask].all(1).mean()),'colourBoards':float(color_correct[mask].all(1).mean()),'boards':int(np.count_nonzero(mask))}
    result={'model':str(model_path),'data':str(prefix),'overall':stats(np.ones(len(correct),dtype=bool))}
    if metadata:
        files=sorted(Path(metadata).glob('*.json'))
        metas=[json.loads(f.read_text()) for f in files]
        if len(metas)!=len(correct): raise ValueError('Metadata count does not match dataset')
        for field,key in [('lighting','perLighting'),('set','perSet')]:
            values=[m[field]['profile'] if field=='lighting' else m[field] for m in metas]
            result[key]={value:stats(np.array([v==value for v in values])) for value in sorted(set(values))}
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model',type=Path,required=True)
    p.add_argument('--data',type=Path,required=True,help='Dataset prefix, without .x/.y')
    p.add_argument('--metadata',type=Path)
    p.add_argument('--out',type=Path)
    args=p.parse_args()
    result=evaluate(args.model,args.data,args.metadata)
    content=json.dumps(result,indent=2)
    if args.out: args.out.write_text(content)
    print(content,flush=True)

if __name__=='__main__': main()
