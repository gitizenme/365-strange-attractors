export interface OrbitState {
  azimuth: number;
  elevation: number;
  radius: number;
  target: { x: number; y: number; z: number };
}

export function initialOrbitState(target: { x: number; y: number; z: number }): OrbitState {
  return { azimuth: 0, elevation: 0, radius: 10, target };
}

export function applyOrbitDrag(state: OrbitState, dx: number, dy: number): OrbitState {
  const azimuth = state.azimuth - dx * 0.005;
  const elevation = Math.max(-1.4, Math.min(1.4, state.elevation - dy * 0.005));
  return { ...state, azimuth, elevation };
}

export function applyOrbitZoom(state: OrbitState, deltaY: number): OrbitState {
  const radius = Math.max(3, Math.min(30, state.radius * Math.exp(deltaY * 0.0015)));
  return { ...state, radius };
}

export function orbitCameraPosition(state: OrbitState): { x: number; y: number; z: number } {
  const { azimuth, elevation, radius, target } = state;
  return {
    x: target.x + radius * Math.cos(elevation) * Math.sin(azimuth),
    y: target.y + radius * Math.sin(elevation),
    z: target.z + radius * Math.cos(elevation) * Math.cos(azimuth),
  };
}
