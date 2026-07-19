import json, sys, pathlib
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

def extract_palette(img, k=5):
    px = np.asarray(img.convert('RGB').resize((64, 64))).reshape(-1, 3).astype(float)
    uniq = np.unique(px, axis=0)
    k = min(k, len(uniq))
    km = KMeans(n_clusters=k, n_init=4, random_state=0).fit(px)
    counts = np.bincount(km.labels_)
    centers = km.cluster_centers_[np.argsort(-counts)].round().astype(int)
    hexes = ['#%02x%02x%02x' % tuple(c) for c in centers]
    return (hexes + hexes[-1:] * 5)[:5]

def mean_brightness(img):
    return float(np.asarray(img.convert('L')).mean() / 255.0)

def embed(img):
    small = np.asarray(img.convert('RGB').resize((8, 8))).astype(float) / 255.0
    return small.reshape(-1)

def layout(embeddings):
    import umap
    n = len(embeddings)
    pts = umap.UMAP(n_neighbors=min(15, n - 1), min_dist=0.3,
                    random_state=42).fit_transform(embeddings)
    pts = pts - pts.mean(0)
    scale = np.abs(pts).max() or 1.0
    return pts / scale * 50.0

def main(days_path, img_dir, out_path):
    days = json.loads(pathlib.Path(days_path).read_text())
    imgs = [Image.open(pathlib.Path(img_dir) / f"{d['slug']}.jpg") for d in days]
    pts = layout(np.array([embed(im) for im in imgs]))
    out = [{'slug': d['slug'],
            'palette': extract_palette(im),
            'brightness': round(mean_brightness(im), 4),
            'x': round(float(p[0]), 3), 'y': round(float(p[1]), 3)}
           for d, im, p in zip(days, imgs, pts)]
    pathlib.Path(out_path).write_text(json.dumps(out))
    print(f"analyzed {len(out)} artworks -> {out_path}")

if __name__ == '__main__':
    main(*sys.argv[1:4])
