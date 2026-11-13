import {FORWARD_WGSL, RESOLVE_WGSL} from './shaders'

export type Renderer = {
  // rgb = sum w*c, a = sum w, for the blobs currently in the params buffer.
  accumView: GPUTextureView
  // Draws the first `count` blobs of the params buffer.
  encodeForward(encoder: GPUCommandEncoder, count: number): void
  // Writes the final colours to a view of the same size (the canvas).
  encodeResolve(encoder: GPUCommandEncoder, view: GPUTextureView): void
  destroy(): void
}

export function createRenderer(
  device: GPUDevice,
  opts: {
    width: number
    height: number
    accumFormat: GPUTextureFormat
    uniforms: GPUBuffer
    params: GPUBuffer
  },
): Renderer {
  const {width, height, accumFormat, uniforms, params} = opts
  const accum = device.createTexture({
    size: {width, height},
    format: accumFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  const accumView = accum.createView()

  const forwardModule = device.createShaderModule({label: 'forward', code: FORWARD_WGSL})
  const forwardLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: 'read-only-storage'}},
    ],
  })
  const additive: GPUBlendComponent = {srcFactor: 'one', dstFactor: 'one', operation: 'add'}
  const forwardPipeline = device.createRenderPipeline({
    label: 'forward',
    layout: device.createPipelineLayout({bindGroupLayouts: [forwardLayout]}),
    vertex: {module: forwardModule, entryPoint: 'vs'},
    fragment: {
      module: forwardModule,
      entryPoint: 'fs',
      targets: [{format: accumFormat, blend: {color: additive, alpha: additive}}],
    },
    primitive: {topology: 'triangle-strip'},
  })
  const forwardGroup = device.createBindGroup({
    layout: forwardLayout,
    entries: [
      {binding: 0, resource: {buffer: uniforms}},
      {binding: 1, resource: {buffer: params}},
    ],
  })

  const resolveModule = device.createShaderModule({label: 'resolve', code: RESOLVE_WGSL})
  const resolveLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: 'unfilterable-float'}},
    ],
  })
  const resolvePipeline = device.createRenderPipeline({
    label: 'resolve',
    layout: device.createPipelineLayout({bindGroupLayouts: [resolveLayout]}),
    vertex: {module: resolveModule, entryPoint: 'fullscreen'},
    fragment: {module: resolveModule, entryPoint: 'fs', targets: [{format: navigator.gpu.getPreferredCanvasFormat()}]},
  })
  const resolveGroup = device.createBindGroup({
    layout: resolveLayout,
    entries: [
      {binding: 0, resource: {buffer: uniforms}},
      {binding: 1, resource: accumView},
    ],
  })

  return {
    accumView,
    encodeForward(encoder, count) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{view: accumView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}],
      })
      pass.setPipeline(forwardPipeline)
      pass.setBindGroup(0, forwardGroup)
      pass.draw(4, count)
      pass.end()
    },
    encodeResolve(encoder, view) {
      const pass = encoder.beginRenderPass({colorAttachments: [{view, loadOp: 'clear', storeOp: 'store'}]})
      pass.setPipeline(resolvePipeline)
      pass.setBindGroup(0, resolveGroup)
      pass.draw(3)
      pass.end()
    },
    destroy() {
      accum.destroy()
    },
  }
}
