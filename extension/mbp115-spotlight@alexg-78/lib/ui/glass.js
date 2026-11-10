// Spotlight Search: frosted glass behind the panel
// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

const BLUR_RADIUS = 30;
// The blurred layer overhangs the visible glass so its soft edges stay outside the clip.
const MARGIN = BLUR_RADIUS;

// Masks everything outside a rounded rectangle. Clutter clips are rectangular only.
const RoundedMask = GObject.registerClass(
class RoundedMask extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
            'uniform vec2 size;\nuniform float radius;\n',
            `vec2 p = cogl_tex_coord_in[0].xy * size;
             vec2 q = abs(p - size * 0.5) - (size * 0.5 - radius);
             float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
             cogl_color_out *= 1.0 - clamp(d + 0.5, 0.0, 1.0);`);
    }

    setShape(width, height, radius) {
        this.set_uniform_float('size', 2, [width, height]);
        this.set_uniform_float('radius', 1, [radius]);
        this.queue_repaint();
    }
});

// Shell.BlurEffect's BACKGROUND mode reads the framebuffer it paints into, which inside
// the mask's offscreen buffer is empty. So we blur a clone of the windows in ACTOR mode.
export const Glass = GObject.registerClass(
class Glass extends St.Widget {
    _init(radius) {
        super._init({x_expand: true, y_expand: true, clip_to_allocation: true});
        this._radius = radius;
        this._clone = new Clutter.Clone({source: global.window_group});
        this._blurred = new Clutter.Actor();
        this._blurred.add_child(this._clone);
        this._blur = new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR, brightness: 1.0});
        this._blurred.add_effect(this._blur);
        this.add_child(this._blurred);
        this._mask = new RoundedMask();
        this.add_effect(this._mask);

        St.ThemeContext.get_for_stage(global.stage).connectObject(
            'notify::scale-factor', () => this._syncScale(), this);
        this._syncScale();
    }

    // The clone is monitor sized; the panel's size must come from its content only.
    vfunc_get_preferred_width(_forHeight) {
        return [0, 0];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [0, 0];
    }

    // Stage position of the glass, so the clone lines up with what is really behind it.
    setOrigin(x, y) {
        this._clone.set_position(MARGIN - x, MARGIN - y);
    }

    _syncScale() {
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        this._blur.radius = BLUR_RADIUS * scaleFactor;
    }

    // Sizing the blurred layer here instead of from notify::size: a set_size() during
    // allocation queues another relayout, which Clutter warns about once the panel grows.
    vfunc_allocate(box) {
        super.vfunc_allocate(box);
        const [width, height] = box.get_size();
        this._blurred.allocate(new Clutter.ActorBox({
            x1: -MARGIN, y1: -MARGIN, x2: width + MARGIN, y2: height + MARGIN,
        }));
        this._mask.setShape(width, height, Math.min(this._radius, height / 2));
    }
});
