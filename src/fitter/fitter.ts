import {createRenderer} from '../renderer/renderer'
import {packUniforms, UNIFORM_BYTES} from '../renderer/uniforms'
import type {AccumFormat} from './device'
import {LOG_SX, LOG_SY, P} from './params'
import type {FitSettings} from './settings'
import {ADAM_WGSL, ERROR_MAP_WGSL, GATHER_WGSL, LOSS_GRAD_WGSL, LOSS_ROWS_WGSL} from './shaders'

export type Fitter = {
  readonly steps: number
  readonly active: number // blobs in use; the rest of the capacity is ignored
  // Activates more blobs. newParams holds the blobs [active, settings.count); the settings carry the
  // new active count and the size limits that follow from it. New blobs start with fresh Adam state.
  grow(newParams: Float32Array, settings: FitSettings): void
  // |C - T| summed over the 3 channels for every pixel of the current blobs, row 0 at the top.
  readErrorMap(): Promise<Float32Array>
  // Queues n optimisation steps (forward, loss gradient, gather, Adam). No readback.
  step(n: number): void
  // Shows the latest forward render in a view of the working size (the canvas). After a step this
  // is the picture the step was computed from, so at most one step behind the params.
  draw(view: GPUTextureView): void
  // Mean absolute error of the current blobs against the target, in 0..1.
  readLoss(): Promise<number>
  // The same single readback, plus optionally the whole params buffer to summarise the blob sizes
  // (sigma) and the params of a few chosen blobs (blobs, as indices). Returns the chosen blobs'
  // params in the order asked, 9 floats each.
  readStats(options: {sigma: boolean; blobs: readonly number[]}): Promise<{
    loss: number
    sigma: SigmaStats | null
    blobs: Float32Array
  }>
  // For the self-test: gradients of the current blobs (no Adam step), and the raw params.
  // jitterStep picks the subsampling grid of that step number (default: the current step).
  readGradients(jitterStep?: number): Promise<Float32Array>
  readParams(): Promise<Float32Array>
  destroy(): void
}

// Blob sizes in pixels at the working resolution.
export type SigmaStats = {
  meanPx: number // mean over both axes of all blobs
  maxPx: number
  capPx: number // the sigma limit
  atCap: number // blobs with at least one axis at the limit
}

const WORKGROUP = 64

export function createFitter(
  device: GPUDevice,
  settings: FitSettings,
  targetRgba: Uint8ClampedArray, // width * height * 4
  // capacity * 9. The buffers are allocated for all of it, but only the first settings.count
  // blobs are active: the forward pass, the gather and the Adam step ignore the rest.
  initialParams: Float32Array,
  accumFormat: AccumFormat,
): Fitter {
  const {width, height} = settings
  const capacity = initialParams.length / P
  if (!Number.isInteger(capacity) || settings.count > capacity) throw new Error('Blob params do not match the blob count.')
  const paramBytes = capacity * P * 4
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  const uniforms = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const params = device.createBuffer({size: paramBytes, usage: storage})
  const grads = device.createBuffer({size: paramBytes, usage: storage})
  const adamM = device.createBuffer({size: paramBytes, usage: storage})
  const adamV = device.createBuffer({size: paramBytes, usage: storage})
  const rowSums = device.createBuffer({size: height * 4, usage: storage})
  const pixelError = device.createBuffer({size: width * height * 4, usage: storage})
  const birth = device.createBuffer({size: capacity * 4, usage: storage}) // zero: there from the start
  device.queue.writeBuffer(params, 0, initialParams as Float32Array<ArrayBuffer>)
  device.queue.writeBuffer(uniforms, 0, packUniforms(settings, 0))

  const target = device.createTexture({
    size: {width, height},
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    {texture: target},
    targetRgba as Uint8ClampedArray<ArrayBuffer>,
    {bytesPerRow: width * 4},
    {width, height},
  )
  const targetView = target.createView()
  const lossGrad = device.createTexture({
    size: {width, height},
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  const lossGradView = lossGrad.createView()

  const renderer = createRenderer(device, {width, height, accumFormat, uniforms, params})

  const texture: GPUTextureBindingLayout = {sampleType: 'unfilterable-float'}
  const FRAGMENT = GPUShaderStage.FRAGMENT
  const COMPUTE = GPUShaderStage.COMPUTE

  const lossGradLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: FRAGMENT, buffer: {type: 'uniform'}},
      {binding: 1, visibility: FRAGMENT, texture},
      {binding: 2, visibility: FRAGMENT, texture},
    ],
  })
  const lossGradModule = device.createShaderModule({label: 'lossGrad', code: LOSS_GRAD_WGSL})
  const lossGradPipeline = device.createRenderPipeline({
    label: 'lossGrad',
    layout: device.createPipelineLayout({bindGroupLayouts: [lossGradLayout]}),
    vertex: {module: lossGradModule, entryPoint: 'fullscreen'},
    fragment: {module: lossGradModule, entryPoint: 'fs', targets: [{format: 'rgba16float'}]},
  })
  const lossGradGroup = device.createBindGroup({
    layout: lossGradLayout,
    entries: [
      {binding: 0, resource: {buffer: uniforms}},
      {binding: 1, resource: renderer.accumView},
      {binding: 2, resource: targetView},
    ],
  })

  const gatherLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 2, visibility: COMPUTE, buffer: {type: 'storage'}},
      {binding: 3, visibility: COMPUTE, texture},
      {binding: 4, visibility: COMPUTE, texture},
    ],
  })
  const gatherPipeline = device.createComputePipeline({
    label: 'gather',
    layout: device.createPipelineLayout({bindGroupLayouts: [gatherLayout]}),
    compute: {module: device.createShaderModule({label: 'gather', code: GATHER_WGSL}), entryPoint: 'main'},
  })
  const gatherGroup = device.createBindGroup({
    layout: gatherLayout,
    entries: [
      {binding: 0, resource: {buffer: uniforms}},
      {binding: 1, resource: {buffer: params}},
      {binding: 2, resource: {buffer: grads}},
      {binding: 3, resource: renderer.accumView},
      {binding: 4, resource: lossGradView},
    ],
  })

  const adamLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: COMPUTE, buffer: {type: 'storage'}},
      {binding: 2, visibility: COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 3, visibility: COMPUTE, buffer: {type: 'storage'}},
      {binding: 4, visibility: COMPUTE, buffer: {type: 'storage'}},
      {binding: 5, visibility: COMPUTE, buffer: {type: 'read-only-storage'}},
    ],
  })
  const adamPipeline = device.createComputePipeline({
    label: 'adam',
    layout: device.createPipelineLayout({bindGroupLayouts: [adamLayout]}),
    compute: {module: device.createShaderModule({label: 'adam', code: ADAM_WGSL}), entryPoint: 'main'},
  })
  const adamGroup = device.createBindGroup({
    layout: adamLayout,
    entries: [
      {binding: 0, resource: {buffer: uniforms}},
      {binding: 1, resource: {buffer: params}},
      {binding: 2, resource: {buffer: grads}},
      {binding: 3, resource: {buffer: adamM}},
      {binding: 4, resource: {buffer: adamV}},
      {binding: 5, resource: {buffer: birth}},
    ],
  })

  const lossRowsLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: COMPUTE, texture},
      {binding: 2, visibility: COMPUTE, texture},
      {binding: 3, visibility: COMPUTE, buffer: {type: 'storage'}},
    ],
  })
  const lossRowsPipeline = device.createComputePipeline({
    label: 'lossRows',
    layout: device.createPipelineLayout({bindGroupLayouts: [lossRowsLayout]}),
    compute: {module: device.createShaderModule({label: 'lossRows', code: LOSS_ROWS_WGSL}), entryPoint: 'main'},
  })
  const lossRowsGroup = device.createBindGroup({
    layout: lossRowsLayout,
    entries: [
      {binding: 0, resource: {buffer: uniforms}},
      {binding: 1, resource: renderer.accumView},
      {binding: 2, resource: targetView},
      {binding: 3, resource: {buffer: rowSums}},
    ],
  })

  const errorMapPipeline = device.createComputePipeline({
    label: 'errorMap',
    layout: device.createPipelineLayout({bindGroupLayouts: [lossRowsLayout]}),
    compute: {module: device.createShaderModule({label: 'errorMap', code: ERROR_MAP_WGSL}), entryPoint: 'main'},
  })
  const errorMapGroup = device.createBindGroup({
    layout: lossRowsLayout,
    entries: [
      {binding: 0, resource: {buffer: uniforms}},
      {binding: 1, resource: renderer.accumView},
      {binding: 2, resource: targetView},
      {binding: 3, resource: {buffer: pixelError}},
    ],
  })

  const blobGroups = () => Math.ceil(settings.count / WORKGROUP)
  const rowGroups = Math.ceil(height / WORKGROUP)

  function compute(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    group: GPUBindGroup,
    workgroups: number,
  ) {
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(workgroups)
    pass.end()
  }

  // forward -> per-pixel loss gradient -> per-blob gather. Leaves the gradients in `grads`.
  function encodeGradients(encoder: GPUCommandEncoder) {
    renderer.encodeForward(encoder, settings.count)
    const pass = encoder.beginRenderPass({
      colorAttachments: [{view: lossGradView, loadOp: 'clear', storeOp: 'store'}],
    })
    pass.setPipeline(lossGradPipeline)
    pass.setBindGroup(0, lossGradGroup)
    pass.draw(3)
    pass.end()
    compute(encoder, gatherPipeline, gatherGroup, blobGroups())
  }

  // Finishes the encoder with a copy of the sources ([buffer, bytes, offset in the buffer]), one after
  // the other, and resolves with the contents.
  async function readBack(encoder: GPUCommandEncoder, ...sources: [GPUBuffer, number, number?][]) {
    const total = sources.reduce((sum, [, bytes]) => sum + bytes, 0)
    const staging = device.createBuffer({size: total, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST})
    let offset = 0
    for (const [source, bytes, from = 0] of sources) {
      encoder.copyBufferToBuffer(source, from, staging, offset, bytes)
      offset += bytes
    }
    device.queue.submit([encoder.finish()])
    try {
      await staging.mapAsync(GPUMapMode.READ)
      return new Float32Array(staging.getMappedRange().slice(0))
    } finally {
      staging.destroy()
    }
  }

  function encodeLossRows() {
    const encoder = device.createCommandEncoder()
    renderer.encodeForward(encoder, settings.count)
    compute(encoder, lossRowsPipeline, lossRowsGroup, rowGroups)
    return encoder
  }

  function meanError(rows: Float32Array) {
    let sum = 0
    for (let y = 0; y < height; y++) sum += rows[y]
    return sum / (3 * width * height)
  }

  let steps = 0

  return {
    get steps() {
      return steps
    },
    get active() {
      return settings.count
    },
    grow(newParams, newSettings) {
      const from = settings.count
      const added = newSettings.count - from
      if (added < 1 || newSettings.count > capacity || newParams.length !== added * P) {
        throw new Error('Growth does not match the blob capacity.')
      }
      device.queue.writeBuffer(params, from * P * 4, newParams as Float32Array<ArrayBuffer>)
      device.queue.writeBuffer(birth, from * 4, new Uint32Array(added).fill(steps))
      settings = newSettings
      device.queue.writeBuffer(uniforms, 0, packUniforms(settings, steps))
    },
    readErrorMap() {
      const encoder = device.createCommandEncoder()
      renderer.encodeForward(encoder, settings.count)
      compute(encoder, errorMapPipeline, errorMapGroup, rowGroups)
      return readBack(encoder, [pixelError, width * height * 4])
    },
    step(n) {
      for (let s = 0; s < n; s++) {
        steps++
        // Queue writes and submits run in order, so each step sees its own step number.
        device.queue.writeBuffer(uniforms, 0, packUniforms(settings, steps))
        const encoder = device.createCommandEncoder()
        encodeGradients(encoder)
        compute(encoder, adamPipeline, adamGroup, blobGroups())
        device.queue.submit([encoder.finish()])
      }
    },
    draw(view) {
      const encoder = device.createCommandEncoder()
      // Every step and every loss readback leaves its forward render in the accumulation target,
      // so only the very first frame needs a render of its own.
      if (steps === 0) renderer.encodeForward(encoder, settings.count)
      renderer.encodeResolve(encoder, view)
      device.queue.submit([encoder.finish()])
    },
    async readLoss() {
      return meanError(await readBack(encodeLossRows(), [rowSums, height * 4]))
    },
    async readStats({sigma, blobs}) {
      const count = settings.count
      const picked = blobs.filter((i) => i >= 0 && i < count)
      const blobBytes = P * 4
      // With the whole params buffer at hand, the chosen blobs are cut from it; otherwise only they are copied.
      const sources: [GPUBuffer, number, number?][] = [[rowSums, height * 4]]
      if (sigma) sources.push([params, paramBytes])
      else for (const i of picked) sources.push([params, blobBytes, i * blobBytes])
      const data = await readBack(encodeLossRows(), ...sources)
      const loss = meanError(data)
      const chosen = new Float32Array(picked.length * P)
      picked.forEach((i, k) => {
        const from = height + (sigma ? i * P : k * P)
        chosen.set(data.subarray(from, from + P), k * P)
      })
      if (!sigma) return {loss, sigma: null, blobs: chosen}
      const longSide = Math.max(width, height)
      const logCap = Math.fround(Math.log(settings.sigmaMax)) // the value the Adam step clamps to
      let sum = 0
      let max = 0
      let atCap = 0
      for (let i = 0; i < count; i++) {
        const logSx = data[height + i * P + LOG_SX]
        const logSy = data[height + i * P + LOG_SY]
        const sx = Math.exp(logSx)
        const sy = Math.exp(logSy)
        sum += sx + sy
        max = Math.max(max, sx, sy)
        if (Math.max(logSx, logSy) >= logCap) atCap++
      }
      return {
        loss,
        sigma: {
          meanPx: (sum / (2 * count)) * longSide,
          maxPx: max * longSide,
          capPx: settings.sigmaMax * longSide,
          atCap,
        },
        blobs: chosen,
      }
    },
    readGradients(jitterStep = steps) {
      device.queue.writeBuffer(uniforms, 0, packUniforms(settings, jitterStep))
      const encoder = device.createCommandEncoder()
      encodeGradients(encoder)
      return readBack(encoder, [grads, paramBytes])
    },
    readParams() {
      return readBack(device.createCommandEncoder(), [params, paramBytes])
    },
    destroy() {
      for (const buffer of [uniforms, params, grads, adamM, adamV, rowSums, pixelError, birth]) buffer.destroy()
      target.destroy()
      lossGrad.destroy()
      renderer.destroy()
    },
  }
}
