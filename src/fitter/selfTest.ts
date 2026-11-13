import {jitter, lossAndGradients} from '../reference/gradients'
import {
  BIG_BLOB,
  blobGradError,
  SUBSAMPLE_MAX_SIDE,
  SUBSAMPLE_STRIDE,
  subsampleCase,
} from '../reference/subsampleCase'
import {tinyCase} from '../reference/tinyCase'
import {defaultAccumFormat, type AccumFormat} from './device'
import {createFitter} from './fitter'
import {P, PARAM_NAMES, Q_MAX} from './params'
import {defaultSettings} from './settings'

// Limits on the relative error against the float64 CPU reference.
// rgba32float isolates the shader maths; rgba16float's 11-bit mantissa limits how closely
// the accumulated sums can match.
const THRESHOLDS: Record<AccumFormat, {loss: number; grad: number}> = {
  rgba32float: {loss: 1e-4, grad: 1e-3},
  rgba16float: {loss: 1e-2, grad: 5e-2},
}
const ADAM_THRESHOLD = 1e-2
// Wide limits so the clamp in the Adam step cannot touch the test cases.
const NO_SIGMA_LIMIT = {sigmaMin: 1e-4, sigmaMax: 10}

export type SelfTestRow = {
  format: AccumFormat
  strict: boolean // false: shown for information, does not count towards PASS / FAIL
  lossGpu: number
  lossCpu: number
  lossErr: number // |gpu - cpu| / cpu
  gradErr: number // worst param: max |gpu - cpu| over blobs / max |cpu| over blobs
  worstParam: string
  lossThreshold: number
  gradThreshold: number
  pass: boolean // the limits are met
}

// The subsampled gather: one blob covering a 64x48 image, read on a 4x3 grid (12 possible offsets).
export type SubsampleRow = {
  format: AccumFormat
  strict: boolean
  // GPU without subsampling vs the CPU reference without subsampling (same metric as gradErr).
  fullErr: number
  // Worst of the 12 offsets: GPU subsampled vs the CPU reference walking the same grid.
  gridErr: number
  gridStrict: boolean // false: gridErr is informational even in a strict row
  // Mean of the GPU's 12 subsampled gradients vs the GPU's full gradient, big blob,
  // max over its 9 params of |mean - full| / |full|. Zero in exact arithmetic.
  meanErr: number
  threshold: number // for the three errors above
  // Never thresholded, sampling noise: one subsampled gradient vs the full one, same metric as meanErr.
  singleMedian: number
  singleMax: number
  pass: boolean // the limits that count for this row are met
}

// Inactive blobs: the tiny case with 3 extra, loud blobs allocated behind the 5 active ones.
export type InactiveCheck = {
  sameLoss: boolean // loss is bit-identical to the run without the extra blobs
  sameGradients: boolean // so are the gradients of the active blobs
  zeroGradients: boolean // the inactive blobs get exactly zero gradient
  untouched: boolean // and an Adam step leaves their params bit-identical
  pass: boolean
}

async function inactiveTest(device: GPUDevice, format: AccumFormat): Promise<InactiveCheck> {
  const {scene, count, params, rgba} = tinyCase(Q_MAX)
  const settings = {...defaultSettings(scene.width, scene.height, count, scene.bg), ...NO_SIGMA_LIMIT}
  const extra = 3
  const padded = new Float32Array((count + extra) * P)
  padded.set(params)
  // Big, bright, opaque blobs in the middle of the image: impossible to miss if they were drawn.
  for (let i = count; i < count + extra; i++) padded.set([0.5, 0.35, -1, -1, 0.3, 1, 0, 1, 4], i * P)

  const plain = createFitter(device, settings, rgba, params, format)
  const withInactive = createFitter(device, settings, rgba, padded, format)
  try {
    const lossA = await plain.readLoss()
    const lossB = await withInactive.readLoss()
    const gradsA = await plain.readGradients()
    const gradsB = await withInactive.readGradients()
    withInactive.step(1)
    const after = await withInactive.readParams()
    const active = count * P
    const sameGradients = gradsA.every((g, j) => Object.is(g, gradsB[j]))
    const zeroGradients = gradsB.subarray(active).every((g) => g === 0)
    const untouched = padded.subarray(active).every((p, j) => Object.is(p, after[active + j]))
    const sameLoss = Object.is(lossA, lossB)
    return {sameLoss, sameGradients, zeroGradients, untouched, pass: sameLoss && sameGradients && zeroGradients && untouched}
  } finally {
    plain.destroy()
    withInactive.destroy()
  }
}

export type SelfTestResult = {
  inactive: InactiveCheck
  fitFormat: AccumFormat // what the app fits with on this device; its limits are the strict ones
  reducedPrecision: boolean // the device can only fit with rgba16float
  rows: SelfTestRow[]
  subsample: SubsampleRow[]
  adamErr: number // max |actual update - expected first Adam update| / learning rate
  adamThreshold: number
  adamPass: boolean
  pass: boolean
}

// Per param: max |gpu - cpu| over blobs / max |cpu| over blobs. Returns the worst param.
function gradError(gpu: ArrayLike<number>, cpu: ArrayLike<number>, count: number) {
  let err = 0
  let worstParam = ''
  for (let k = 0; k < P; k++) {
    let diff = 0
    let scale = 0
    for (let i = 0; i < count; i++) {
      const d = Math.abs(gpu[i * P + k] - cpu[i * P + k])
      diff = Number.isNaN(d) ? Infinity : Math.max(diff, d)
      scale = Math.max(scale, Math.abs(cpu[i * P + k]))
    }
    if (diff / scale >= err) {
      err = diff / scale
      worstParam = PARAM_NAMES[k]
    }
  }
  return {err, worstParam}
}

async function subsampleTest(
  device: GPUDevice,
  format: AccumFormat,
  strict: boolean,
  gridStrict: boolean,
): Promise<SubsampleRow> {
  const {scene, count, params, target, rgba} = subsampleCase()
  const base = {...defaultSettings(scene.width, scene.height, count, scene.bg), ...NO_SIGMA_LIMIT}
  const p = Float64Array.from(params)

  const fullFitter = createFitter(device, {...base, maxSide: 128}, rgba, params, format)
  let full: Float32Array
  try {
    full = await fullFitter.readGradients()
  } finally {
    fullFitter.destroy()
  }
  const fullErr = gradError(full, lossAndGradients(p, count, scene, target).grads, count).err

  // One step number per grid offset of the big blob, found with the CPU twin of the shader's hash.
  const offsets = SUBSAMPLE_STRIDE[0] * SUBSAMPLE_STRIDE[1]
  const stepFor = new Map<string, number>()
  for (let step = 1; stepFor.size < offsets && step < 10000; step++) {
    const key = jitter(step)(BIG_BLOB, SUBSAMPLE_STRIDE).join(',')
    if (!stepFor.has(key)) stepFor.set(key, step)
  }

  const fitter = createFitter(device, {...base, maxSide: SUBSAMPLE_MAX_SIDE}, rgba, params, format)
  const mean = new Float64Array(count * P)
  const single: number[] = []
  let gridErr = 0
  try {
    for (const step of stepFor.values()) {
      const gpu = await fitter.readGradients(step)
      const sampling = {maxSide: SUBSAMPLE_MAX_SIDE, offset: jitter(step)}
      const cpu = lossAndGradients(p, count, scene, target, sampling).grads
      gridErr = Math.max(gridErr, gradError(gpu, cpu, count).err)
      single.push(blobGradError(gpu, full, BIG_BLOB).err)
      for (let j = 0; j < mean.length; j++) mean[j] += gpu[j] / offsets
    }
  } finally {
    fitter.destroy()
  }
  single.sort((a, b) => a - b)
  const meanErr = stepFor.size === offsets ? blobGradError(mean, full, BIG_BLOB).err : Infinity
  const threshold = THRESHOLDS[format].grad
  return {
    format,
    strict,
    fullErr,
    gridErr,
    gridStrict,
    meanErr,
    threshold,
    singleMedian: single[single.length >> 1],
    singleMax: single[single.length - 1],
    pass: fullErr < threshold && meanErr < threshold && (!gridStrict || gridErr < threshold),
  }
}

// Strict limits apply to the format the app fits with on this device.
// - rgba32float available: rgba16float is also run, for information only.
// - rgba16float only: its limits are strict, except the per-grid subsampling check, where the
//   12x sample weight amplifies the format's rounding beyond any useful limit.
export async function runSelfTest(device: GPUDevice): Promise<SelfTestResult> {
  const {scene, count, params, target, rgba} = tinyCase(Q_MAX)
  const settings = {...defaultSettings(scene.width, scene.height, count, scene.bg), ...NO_SIGMA_LIMIT}
  const cpu = lossAndGradients(Float64Array.from(params), count, scene, target)

  const fitFormat = defaultAccumFormat(device)
  const formats: AccumFormat[] = fitFormat === 'rgba32float' ? ['rgba32float', 'rgba16float'] : ['rgba16float']
  const rows: SelfTestRow[] = []
  const subsample: SubsampleRow[] = []
  let adamErr = NaN
  for (const format of formats) {
    const strict = format === fitFormat
    const fitter = createFitter(device, settings, rgba, params, format)
    try {
      const grads = await fitter.readGradients()
      const lossGpu = await fitter.readLoss()
      const {err: gradErr, worstParam} = gradError(grads, cpu.grads, count)
      const lossErr = Math.abs(lossGpu - cpu.loss) / cpu.loss
      const {loss: lossThreshold, grad: gradThreshold} = THRESHOLDS[format]
      rows.push({
        format,
        strict,
        lossGpu,
        lossCpu: cpu.loss,
        lossErr,
        gradErr,
        worstParam,
        lossThreshold,
        gradThreshold,
        pass: lossErr < lossThreshold && gradErr < gradThreshold,
      })

      if (strict) {
        // First Adam step: m_hat = g and v_hat = g^2, so every param moves by -lr * g / (|g| + eps).
        fitter.step(1)
        const after = await fitter.readParams()
        adamErr = 0
        for (let j = 0; j < count * P; j++) {
          const lr = settings.lr[j % P]
          const expected = (-lr * grads[j]) / (Math.abs(grads[j]) + settings.adamEps)
          const err = Math.abs(after[j] - params[j] - expected) / lr
          adamErr = Number.isNaN(err) ? Infinity : Math.max(adamErr, err)
        }
      }
    } finally {
      fitter.destroy()
    }
    subsample.push(await subsampleTest(device, format, strict, format === 'rgba32float'))
  }
  const adamPass = adamErr < ADAM_THRESHOLD
  const counted = [...rows, ...subsample].filter((row) => row.strict)
  const inactive = await inactiveTest(device, fitFormat)
  return {
    inactive,
    fitFormat,
    reducedPrecision: fitFormat === 'rgba16float',
    rows,
    subsample,
    adamErr,
    adamThreshold: ADAM_THRESHOLD,
    adamPass,
    pass: adamPass && inactive.pass && counted.every((row) => row.pass),
  }
}
