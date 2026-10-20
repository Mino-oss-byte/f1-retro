const keys = {};
const pressed = new Set();

window.addEventListener('keydown', (e) => {
  if (!e.repeat) pressed.add(e.code);
  keys[e.code] = true;
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

export function getInput() {
  return {
    throttle: !!keys.KeyW,
    brake: !!keys.KeyS,
    left: !!keys.KeyA,
    right: !!keys.KeyD,
  };
}

// True once per key press (for toggles like traction control).
export function wasPressed(code) {
  return pressed.delete(code);
}

export function clearPressed() {
  pressed.clear();
}
