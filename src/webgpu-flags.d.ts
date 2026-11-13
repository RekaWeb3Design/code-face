// TypeScript 7.0's DOM lib has the WebGPU interfaces but not these flag namespaces.
// Declared here (only the members this project uses) instead of adding @webgpu/types.
declare const GPUBufferUsage: {
  readonly MAP_READ: number
  readonly COPY_SRC: number
  readonly COPY_DST: number
  readonly UNIFORM: number
  readonly STORAGE: number
}
declare const GPUTextureUsage: {
  readonly COPY_DST: number
  readonly TEXTURE_BINDING: number
  readonly RENDER_ATTACHMENT: number
}
declare const GPUShaderStage: {
  readonly VERTEX: number
  readonly FRAGMENT: number
  readonly COMPUTE: number
}
declare const GPUMapMode: {
  readonly READ: number
}
