// Blob parameter layout: 9 floats per blob, positions and sigmas normalized to the image long side.
export const P = 9
export const X = 0
export const Y = 1
export const LOG_SX = 2
export const LOG_SY = 3
export const THETA = 4
export const R = 5
export const G = 6
export const B = 7
export const A_RAW = 8 // opacity a = sigmoid(A_RAW)
export const PARAM_NAMES = ['x', 'y', 'log_sx', 'log_sy', 'theta', 'r', 'g', 'b', 'a_raw']

// A blob only contributes where d^T Sigma^-1 d < Q_MAX (the 3-sigma footprint).
export const Q_MAX = 9
// Weight of the background in the normalized blend.
export const EPS = 0.01
