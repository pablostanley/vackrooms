// W3C Standard Gamepad positions, shared by Xbox and PlayStation mappings.
export const PAD = {
  interact: 0, back: 1, mute: 2, light: 3, run: 7,
  settings: 8, menu: 9, sprint: 10,
  up: 12, down: 13, left: 14, right: 15,
} as const;

type Pad = Pick<Gamepad, "index" | "id" | "connected" | "mapping" | "axes" | "buttons">;
export interface GamepadFrame {
  connected: boolean;
  disconnected: boolean;
  move: { x: number; y: number };
  look: { x: number; y: number };
  held: Set<number>;
  pressed: Set<number>;
}

export function stick(x = 0, y = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const length = Math.hypot(x, y);
  if (length <= 0.18) return { x: 0, y: 0 };
  const magnitude = (Math.min(1, length) - 0.18) / (1 - 0.18);
  return { x: x / length * magnitude, y: y / length * magnitude };
}

export class GamepadInput {
  private selected: string | null = null;
  private previous = new Set<number>();
  private armed = false;
  private repeatAt = new Map<number, number>();

  suspend() {
    this.armed = false;
    this.repeatAt.clear();
  }

  read(pads: readonly (Pad | null)[], enabled = true, now = performance.now()): GamepadFrame {
    const supported = pads.filter((pad): pad is Pad => !!pad?.connected && pad.mapping === "standard");
    const identity = (pad: Pad) => `${pad.index}:${pad.id}`;
    const pad = supported.find((pad) => identity(pad) === this.selected) ?? supported[0];
    const selected = pad ? identity(pad) : null;
    const disconnected = this.selected !== null && this.selected !== selected;
    if (selected !== this.selected) this.suspend();
    this.selected = selected;
    const frame: GamepadFrame = {
      connected: !!pad, disconnected,
      move: { x: 0, y: 0 }, look: { x: 0, y: 0 },
      held: new Set(), pressed: new Set(),
    };
    const held = new Set<number>();
    pad?.buttons.forEach((button, index) => {
      if (button.pressed || button.value > 0.5) held.add(index);
    });
    const move = stick(pad?.axes[0], pad?.axes[1]);
    const look = stick(pad?.axes[2], pad?.axes[3]);
    if (!enabled) this.suspend();
    else if (!this.armed && !held.size && !move.x && !move.y && !look.x && !look.y)
      this.armed = true;
    if (pad && enabled && this.armed) {
      frame.move = move;
      frame.look = look;
      frame.held = held;
      frame.pressed = new Set([...held].filter((button) => !this.previous.has(button)));
      // Native-style repeat for menu navigation, never for gameplay toggles.
      for (const button of [PAD.up, PAD.down, PAD.left, PAD.right]) {
        if (!held.has(button)) this.repeatAt.delete(button);
        else if (frame.pressed.has(button)) this.repeatAt.set(button, now + 400);
        else if (now >= (this.repeatAt.get(button) ?? Infinity)) {
          frame.pressed.add(button);
          this.repeatAt.set(button, now + 90);
        }
      }
    }
    this.previous = held;
    return frame;
  }
}

export function connectedGamepads(): (Gamepad | null)[] {
  try {
    return typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
  } catch {
    // Permissions Policy can disable controllers in embedded previews.
    return [];
  }
}
