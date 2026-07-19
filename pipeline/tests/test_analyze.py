import numpy as np
from PIL import Image
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from analyze import extract_palette, mean_brightness, embed, layout

def solid(rgb, size=64):
    return Image.new('RGB', (size, size), rgb)

def test_palette_of_solid_image_is_that_color():
    pal = extract_palette(solid((255, 0, 0)))
    assert len(pal) == 5
    assert pal[0] == '#ff0000'

def test_brightness_bounds():
    assert mean_brightness(solid((0, 0, 0))) == 0.0
    assert mean_brightness(solid((255, 255, 255))) == 1.0

def test_embed_shape():
    assert embed(solid((10, 20, 30))).shape == (192,)

def test_layout_normalized_and_separates_colors():
    rng = np.random.default_rng(1)
    reds = [embed(solid((255, r, r))) for r in rng.integers(0, 60, 10)]
    blues = [embed(solid((b, b, 255))) for b in rng.integers(0, 60, 10)]
    pts = layout(np.array(reds + blues))
    assert pts.shape == (20, 2)
    assert pts.min() >= -50 and pts.max() <= 50
    red_c, blue_c = pts[:10].mean(0), pts[10:].mean(0)
    assert np.linalg.norm(red_c - blue_c) > 10  # clusters separate
